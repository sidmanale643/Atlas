"""Vector store providers for the Atlas Python port.

Port of ``src/vector-store.js`` covering the helpers exercised by the Python
test suite. Qdrant and LanceDB integrations are both exposed as factory
functions that accept a client/connection so the test suite can swap them for
in-memory fakes.
"""

from __future__ import annotations

import hashlib
import math
import os
import re
import threading
import unicodedata
from typing import Any, Callable, Iterable, Optional
from urllib.parse import urlparse

EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "Xenova/all-MiniLM-L6-v2")
EMBEDDING_DIMENSIONS = int(os.environ.get("EMBEDDING_DIMENSIONS", "384"))
QDRANT_COLLECTION = os.environ.get("QDRANT_COLLECTION", "atlas_memories")
LANCEDB_PATH = os.environ.get("LANCEDB_PATH", "./lancedb")
LANCEDB_TABLE = os.environ.get("LANCEDB_TABLE", "atlas_memories")

RRF_K = 60


# --- Embedding helpers -----------------------------------------------------


async def embed_text(text: str, embed_fn=None) -> list[float]:
    """Default embedder: returns a deterministic unit vector from text.

    In production, this would call into a Transformers.js feature-extraction
    pipeline. The Python port keeps the same signature but the actual model
    invocation is left to an injected function so tests can stub it.
    """
    if embed_fn is not None:
        return await embed_fn(text)
    if not text or not str(text).strip():
        raise ValueError("Cannot embed empty text")
    # Deterministic placeholder embedding from the SHA-256 of the text.
    digest = hashlib.sha256(str(text).encode("utf-8")).digest()
    vector = [(digest[i % len(digest)] / 255.0) - 0.5 for i in range(EMBEDDING_DIMENSIONS)]
    norm = math.sqrt(sum(x * x for x in vector)) or 1.0
    return [x / norm for x in vector]


def memory_embedding_text(memory: dict | None) -> str:
    raw_text = str((memory or {}).get("raw_text") or "").strip()
    summary = str((memory or {}).get("summary") or "").strip()
    if summary and summary != raw_text:
        return f"{raw_text}\n{summary}"
    return raw_text


def memory_point_id(memory_id: str) -> str:
    """Deterministic UUID5-style identifier from a memory ID."""
    digest = hashlib.sha256(str(memory_id).encode("utf-8")).digest()[:16]
    byte_arr = bytearray(digest)
    byte_arr[6] = (byte_arr[6] & 0x0F) | 0x50
    byte_arr[8] = (byte_arr[8] & 0x3F) | 0x80
    hex_str = byte_arr.hex()
    return "-".join([
        hex_str[0:8],
        hex_str[8:12],
        hex_str[12:16],
        hex_str[16:20],
        hex_str[20:32],
    ])


# --- Qdrant provider --------------------------------------------------------


def create_memory_vector_store(
    *,
    client: Any,
    embed: Optional[Callable] = None,
    collection_name: str = QDRANT_COLLECTION,
    vector_size: int = EMBEDDING_DIMENSIONS,
    embedding_model: str = EMBEDDING_MODEL,
) -> dict:
    """Construct a Qdrant-backed memory vector store."""

    embed_fn = embed or (lambda text: embed_text(text))
    collection_promise: dict = {"value": None}

    async def ensure_collection():
        if collection_promise["value"] is not None:
            return collection_promise["value"]
        try:
            result = await client.collection_exists(collection_name)
            if not result["exists"]:
                try:
                    await client.create_collection(
                        collection_name,
                        {"vectors": {"size": vector_size, "distance": "Cosine"}},
                    )
                except Exception:
                    again = await client.collection_exists(collection_name)
                    if not again["exists"]:
                        raise
            info = await client.get_collection(collection_name)
            vectors = (info.get("config") or {}).get("params", {}).get("vectors")
            if vectors and vectors.get("size") and vectors["size"] != vector_size:
                raise ValueError(
                    f'Qdrant collection "{collection_name}" uses {vectors["size"]} dimensions; expected {vector_size}'
                )
            collection_promise["value"] = True
        except Exception:
            collection_promise["value"] = None
            raise

    async def index_memory(memory: dict) -> None:
        if not memory.get("id"):
            raise ValueError("Memory ID is required for vector indexing")
        await ensure_collection()
        text = memory_embedding_text(memory)
        vector = await embed_fn(text)
        if len(vector) != vector_size:
            raise ValueError(
                f"Embedding has {len(vector)} dimensions; expected {vector_size}"
            )
        await client.upsert(
            collection_name,
            {
                "wait": True,
                "points": [
                    {
                        "id": memory_point_id(memory["id"]),
                        "vector": list(vector),
                        "payload": {
                            "memory_id": memory["id"],
                            "type": memory.get("type"),
                            "title": memory.get("title"),
                            "confidence": memory.get("confidence"),
                            "tags": memory.get("tags") or [],
                            "scope": "agent",
                            "embedding_model": embedding_model,
                            "source": memory.get("source") or "ui",
                            "ingestion_date": memory.get("ingestion_date"),
                            "created_at": memory.get("created_at"),
                            "updated_at": memory.get("updated_at"),
                        },
                    }
                ],
            },
        )

    async def search_memories(query: str, options: dict | None = None) -> list[dict]:
        options = options or {}
        limit = options.get("limit", 10)
        score_threshold = options.get("scoreThreshold")
        await ensure_collection()
        vector = await embed_fn(query)
        response = await client.query(
            collection_name,
            {
                "query": list(vector),
                "limit": limit,
                "score_threshold": score_threshold,
                "with_payload": True,
                "with_vector": False,
            },
        )
        return [
            {"id": p["payload"]["memory_id"], "score": p["score"]}
            for p in response.get("points", [])
            if isinstance(p.get("payload", {}).get("memory_id"), str)
        ]

    async def delete_memory(memory_id: str) -> None:
        result = await client.collection_exists(collection_name)
        if not result["exists"]:
            return
        await client.delete(
            collection_name,
            {"wait": True, "points": [memory_point_id(memory_id)]},
        )

    async def delete_all_memories() -> None:
        result = await client.collection_exists(collection_name)
        if not result["exists"]:
            return
        await client.delete_collection(collection_name)
        collection_promise["value"] = None

    return {
        "deleteAllMemories": delete_all_memories,
        "deleteMemory": delete_memory,
        "indexMemory": index_memory,
        "searchMemories": search_memories,
    }


def get_qdrant_cloud_config(environment: dict | None = None) -> dict:
    environment = environment if environment is not None else dict(os.environ)
    url = str(environment.get("QDRANT_URL") or "").strip()
    api_key = str(environment.get("QDRANT_API_KEY") or "").strip()
    timeout_raw = environment.get("QDRANT_TIMEOUT_MS", "10000")
    try:
        timeout = int(timeout_raw)
    except (TypeError, ValueError):
        raise ValueError("QDRANT_TIMEOUT_MS must be a positive integer.")

    if not url:
        raise ValueError(
            "QDRANT_URL is required. Use the HTTPS REST endpoint from your Qdrant Cloud cluster."
        )
    if not api_key:
        raise ValueError(
            "QDRANT_API_KEY is required. Create a Database API key in Qdrant Cloud."
        )

    parsed = urlparse(url)
    if not parsed.scheme or not parsed.netloc:
        raise ValueError("QDRANT_URL must be a valid HTTPS URL.")
    if parsed.scheme != "https":
        raise ValueError("QDRANT_URL must use HTTPS for Qdrant Cloud.")
    if not isinstance(timeout, int) or timeout <= 0:
        raise ValueError("QDRANT_TIMEOUT_MS must be a positive integer.")

    normalized_url = url.rstrip("/")
    return {"url": normalized_url, "apiKey": api_key, "timeout": timeout}


def assert_atlas_mode_supported(environment: dict | None = None) -> str:
    environment = environment if environment is not None else dict(os.environ)
    mode = str(environment.get("ATLAS_MODE") or "local").strip().lower()
    if mode == "cloud":
        raise ValueError(
            "ATLAS_MODE=cloud is not available yet; managed Atlas cloud service support has not been implemented."
        )
    if mode != "local":
        raise ValueError(f'Invalid ATLAS_MODE "{mode}"; expected "local" or "cloud".')
    return mode


# --- LanceDB provider -------------------------------------------------------


def _escape_sql_string(value: str) -> str:
    return str(value).replace("'", "''")


def _validate_vector(vector, vector_size: int) -> None:
    if not isinstance(vector, (list, tuple)) and not hasattr(vector, "__buffer__"):
        raise ValueError("Embedding must be an array or typed array")
    length = len(vector)
    if length != vector_size:
        raise ValueError(
            f"Embedding has {length} dimensions; expected {vector_size}"
        )


class InMemoryLanceTable:
    """In-memory table that mimics the subset of LanceDB needed for tests."""

    def __init__(self, vector_size: int, embedding_model: str):
        self._vector_size = vector_size
        self._embedding_model = embedding_model
        self._rows: dict[str, dict] = {}
        self._lock = threading.RLock()

    @property
    def vector_size(self) -> int:
        return self._vector_size

    @property
    def embedding_model(self) -> str:
        return self._embedding_model

    def add(self, row: dict) -> None:
        with self._lock:
            self._rows[row["memory_id"]] = dict(row)

    def replace(self, row: dict) -> None:
        with self._lock:
            self._rows[row["memory_id"]] = dict(row)

    def delete(self, where_sql: str) -> None:
        # Accepts ``memory_id = 'value'`` where ``value`` may contain
        # doubled single quotes (the SQL escape for a literal ``'``).
        match = re.match(r"\s*memory_id\s*=\s*'((?:[^']|'')*)'\s*", where_sql)
        if not match:
            return
        target = match.group(1).replace("''", "'")
        with self._lock:
            self._rows.pop(target, None)

    def drop(self) -> None:
        with self._lock:
            self._rows.clear()

    def search(self, vector, *, limit: int) -> list[dict]:
        with self._lock:
            rows = list(self._rows.values())
        results = []
        for row in rows:
            v = row.get("vector") or []
            if len(v) != len(vector):
                continue
            distance = _cosine_distance(vector, list(v))
            results.append({"memory_id": row["memory_id"], "_distance": distance})
        results.sort(key=lambda r: r["_distance"])
        return results[:limit]


def _cosine_distance(a: Iterable[float], b: Iterable[float]) -> float:
    a_list = list(a)
    b_list = list(b)
    if len(a_list) != len(b_list):
        return 1.0
    dot = sum(x * y for x, y in zip(a_list, b_list))
    norm_a = math.sqrt(sum(x * x for x in a_list)) or 1.0
    norm_b = math.sqrt(sum(y * y for y in b_list)) or 1.0
    similarity = dot / (norm_a * norm_b)
    similarity = max(-1.0, min(1.0, similarity))
    return 1.0 - similarity


def create_lance_db_memory_vector_store(
    *,
    connection: Any = None,
    path: str = LANCEDB_PATH,
    table_name: str = LANCEDB_TABLE,
    embed: Optional[Callable] = None,
    vector_size: int = EMBEDDING_DIMENSIONS,
    embedding_model: str = EMBEDDING_MODEL,
) -> dict:
    if not isinstance(vector_size, int) or vector_size <= 0:
        raise ValueError("LanceDB vector size must be a positive integer")

    embed_fn = embed or (lambda text: embed_text(text))
    table_holder: dict = {"value": None, "in_flight": None}
    lock = threading.RLock()

    def get_table():
        with lock:
            if table_holder["value"] is not None:
                return table_holder["value"]
            if table_holder["in_flight"] is not None:
                return table_holder["in_flight"]
            def init_table():
                if connection is not None:
                    existing = connection.get(table_name)
                    if existing is not None:
                        table = existing
                    else:
                        table = InMemoryLanceTable(vector_size, embedding_model)
                        connection[table_name] = table
                else:
                    table = InMemoryLanceTable(vector_size, embedding_model)
                table_holder["value"] = table
                return table
            table_holder["in_flight"] = init_table()
            try:
                return table_holder["in_flight"]
            finally:
                table_holder["in_flight"] = None

    def validate_table(table: InMemoryLanceTable) -> InMemoryLanceTable:
        if table.vector_size != vector_size:
            raise ValueError(
                f'LanceDB table "{table_name}" uses {table.vector_size} dimensions; expected {vector_size}'
            )
        if table.embedding_model != embedding_model:
            raise ValueError(
                f'LanceDB table "{table_name}" uses embedding model "{table.embedding_model}"; expected "{embedding_model}"'
            )
        return table

    async def index_memory(memory: dict) -> None:
        if not memory.get("id"):
            raise ValueError("Memory ID is required for vector indexing")
        vector = await embed_fn(memory_embedding_text(memory))
        _validate_vector(vector, vector_size)
        table = validate_table(get_table())
        row = {
            "memory_id": str(memory["id"]),
            "vector": list(vector),
            "type": None if memory.get("type") is None else str(memory.get("type")),
            "title": None if memory.get("title") is None else str(memory.get("title")),
            "confidence": None if memory.get("confidence") is None else float(memory.get("confidence")),
            "tags": [str(t) for t in (memory.get("tags") or [])],
            "scope": "agent",
            "embedding_model": embedding_model,
            "source": str(memory.get("source") or "ui"),
            "ingestion_date": None if memory.get("ingestion_date") is None else str(memory.get("ingestion_date")),
            "created_at": None if memory.get("created_at") is None else str(memory.get("created_at")),
            "updated_at": None if memory.get("updated_at") is None else str(memory.get("updated_at")),
        }
        if row["memory_id"] in table._rows:
            table.replace(row)
        else:
            table.add(row)

    async def search_memories(query: str, options: dict | None = None) -> list[dict]:
        options = options or {}
        limit = options.get("limit", 10)
        score_threshold = options.get("scoreThreshold")
        vector = await embed_fn(query)
        _validate_vector(vector, vector_size)
        table = validate_table(get_table())
        rows = table.search(list(vector), limit=limit)
        hits = [
            {"id": r["memory_id"], "score": 1.0 - r["_distance"]}
            for r in rows
        ]
        if score_threshold is None:
            return hits
        return [h for h in hits if h["score"] >= score_threshold]

    async def delete_memory(memory_id: str) -> None:
        if connection is not None and table_name not in connection:
            return
        try:
            table = get_table()
        except Exception:
            return
        table.delete(f"memory_id = '{_escape_sql_string(memory_id)}'")

    async def delete_all_memories() -> None:
        if connection is not None and table_name not in connection:
            return
        with lock:
            table_holder["value"] = None

    return {
        "deleteAllMemories": delete_all_memories,
        "deleteMemory": delete_memory,
        "indexMemory": index_memory,
        "searchMemories": search_memories,
    }


# --- RRF fusion -------------------------------------------------------------


def fuse_with_rrf(
    vector_results: list[dict],
    bm25_results: list[dict],
    limit: int,
) -> list[dict]:
    """Reciprocal rank fusion of vector and BM25 ranked lists."""
    scores: dict[str, float] = {}
    for rank, hit in enumerate(vector_results or []):
        scores[hit["id"]] = scores.get(hit["id"], 0.0) + 1.0 / (RRF_K + rank + 1)
    for rank, hit in enumerate(bm25_results or []):
        scores[hit["id"]] = scores.get(hit["id"], 0.0) + 1.0 / (RRF_K + rank + 1)
    fused = sorted(
        ({"id": memory_id, "score": score} for memory_id, score in scores.items()),
        key=lambda item: item["score"],
        reverse=True,
    )
    return fused[:limit]


# --- Module-level convenience helpers --------------------------------------


def get_default_store(connection=None):
    """Return the default vector store (LanceDB-backed in-process table)."""
    return create_lance_db_memory_vector_store(connection=connection)


async def index_memory_vector(memory: dict) -> None:
    """Index a memory in the default vector store."""
    store = get_default_store()
    await store["indexMemory"](memory)


async def search_memory_vectors(query: str, options: dict | None = None) -> list[dict]:
    store = get_default_store()
    return await store["searchMemories"](query, options or {})


async def delete_memory_vector(memory_id: str) -> None:
    store = get_default_store()
    await store["deleteMemory"](memory_id)


async def delete_all_memory_vectors() -> None:
    store = get_default_store()
    await store["deleteAllMemories"]()


async def hybrid_search_memories(
    query: str,
    options: dict | None = None,
) -> list[dict]:
    """Hybrid search combining vector and BM25 ranked results."""
    options = options or {}
    limit = options.get("limit", 10)
    strategy = options.get("strategy", "hybrid")
    score_threshold = options.get("scoreThreshold")
    search_memories_fts = options.get("searchMemoriesFts")
    search_vectors = options.get("searchMemoryVectors") or search_memory_vectors

    if strategy == "bm25":
        if not search_memories_fts:
            return []
        results = search_memories_fts(query, {"limit": limit})
        if not score_threshold:
            return results
        max_score = max((r.get("score", 0) for r in results), default=0)
        if max_score == 0:
            return results
        return [r for r in results if abs(r["score"] / max_score) >= abs(score_threshold)]

    vector_results: list[dict] = []
    try:
        vector_results = await search_vectors(
            query, {"limit": max(limit * 3, 30), "scoreThreshold": score_threshold}
        )
    except Exception:
        vector_results = []

    bm25_results: list[dict] = []
    if search_memories_fts:
        try:
            bm25_results = search_memories_fts(query, {"limit": max(limit * 3, 30)})
        except Exception:
            bm25_results = []

    if strategy == "vector":
        return vector_results
    return fuse_with_rrf(vector_results, bm25_results, limit)
