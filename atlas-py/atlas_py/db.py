"""SQLite persistence layer for the Python port of Atlas.

Port of ``src/db.js`` covering the schema, migrations, and query
helpers exercised by the Python test suite. The schema mirrors the
Node version 1:1; FTS5 is used for keyword search, and region
activations store the mapping version that produced them so the
caller can rebuild legacy extractions safely.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import threading
import unicodedata
from contextlib import contextmanager
from typing import Any, Iterable, Optional

from .shared.region_mapper import (
    REGION_MAPPING_VERSION,
    map_extraction_to_regions,
)


_DEFAULT_DB_PATH = "engram.db"
_DB_PATH = os.environ.get("ENGRAM_DB_PATH", _DEFAULT_DB_PATH)
_lock = threading.RLock()
_connection: sqlite3.Connection | None = None


def _normalize_text(value: str | None) -> str:
    if value is None:
        return ""
    return (
        unicodedata.normalize("NFKC", str(value))
        .strip()
        .replace("\u00a0", " ")
    )


def _entity_key(canonical_name: str, kind: str) -> str:
    return f"{_normalize_text(canonical_name).casefold()}|{_normalize_text(kind).casefold()}"


def _alias_key(alias: str) -> str:
    return (
        unicodedata.normalize("NFKC", str(alias))
        .strip()
        .casefold()
    )


def _connect() -> sqlite3.Connection:
    global _connection
    with _lock:
        if _connection is not None:
            return _connection
        connection = sqlite3.connect(_DB_PATH, isolation_level=None, check_same_thread=False)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode = WAL")
        # connection.execute("PRAGMA foreign_keys = ON")  # JS doesn't enforce FKs
        _init_schema(connection)
        _connection = connection
        return connection


def get_db() -> sqlite3.Connection:
    return _connect()


def close_db() -> None:
    global _connection
    with _lock:
        if _connection is not None:
            _connection.close()
            _connection = None


@contextmanager
def _transaction():
    connection = get_db()
    connection.execute("BEGIN")
    try:
        yield connection
    except Exception:
        connection.execute("ROLLBACK")
        raise
    else:
        connection.execute("COMMIT")


def with_transaction(callback):
    with _transaction() as connection:
        return callback(connection)


# --- Schema -----------------------------------------------------------------

SCHEMA = """
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  raw_text TEXT NOT NULL,
  ingestion_date TEXT NOT NULL,
  summary TEXT,
  type TEXT NOT NULL DEFAULT 'fact',
  title TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 0.6,
  tags TEXT NOT NULL DEFAULT '[]',
  scope TEXT NOT NULL DEFAULT 'agent',
  source TEXT NOT NULL DEFAULT 'ui',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS memory_extractions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id TEXT NOT NULL,
  extraction_json TEXT NOT NULL,
  model TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  authoritative INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canonical_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('person', 'place', 'object', 'concept', 'organization')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(canonical_name, kind)
);

CREATE TABLE IF NOT EXISTS entity_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id INTEGER NOT NULL,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  canonical INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE,
  UNIQUE(entity_id, normalized_alias)
);

CREATE TABLE IF NOT EXISTS entity_resolution_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_entity_id INTEGER NOT NULL,
  target_entity_id INTEGER NOT NULL,
  source_name TEXT NOT NULL,
  target_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  observed_alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'merged', 'rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  CHECK (source_entity_id <> target_entity_id),
  UNIQUE(source_entity_id, target_entity_id)
);

CREATE TABLE IF NOT EXISTS memory_entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  mention TEXT NOT NULL,
  role TEXT,
  confidence REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
  FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE,
  UNIQUE(memory_id, entity_id, mention)
);

CREATE TABLE IF NOT EXISTS relationships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_entity_id INTEGER NOT NULL,
  target_entity_id INTEGER NOT NULL,
  predicate TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  evidence TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (source_entity_id) REFERENCES entities(id) ON DELETE CASCADE,
  FOREIGN KEY (target_entity_id) REFERENCES entities(id) ON DELETE CASCADE,
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
  UNIQUE(source_entity_id, target_entity_id, predicate, memory_id)
);

CREATE TABLE IF NOT EXISTS region_activations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id TEXT NOT NULL,
  region TEXT NOT NULL,
  weight REAL NOT NULL,
  left_weight REAL,
  right_weight REAL,
  mapping_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
  UNIQUE(memory_id, region, mapping_version)
);

CREATE TABLE IF NOT EXISTS memory_comparisons (
  left_memory_id TEXT NOT NULL,
  right_memory_id TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  model TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  comparison_json TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  PRIMARY KEY (left_memory_id, right_memory_id, input_hash, model, schema_version),
  FOREIGN KEY (left_memory_id) REFERENCES memories(id) ON DELETE CASCADE,
  FOREIGN KEY (right_memory_id) REFERENCES memories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS memory_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
  UNIQUE(memory_id, revision_number)
);

CREATE TABLE IF NOT EXISTS memory_sources (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  source TEXT NOT NULL,
  ingestion_date TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  extraction_status TEXT NOT NULL DEFAULT 'pending',
  extraction_attempts INTEGER NOT NULL DEFAULT 0,
  extraction_error TEXT,
  extraction_model TEXT,
  extraction_schema_version INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_revisions (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  text TEXT NOT NULL,
  author TEXT,
  reason TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (source_id) REFERENCES memory_sources(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS source_memory_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  source_revision_id TEXT,
  memory_id TEXT NOT NULL,
  action TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  extraction_model TEXT,
  extraction_schema_version INTEGER NOT NULL,
  decision_confidence REAL NOT NULL,
  decision_reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (source_id) REFERENCES memory_sources(id) ON DELETE CASCADE,
  FOREIGN KEY (source_revision_id) REFERENCES source_revisions(id) ON DELETE SET NULL,
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cognitive_annotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id TEXT NOT NULL,
  memory_version INTEGER NOT NULL,
  annotation_json TEXT NOT NULL,
  model TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
  UNIQUE(memory_id, memory_version, schema_version)
);

CREATE INDEX IF NOT EXISTS idx_extractions_memory_latest
  ON memory_extractions(memory_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_entities_kind ON entities(kind);
CREATE INDEX IF NOT EXISTS idx_entity_aliases_entity ON entity_aliases(entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_aliases_normalized ON entity_aliases(normalized_alias);
CREATE INDEX IF NOT EXISTS idx_memory_entities_memory ON memory_entities(memory_id);
CREATE INDEX IF NOT EXISTS idx_relationships_memory ON relationships(memory_id);
CREATE INDEX IF NOT EXISTS idx_region_activations_memory ON region_activations(memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_comparisons_left ON memory_comparisons(left_memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_comparisons_right ON memory_comparisons(right_memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_revisions_memory ON memory_revisions(memory_id, revision_number DESC);
CREATE INDEX IF NOT EXISTS idx_memories_source ON memories(source);
"""

FTS_SCHEMA = """
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  memory_id UNINDEXED,
  title,
  summary,
  raw_text,
  tags,
  tokenize='porter unicode61'
);
"""


def _init_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(SCHEMA)
    # ``title`` column migration: populate empty titles from raw_text.
    connection.execute(
        "UPDATE memories SET title = substr(raw_text, 1, 50) WHERE title = ''"
    )
    # ``left_weight``/``right_weight`` migration on region_activations.
    region_columns = [row["name"] for row in connection.execute("PRAGMA table_info(region_activations)").fetchall()]
    if "left_weight" not in region_columns:
        connection.execute("ALTER TABLE region_activations ADD COLUMN left_weight REAL")
    if "right_weight" not in region_columns:
        connection.execute("ALTER TABLE region_activations ADD COLUMN right_weight REAL")
    connection.executescript(FTS_SCHEMA)
    _merge_duplicate_entities(connection)
    sync_memories_to_fts(connection)


def _merge_duplicate_entities(connection: sqlite3.Connection) -> None:
    """Fold entities that share a normalized canonical name and kind."""

    rows = connection.execute(
        "SELECT id, canonical_name, kind FROM entities ORDER BY id"
    ).fetchall()
    canonical_ids: dict[str, int] = {}
    for entity in rows:
        key = f"{entity['kind']}:{_normalize_entity_key(entity['canonical_name'])}"
        existing = canonical_ids.get(key)
        if not existing:
            canonical_ids[key] = entity["id"]
            continue
        keep_id = existing
        drop_id = entity["id"]
        connection.execute(
            "UPDATE OR IGNORE memory_entities SET entity_id = ? WHERE entity_id = ?",
            (keep_id, drop_id),
        )
        connection.execute("DELETE FROM memory_entities WHERE entity_id = ?", (drop_id,))
        connection.execute(
            "UPDATE OR IGNORE entity_aliases SET entity_id = ? WHERE entity_id = ?",
            (keep_id, drop_id),
        )
        connection.execute("DELETE FROM entity_aliases WHERE entity_id = ?", (drop_id,))
        connection.execute(
            "UPDATE OR IGNORE relationships SET source_entity_id = ? WHERE source_entity_id = ?",
            (keep_id, drop_id),
        )
        connection.execute(
            "UPDATE OR IGNORE relationships SET target_entity_id = ? WHERE target_entity_id = ?",
            (keep_id, drop_id),
        )
        connection.execute(
            "UPDATE OR IGNORE entity_resolution_suggestions SET source_entity_id = ? WHERE source_entity_id = ?",
            (keep_id, drop_id),
        )
        connection.execute(
            "UPDATE OR IGNORE entity_resolution_suggestions SET target_entity_id = ? WHERE target_entity_id = ?",
            (keep_id, drop_id),
        )
        connection.execute("DELETE FROM entities WHERE id = ?", (drop_id,))
    return
    # The block below is unreachable but kept for reference parity with the
    # original naive implementation.
    duplicates = connection.execute(
        """
        SELECT MIN(id) AS keep_id, canonical_name, kind
        FROM entities
        GROUP BY canonical_name, kind
        HAVING COUNT(*) > 1
        """,
    ).fetchall()
    for row in duplicates:
        rows = connection.execute(
            "SELECT id FROM entities WHERE canonical_name = ? AND kind = ?",
            (row["canonical_name"], row["kind"]),
        ).fetchall()
        keep = min(item["id"] for item in rows)
        for item in rows:
            if item["id"] == keep:
                continue
            connection.execute(
                "UPDATE OR IGNORE memory_entities SET entity_id = ? WHERE entity_id = ?",
                (keep, item["id"]),
            )
            connection.execute(
                "DELETE FROM memory_entities WHERE entity_id = ?",
                (item["id"],),
            )
            connection.execute(
                "UPDATE OR IGNORE entity_aliases SET entity_id = ? WHERE entity_id = ?",
                (keep, item["id"]),
            )
            connection.execute(
                "DELETE FROM entity_aliases WHERE entity_id = ?",
                (item["id"],),
            )
            connection.execute(
                "UPDATE OR IGNORE relationships SET source_entity_id = ? WHERE source_entity_id = ?",
                (keep, item["id"]),
            )
            connection.execute(
                "UPDATE OR IGNORE relationships SET target_entity_id = ? WHERE target_entity_id = ?",
                (keep, item["id"]),
            )
            connection.execute(
                "UPDATE OR IGNORE entity_resolution_suggestions SET source_entity_id = ? WHERE source_entity_id = ?",
                (keep, item["id"]),
            )
            connection.execute(
                "UPDATE OR IGNORE entity_resolution_suggestions SET target_entity_id = ? WHERE target_entity_id = ?",
                (keep, item["id"]),
            )
            connection.execute("DELETE FROM entities WHERE id = ?", (item["id"],))


# --- Region helpers --------------------------------------------------------

def _region_activations_from_extraction(extraction: dict) -> list[dict]:
    return map_extraction_to_regions(extraction)


def save_region_activations(
    memory_id: str,
    activations: list[dict],
    *,
    mapping_version: int = REGION_MAPPING_VERSION,
    connection: sqlite3.Connection | None = None,
) -> None:
    conn = connection or get_db()
    # Replace any existing activations for this memory at this version.
    conn.execute(
        "DELETE FROM region_activations WHERE memory_id = ? AND mapping_version = ?",
        (memory_id, mapping_version),
    )
    for activation in activations:
        left = (activation.get("hemispheres") or {}).get("left")
        right = (activation.get("hemispheres") or {}).get("right")
        conn.execute(
            "INSERT INTO region_activations (memory_id, region, weight, left_weight, right_weight, mapping_version) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (
                memory_id,
                activation["region"],
                activation["weight"],
                left,
                right,
                mapping_version,
            ),
        )


def get_region_activations(memory_id: str) -> list[dict]:
    rows = get_db().execute(
        "SELECT region, weight, left_weight, right_weight, mapping_version "
        "FROM region_activations WHERE memory_id = ? "
        "ORDER BY mapping_version DESC, weight DESC, region ASC",
        (memory_id,),
    ).fetchall()
    return [
        {
            "region": row["region"],
            "weight": row["weight"],
            "mapping_version": row["mapping_version"],
            "hemispheres": {
                "left": row["left_weight"],
                "right": row["right_weight"],
            } if row["left_weight"] is not None or row["right_weight"] is not None else None,
        }
        for row in rows
    ]


def backfill_region_activations(connection: sqlite3.Connection | None = None) -> int:
    """Create region activations for memories that have none for the current mapping version."""

    conn = connection or get_db()
    rows = conn.execute(
        """
        SELECT m.id, me.extraction_json
        FROM memories AS m
        JOIN memory_extractions AS me ON me.memory_id = m.id
        WHERE NOT EXISTS (
          SELECT 1 FROM region_activations ra
          WHERE ra.memory_id = m.id AND ra.mapping_version = ?
        )
        """,
        (REGION_MAPPING_VERSION,),
    ).fetchall()
    created = 0
    for row in rows:
        try:
            extraction = json.loads(row["extraction_json"])
        except json.JSONDecodeError:
            continue
        activations = _region_activations_from_extraction(extraction)
        if not activations:
            continue
        save_region_activations(row["id"], activations, connection=conn)
        created += 1
    return created

# --- Memory CRUD ------------------------------------------------------------

def _now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def create_memory(memory: dict) -> None:
    """Create or update a memory row from the given fields."""

    db = get_db()
    db.execute(
        """
        INSERT INTO memories (
          id, raw_text, ingestion_date, summary, type, title, confidence, tags,
          scope, source, version, created_at, updated_at
        ) VALUES (
          :id, :raw_text, :ingestion_date, :summary, :type, :title, :confidence, :tags,
          :scope, :source, :version, :created_at, :updated_at
        )
        ON CONFLICT(id) DO UPDATE SET
          raw_text = excluded.raw_text,
          ingestion_date = excluded.ingestion_date,
          summary = excluded.summary,
          type = excluded.type,
          title = excluded.title,
          confidence = excluded.confidence,
          tags = excluded.tags,
          scope = excluded.scope,
          source = excluded.source,
          version = excluded.version,
          updated_at = excluded.updated_at
        """,
        memory,
    )


def store_memory(
    memory_id: str,
    raw_text: str,
    ingestion_date: str,
    extraction: dict,
    model: str,
    source: str = "ui",
    options: dict | None = None,
    *,
    schema_version: int = 1,
) -> None:
    options = options or {}
    extraction = dict(extraction or {})
    extraction.setdefault("summary", "")
    db = get_db()
    title_seed = options.get("title") or raw_text
    title = str(title_seed)[:50] if title_seed else ""
    summary = str(extraction.get("summary") or options.get("summary") or "")
    tags = options.get("tags") or []
    confidence = options.get("confidence", 0.6)
    memory_type = options.get("type", "fact")
    now = _now()
    db.execute("BEGIN")
    try:
        db.execute(
            """
            INSERT INTO memories (
              id, raw_text, ingestion_date, summary, type, title,
              confidence, tags, scope, source, version, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              raw_text = excluded.raw_text,
              ingestion_date = excluded.ingestion_date,
              summary = excluded.summary,
              type = excluded.type,
              title = excluded.title,
              confidence = excluded.confidence,
              tags = excluded.tags,
              source = excluded.source,
              version = memories.version + 1,
              updated_at = excluded.updated_at
            """,
            (
                memory_id,
                raw_text,
                ingestion_date,
                summary,
                memory_type,
                title,
                confidence,
                json.dumps(tags),
                options.get("scope", "agent"),
                source,
                now,
                now,
            ),
        )
        db.execute(
            "INSERT INTO memory_extractions (memory_id, extraction_json, model, schema_version, authoritative) "
            "VALUES (?, ?, ?, ?, 1)",
            (memory_id, json.dumps(extraction), model, schema_version),
        )
        save_region_activations(memory_id, _region_activations_from_extraction(extraction), connection=db)
        _persist_derived_memory_graph(memory_id, extraction, connection=db)
        index_memory_fts(memory_id, connection=db)
        db.execute("COMMIT")
    except Exception:
        db.execute("ROLLBACK")
        raise


def get_memory(memory_id: str) -> dict | None:
    row = get_db().execute(
        """
        SELECT id, raw_text, ingestion_date, summary, type, title, confidence,
               tags, scope, source, version, created_at, updated_at
        FROM memories WHERE id = ?
        """,
        (memory_id,),
    ).fetchone()
    if row is None:
        return None
    return _row_to_memory(row)


def _row_to_memory(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "raw_text": row["raw_text"],
        "ingestion_date": row["ingestion_date"],
        "summary": row["summary"],
        "type": row["type"],
        "title": row["title"],
        "confidence": row["confidence"],
        "tags": json.loads(row["tags"] or "[]"),
        "scope": row["scope"],
        "source": row["source"],
        "version": row["version"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def get_memories_by_ids(ids: Iterable[str]) -> list[dict]:
    rows = list(ids or [])
    if not rows:
        return []
    placeholders = ",".join("?" for _ in rows)
    result = get_db().execute(
        f"SELECT * FROM memories WHERE id IN ({placeholders})",
        rows,
    ).fetchall()
    return [_row_to_memory(row) for row in result]


def get_memories(
    *,
    limit: int = 100,
    offset: int = 0,
    source: str | None = None,
) -> list[dict]:
    db = get_db()
    if source:
        rows = db.execute(
            "SELECT * FROM memories WHERE source = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
            (source, limit, offset),
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT * FROM memories ORDER BY created_at DESC LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()
    return [_row_to_memory(row) for row in rows]


def get_memory_catalog(
    *,
    limit: int = 25,
    offset: int = 0,
    source: str | None = None,
    sort: str = "created_at",
    order: str = "desc",
    types: list[str] | None = None,
    region: str | None = None,
    entity_id: int | None = None,
    query: str | None = None,
) -> dict:
    db = get_db()
    where: list[str] = []
    params: list[Any] = []
    joins = []
    if source and source != "all":
        where.append("m.source = ?")
        params.append(source)
    if types:
        placeholders = ",".join("?" for _ in types)
        where.append(f"m.type IN ({placeholders})")
        params.extend(types)
    if region:
        joins.append("JOIN region_activations ra ON ra.memory_id = m.id")
        where.append("ra.region = ?")
        params.append(region)
    if entity_id is not None:
        joins.append("JOIN memory_entities me ON me.memory_id = m.id")
        where.append("me.entity_id = ?")
        params.append(entity_id)
    if query:
        like = f"%{query}%"
        where.append(
            "(m.title LIKE ? OR m.summary LIKE ? OR m.raw_text LIKE ?"
            " OR EXISTS (SELECT 1 FROM memory_entities qme"
            " JOIN entities qe ON qe.id = qme.entity_id"
            " WHERE qme.memory_id = m.id"
            " AND (qe.canonical_name LIKE ?"
            " OR EXISTS (SELECT 1 FROM entity_aliases qea"
            " WHERE qea.entity_id = qe.id AND qea.alias LIKE ?))))"
        )
        params.extend([like, like, like, like, like])
    sort_columns = {
        "created_at": "m.created_at",
        "title": "m.title",
        "raw_text": "m.raw_text",
    }
    sort_column = sort_columns.get(sort, "m.created_at")
    sort_order = "DESC" if order.lower() == "desc" else "ASC"
    where_clause = f"WHERE {' AND '.join(where)}" if where else ""
    join_clause = " ".join(joins)
    rows = db.execute(
        f"SELECT DISTINCT m.* FROM memories m {join_clause} {where_clause} "
        f"ORDER BY {sort_column} {sort_order}, m.id ASC LIMIT ? OFFSET ?",
        (*params, limit, offset),
    ).fetchall()
    total_row = db.execute(
        f"SELECT COUNT(DISTINCT m.id) AS total FROM memories m {join_clause} {where_clause}",
        params,
    ).fetchone()
    total = total_row["total"] if total_row else 0
    items = []
    for row in rows:
        memory = _row_to_memory(row)
        memory["entities"] = get_entities_for_memory(memory["id"])
        items.append(memory)
    return {
        "items": items,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


def get_memory_revisions(memory_id: str) -> list[dict]:
    rows = get_db().execute(
        "SELECT id, revision_number, snapshot_json, created_at FROM memory_revisions "
        "WHERE memory_id = ? ORDER BY revision_number DESC",
        (memory_id,),
    ).fetchall()
    return [
        {
            "id": row["id"],
            "revision_number": row["revision_number"],
            "snapshot": json.loads(row["snapshot_json"]),
            "created_at": row["created_at"],
        }
        for row in rows
    ]


def delete_memory(memory_id: str) -> None:
    db = get_db()
    db.execute("DELETE FROM region_activations WHERE memory_id = ?", (memory_id,))
    db.execute("DELETE FROM memory_entities WHERE memory_id = ?", (memory_id,))
    db.execute("DELETE FROM relationships WHERE memory_id = ?", (memory_id,))
    db.execute("DELETE FROM memory_extractions WHERE memory_id = ?", (memory_id,))
    db.execute("DELETE FROM memory_revisions WHERE memory_id = ?", (memory_id,))
    db.execute("DELETE FROM memory_comparisons WHERE left_memory_id = ? OR right_memory_id = ?", (memory_id, memory_id))
    db.execute("DELETE FROM memory_sources WHERE id = ?", (memory_id,))
    db.execute("DELETE FROM source_revisions WHERE source_id = ?", (memory_id,))
    db.execute("DELETE FROM memories WHERE id = ?", (memory_id,))
    remove_memory_fts(memory_id, connection=db)


def delete_all_memories() -> None:
    db = get_db()
    db.execute("DELETE FROM memories")
    db.execute("DELETE FROM memory_extractions")
    db.execute("DELETE FROM region_activations")
    db.execute("DELETE FROM memory_entities")
    db.execute("DELETE FROM relationships")
    db.execute("DELETE FROM memory_revisions")
    db.execute("DELETE FROM memory_comparisons")
    db.execute("DELETE FROM memory_sources")
    db.execute("DELETE FROM source_revisions")
    db.execute("DELETE FROM source_memory_links")
    db.execute("DELETE FROM cognitive_annotations")
    db.execute("DELETE FROM memories_fts")


def delete_all_entities() -> None:
    db = get_db()
    db.execute("DELETE FROM entity_resolution_suggestions")
    db.execute("DELETE FROM relationships")
    db.execute("DELETE FROM memory_entities")
    db.execute("DELETE FROM entity_aliases")
    db.execute("DELETE FROM entities")


# --- Extractions -----------------------------------------------------------

def save_extraction(
    memory_id: str,
    extraction: dict,
    model: str,
    schema_version: int = 1,
    *,
    authoritative: bool = False,
    connection: sqlite3.Connection | None = None,
) -> int:
    conn = connection or get_db()
    cursor = conn.execute(
        "INSERT INTO memory_extractions (memory_id, extraction_json, model, schema_version, authoritative) "
        "VALUES (?, ?, ?, ?, ?)",
        (memory_id, json.dumps(extraction), model, schema_version, int(authoritative)),
    )
    return cursor.lastrowid


def get_extractions(memory_id: str) -> list[dict]:
    rows = get_db().execute(
        "SELECT id, extraction_json, model, schema_version, authoritative, created_at "
        "FROM memory_extractions WHERE memory_id = ? ORDER BY created_at DESC, id DESC",
        (memory_id,),
    ).fetchall()
    return [
        {
            "id": row["id"],
            "memory_id": memory_id,
            "extraction": json.loads(row["extraction_json"]),
            "model": row["model"],
            "schema_version": row["schema_version"],
            "authoritative": bool(row["authoritative"]),
            "created_at": row["created_at"],
        }
        for row in rows
    ]


def get_latest_extraction(memory_id: str) -> dict | None:
    row = get_db().execute(
        "SELECT id, extraction_json, model, schema_version, authoritative, created_at "
        "FROM memory_extractions WHERE memory_id = ? "
        "ORDER BY authoritative DESC, created_at DESC, id DESC LIMIT 1",
        (memory_id,),
    ).fetchone()
    if row is None:
        return None
    return {
        "id": row["id"],
        "memory_id": memory_id,
        "extraction": json.loads(row["extraction_json"]),
        "model": row["model"],
        "schema_version": row["schema_version"],
        "authoritative": bool(row["authoritative"]),
        "created_at": row["created_at"],
    }


def set_extraction_authoritative(extraction_id: int) -> None:
    db = get_db()
    db.execute("UPDATE memory_extractions SET authoritative = 0")
    db.execute(
        "UPDATE memory_extractions SET authoritative = 1 WHERE id = ?",
        (extraction_id,),
    )


# --- Entity resolution -----------------------------------------------------

def upsert_entity(canonical_name: str, kind: str) -> int:
    canonical_name = _normalize_entity_name(canonical_name)
    kind = _normalize_entity_name(kind)
    if kind not in {"person", "place", "object", "concept", "organization"}:
        raise ValueError(f"unsupported entity kind: {kind}")
    db = get_db()
    matches = _find_exact_entity_matches(canonical_name, kind)
    if len(matches) == 1:
        add_entity_alias(matches[0]["id"], canonical_name, canonical=True)
        return matches[0]["id"]
    cursor = db.execute(
        "INSERT INTO entities (canonical_name, kind) VALUES (?, ?)",
        (canonical_name, kind),
    )
    entity_id = cursor.lastrowid
    add_entity_alias(entity_id, canonical_name, canonical=True)
    return entity_id


def get_entity(entity_id: int) -> dict | None:
    row = get_db().execute(
        "SELECT id, canonical_name, kind, created_at FROM entities WHERE id = ?",
        (entity_id,),
    ).fetchone()
    if row is None:
        return None
    return {"id": row["id"], "canonical_name": row["canonical_name"], "kind": row["kind"], "created_at": row["created_at"]}


def find_entities(query: str) -> list[dict]:
    query = (query or "").strip()
    if not query:
        return get_db().execute(
            "SELECT id, canonical_name, kind, created_at FROM entities ORDER BY canonical_name COLLATE NOCASE"
        ).fetchall()
    normalized = _alias_key(query)
    pattern = f"%{query}%"
    return get_db().execute(
        """
        SELECT DISTINCT e.id, e.canonical_name, e.kind, e.created_at
        FROM entities e
        LEFT JOIN entity_aliases a ON a.entity_id = e.id
        WHERE e.canonical_name LIKE ?
           OR e.canonical_name LIKE ? COLLATE NOCASE
           OR a.normalized_alias = ?
        ORDER BY e.canonical_name COLLATE NOCASE
        """,
        (pattern, pattern, normalized),
    ).fetchall()


def _add_alias(entity_id: int, alias: str, canonical: bool = False) -> None:
    normalized = _alias_key(alias)
    if not normalized:
        return
    db = get_db()
    db.execute(
        "INSERT OR IGNORE INTO entity_aliases (entity_id, alias, normalized_alias, canonical) "
        "VALUES (?, ?, ?, ?)",
        (entity_id, alias, normalized, int(canonical)),
    )


def get_entity_aliases(entity_id: int) -> list[dict]:
    rows = get_db().execute(
        "SELECT id, alias, normalized_alias, canonical, created_at FROM entity_aliases "
        "WHERE entity_id = ? ORDER BY canonical DESC, alias COLLATE NOCASE",
        (entity_id,),
    ).fetchall()
    return [
        {
            "id": row["id"],
            "alias": row["alias"],
            "normalized_alias": row["normalized_alias"],
            "canonical": bool(row["canonical"]),
            "created_at": row["created_at"],
        }
        for row in rows
    ]


def get_entities_for_memory(memory_id: str) -> list[dict]:
    rows = get_db().execute(
        """
        SELECT e.id, e.canonical_name, e.kind, me.mention, me.role, me.confidence
        FROM memory_entities me
        JOIN entities e ON e.id = me.entity_id
        WHERE me.memory_id = ?
        ORDER BY e.canonical_name COLLATE NOCASE
        """,
        (memory_id,),
    ).fetchall()
    return [
        {
            "id": row["id"],
            "canonical_name": row["canonical_name"],
            "kind": row["kind"],
            "mention": row["mention"],
            "role": row["role"],
            "confidence": row["confidence"],
        }
        for row in rows
    ]


def get_memories_for_entity(entity_id: int) -> list[dict]:
    rows = get_db().execute(
        """
        SELECT m.* FROM memories m
        JOIN memory_entities me ON me.memory_id = m.id
        WHERE me.entity_id = ?
        ORDER BY m.created_at DESC
        """,
        (entity_id,),
    ).fetchall()
    return [_row_to_memory(row) for row in rows]


def link_memory_to_entity(
    memory_id: str,
    entity_id: int,
    mention: str,
    role: str | None = None,
    confidence: float = 1.0,
) -> None:
    db = get_db()
    db.execute(
        "INSERT OR IGNORE INTO memory_entities (memory_id, entity_id, mention, role, confidence) "
        "VALUES (?, ?, ?, ?, ?)",
        (memory_id, entity_id, mention, role, confidence),
    )


def add_relationship(
    source_entity_id: int,
    target_entity_id: int,
    predicate: str,
    memory_id: str,
    confidence: float = 1.0,
    evidence: str | None = None,
) -> None:
    db = get_db()
    db.execute(
        "INSERT OR IGNORE INTO relationships (source_entity_id, target_entity_id, predicate, memory_id, confidence, evidence) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (source_entity_id, target_entity_id, predicate, memory_id, confidence, evidence),
    )


def get_relationships_for_memory(memory_id: str) -> list[dict]:
    rows = get_db().execute(
        """
        SELECT r.id, r.predicate, r.confidence, r.evidence,
               s.id AS source_id, s.canonical_name AS source_name, s.kind AS source_kind,
               t.id AS target_id, t.canonical_name AS target_name, t.kind AS target_kind
        FROM relationships r
        JOIN entities s ON s.id = r.source_entity_id
        JOIN entities t ON t.id = r.target_entity_id
        WHERE r.memory_id = ?
        ORDER BY r.id
        """,
        (memory_id,),
    ).fetchall()
    return [
        {
            "id": row["id"],
            "predicate": row["predicate"],
            "confidence": row["confidence"],
            "evidence": row["evidence"],
            "source": {"id": row["source_id"], "canonical_name": row["source_name"], "kind": row["source_kind"]},
            "target": {"id": row["target_id"], "canonical_name": row["target_name"], "kind": row["target_kind"]},
        }
        for row in rows
    ]


def get_relationships_for_entity(entity_id: int) -> list[dict]:
    rows = get_db().execute(
        """
        SELECT r.id, r.predicate, r.confidence, r.evidence, r.memory_id,
               s.id AS source_id, s.canonical_name AS source_name, s.kind AS source_kind,
               t.id AS target_id, t.canonical_name AS target_name, t.kind AS target_kind
        FROM relationships r
        JOIN entities s ON s.id = r.source_entity_id
        JOIN entities t ON t.id = r.target_entity_id
        WHERE r.source_entity_id = ? OR r.target_entity_id = ?
        ORDER BY r.id
        """,
        (entity_id, entity_id),
    ).fetchall()
    return [
        {
            "id": row["id"],
            "predicate": row["predicate"],
            "confidence": row["confidence"],
            "evidence": row["evidence"],
            "memory_id": row["memory_id"],
            "source": {"id": row["source_id"], "canonical_name": row["source_name"], "kind": row["source_kind"]},
            "target": {"id": row["target_id"], "canonical_name": row["target_name"], "kind": row["target_kind"]},
        }
        for row in rows
    ]


def get_structural_memory_links(memory_id: str) -> list[dict]:
    """Return related memories that share entities or relationships with ``memory_id``."""

    db = get_db()
    entity_rows = db.execute(
        "SELECT entity_id FROM memory_entities WHERE memory_id = ?",
        (memory_id,),
    ).fetchall()
    if not entity_rows:
        return []
    entity_ids = [row["entity_id"] for row in entity_rows]
    placeholders = ",".join("?" for _ in entity_ids)
    candidates = db.execute(
        "SELECT DISTINCT me.memory_id, m.raw_text, m.summary "
        "FROM memory_entities me "
        "JOIN memories m ON m.id = me.memory_id "
        "WHERE me.entity_id IN (" + placeholders + ") "
        "AND me.memory_id != ?",
        (*entity_ids, memory_id),
    ).fetchall()
    relationship_rows = db.execute(
        """
        SELECT r.predicate, r.evidence, s.canonical_name AS subject, t.canonical_name AS object
        FROM relationships r
        JOIN entities s ON s.id = r.source_entity_id
        JOIN entities t ON t.id = r.target_entity_id
        WHERE r.memory_id = ?
        """,
        (memory_id,),
    ).fetchall()
    predicates = [
        {
            "subject": row["subject"],
            "predicate": row["predicate"],
            "object": row["object"],
            "evidence": row["evidence"],
        }
        for row in relationship_rows
    ]
    links = []
    for row in candidates:
        candidate_entities = db.execute(
            "SELECT e.id, e.canonical_name, e.kind "
            "FROM memory_entities me "
            "JOIN entities e ON e.id = me.entity_id "
            "WHERE me.memory_id = ? AND me.entity_id IN (" + placeholders + ")",
            (row["memory_id"], *entity_ids),
        ).fetchall()
        links.append({
            "memory_id": row["memory_id"],
            "shared_entities": [
                {"id": entity["id"], "canonical_name": entity["canonical_name"], "kind": entity["kind"]}
                for entity in candidate_entities
            ],
            "shared_relationships": list(predicates),
        })
    return links


def get_entity_resolution_suggestions(*, status: str = "pending") -> list[dict]:
    rows = get_db().execute(
        """
        SELECT id, source_entity_id, target_entity_id, source_name, target_name,
               kind, observed_alias, normalized_alias, status, created_at, resolved_at
        FROM entity_resolution_suggestions
        WHERE status = ?
        ORDER BY created_at DESC
        """,
        (status,),
    ).fetchall()
    return [dict(row) for row in rows]


def resolve_entity_resolution_suggestion(suggestion_id: int, decision: str) -> None:
    if decision not in {"merged", "rejected"}:
        raise ValueError("decision must be 'merged' or 'rejected'")
    db = get_db()
    row = db.execute(
        "SELECT * FROM entity_resolution_suggestions WHERE id = ?",
        (suggestion_id,),
    ).fetchone()
    if row is None:
        return
    if decision == "merged":
        # Reassign references and aliases to the source entity, then delete target.
        source_id = row["source_entity_id"]
        target_id = row["target_entity_id"]
        db.execute(
            "UPDATE OR IGNORE memory_entities SET entity_id = ? WHERE entity_id = ?",
            (source_id, target_id),
        )
        db.execute("DELETE FROM memory_entities WHERE entity_id = ?", (target_id,))
        db.execute(
            "UPDATE OR IGNORE entity_aliases SET entity_id = ? WHERE entity_id = ?",
            (source_id, target_id),
        )
        db.execute("DELETE FROM entity_aliases WHERE entity_id = ?", (target_id,))
        db.execute(
            "UPDATE OR IGNORE relationships SET source_entity_id = ? WHERE source_entity_id = ?",
            (source_id, target_id),
        )
        db.execute(
            "UPDATE OR IGNORE relationships SET target_entity_id = ? WHERE target_entity_id = ?",
            (source_id, target_id),
        )
        db.execute("DELETE FROM entities WHERE id = ?", (target_id,))
    db.execute(
        "UPDATE entity_resolution_suggestions SET status = ?, resolved_at = ? WHERE id = ?",
        (decision, _now(), suggestion_id),
    )


def get_entity_catalog(
    *,
    limit: int = 25,
    offset: int = 0,
    query: str | None = None,
    kind: str | None = None,
    sort: str = "canonical_name",
    order: str = "asc",
) -> dict:
    db = get_db()
    where: list[str] = []
    params: list[Any] = []
    if kind:
        where.append("e.kind = ?")
        params.append(kind)
    if query:
        where.append("(e.canonical_name LIKE ? COLLATE NOCASE OR a.normalized_alias = ?)")
        params.extend([f"%{query}%", _alias_key(query)])
    where_clause = f"WHERE {' AND '.join(where)}" if where else ""
    sort_columns = {
        "canonical_name": "e.canonical_name COLLATE NOCASE",
        "kind": "e.kind",
        "memory_count": "memory_count",
    }
    sort_clause = sort_columns.get(sort, "e.canonical_name COLLATE NOCASE")
    order_clause = "DESC" if order.lower() == "desc" else "ASC"
    rows = db.execute(
        "SELECT e.id, e.canonical_name, e.kind, "
        "(SELECT COUNT(*) FROM memory_entities me WHERE me.entity_id = e.id) AS memory_count, "
        "(SELECT COUNT(*) FROM relationships r WHERE r.source_entity_id = e.id OR r.target_entity_id = e.id) AS relationship_count "
        "FROM entities e "
        "LEFT JOIN entity_aliases a ON a.entity_id = e.id "
        + where_clause + " "
        "GROUP BY e.id "
        "ORDER BY " + sort_clause + " " + order_clause + ", e.id ASC "
        "LIMIT ? OFFSET ?",
        (*params, limit, offset),
    ).fetchall()
    items = [
        {
            "id": row["id"],
            "canonical_name": row["canonical_name"],
            "kind": row["kind"],
            "memory_count": row["memory_count"],
            "relationship_count": row["relationship_count"],
        }
        for row in rows
    ]
    return {"items": items, "total": len(items), "limit": limit, "offset": offset}


# --- FTS5 -------------------------------------------------------------------

def _fts_row(memory_id: str) -> dict | None:
    memory = get_memory(memory_id)
    if memory is None:
        return None
    return {
        "memory_id": memory["id"],
        "title": memory.get("title") or "",
        "summary": memory.get("summary") or "",
        "raw_text": memory.get("raw_text") or "",
        "tags": " ".join(memory.get("tags") or []),
    }


def index_memory_fts(memory_id: str, *, connection: sqlite3.Connection | None = None) -> None:
    conn = connection or get_db()
    row = _fts_row(memory_id)
    if row is None:
        return
    conn.execute("DELETE FROM memories_fts WHERE memory_id = ?", (memory_id,))
    conn.execute(
        "INSERT INTO memories_fts (memory_id, title, summary, raw_text, tags) "
        "VALUES (:memory_id, :title, :summary, :raw_text, :tags)",
        row,
    )


def remove_memory_fts(memory_id: str, *, connection: sqlite3.Connection | None = None) -> None:
    conn = connection or get_db()
    conn.execute("DELETE FROM memories_fts WHERE memory_id = ?", (memory_id,))


def sync_memories_to_fts(connection: sqlite3.Connection | None = None) -> None:
    conn = connection or get_db()
    conn.execute("DELETE FROM memories_fts")
    for row in conn.execute("SELECT id FROM memories").fetchall():
        index_memory_fts(row["id"], connection=conn)


def _build_fts_query(query: str) -> str:
    terms = [t for t in (query or "").split() if t]
    if not terms:
        return ""
    parts = []
    for term in terms:
        clean = term.replace('"', '""')
        parts.append(f'"{clean}"')
    return " OR ".join(parts)


def search_memories_fts(query: str, *, limit: int = 20) -> list[dict]:
    fts_query = _build_fts_query(query)
    if not fts_query:
        return []
    db = get_db()
    try:
        rows = db.execute(
            """
            SELECT memory_id, bm25(memories_fts) AS rank
            FROM memories_fts
            WHERE memories_fts MATCH ?
            ORDER BY rank ASC
            LIMIT ?
            """,
            (fts_query, limit),
        ).fetchall()
    except Exception:
        return []
    return [
        {"id": row["memory_id"], "score": -row["rank"]}
        for row in rows
    ]


def search_memories(query: str, *, limit: int = 20) -> list[dict]:
    """Local text search across raw_text, summary, and tags."""

    query = (query or "").strip().lower()
    if not query:
        return get_memories(limit=limit)
    rows = get_db().execute(
        """
        SELECT * FROM memories
        WHERE LOWER(raw_text) LIKE ?
           OR LOWER(IFNULL(summary, '')) LIKE ?
           OR LOWER(tags) LIKE ?
        ORDER BY created_at DESC
        LIMIT ?
        """,
        (f"%{query}%", f"%{query}%", f"%{query}%", limit),
    ).fetchall()
    return [_row_to_memory(row) for row in rows]


# --- Memory comparison ----------------------------------------------------

def save_memory_comparison(
    left_memory_id: str,
    right_memory_id: str,
    input_hash: str,
    comparison: dict,
    model: str,
    schema_version: int,
) -> None:
    db = get_db()
    db.execute(
        "DELETE FROM memory_comparisons "
        "WHERE left_memory_id = ? AND right_memory_id = ? "
        "AND model = ? AND schema_version = ?",
        (left_memory_id, right_memory_id, model, schema_version),
    )
    db.execute(
        """
        INSERT INTO memory_comparisons (
          left_memory_id, right_memory_id, input_hash, model, schema_version, comparison_json, generated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            left_memory_id,
            right_memory_id,
            input_hash,
            model,
            schema_version,
            json.dumps(comparison),
            _now(),
        ),
    )


def get_memory_comparison(
    left_memory_id: str,
    right_memory_id: str,
    input_hash: str,
    *,
    model: str | None = None,
    schema_version: int | None = None,
) -> dict | None:
    where = ["left_memory_id = ?", "right_memory_id = ?", "input_hash = ?"]
    params: list[Any] = [left_memory_id, right_memory_id, input_hash]
    if model is not None:
        where.append("model = ?")
        params.append(model)
    if schema_version is not None:
        where.append("schema_version = ?")
        params.append(schema_version)
    row = get_db().execute(
        f"SELECT comparison_json FROM memory_comparisons WHERE {' AND '.join(where)} "
        "ORDER BY generated_at DESC LIMIT 1",
        params,
    ).fetchone()
    if row is None:
        return None
    return json.loads(row["comparison_json"])


# --- Memory graph ---------------------------------------------------------

def update_memory_graph(
    memory_id: str,
    *,
    extraction: dict,
    entities: list[dict] | None = None,
    relationships: list[dict] | None = None,
    model: str = "test-model",
    schema_version: int = 1,
) -> int:
    db = get_db()
    db.execute("BEGIN")
    try:
        cursor = db.execute(
            "SELECT COALESCE(MAX(revision_number), 0) + 1 AS next FROM memory_revisions WHERE memory_id = ?",
            (memory_id,),
        )
        revision_number = cursor.fetchone()["next"]
        # Use entities/relationships from extraction if not provided.
        if entities is None:
            entities = extraction.get("entities") or []
        if relationships is None:
            relationships = extraction.get("relationships") or []
        snapshot = {
            "memory_id": memory_id,
            "extraction": extraction,
            "entities": entities,
            "relationships": relationships,
        }
        db.execute(
            "INSERT INTO memory_revisions (memory_id, revision_number, snapshot_json, created_at) "
            "VALUES (?, ?, ?, ?)",
            (memory_id, revision_number, json.dumps(snapshot), _now()),
        )
        # Replace entities and relationships for the memory.
        db.execute("DELETE FROM memory_entities WHERE memory_id = ?", (memory_id,))
        db.execute("DELETE FROM relationships WHERE memory_id = ?", (memory_id,))
        for entity in entities:
            canonical = entity.get("canonical_name") or entity.get("mention")
            entity_id = resolve_entity_for_extraction(
                canonical_name=canonical,
                mention=entity.get("mention"),
                kind=entity.get("kind", "concept"),
            )
            link_memory_to_entity(
                memory_id,
                entity_id,
                entity.get("mention") or canonical,
                None,
                entity.get("confidence", 1.0),
            )
        for relationship in relationships:
            src_name = relationship.get("subject")
            tgt_name = relationship.get("object")
            subject = resolve_entity_for_extraction(
                canonical_name=src_name, mention=src_name, kind="concept"
            )
            object_entity = resolve_entity_for_extraction(
                canonical_name=tgt_name, mention=tgt_name, kind="concept"
            )
            add_relationship(
                subject,
                object_entity,
                relationship.get("predicate", "related_to"),
                memory_id,
                relationship.get("confidence", 1.0),
                relationship.get("evidence"),
            )
        # Persist a new extraction row.
        save_extraction(memory_id, extraction, model, schema_version, authoritative=True, connection=db)
        save_region_activations(memory_id, _region_activations_from_extraction(extraction), connection=db)
        db.execute("COMMIT")
        return revision_number
    except Exception:
        db.execute("ROLLBACK")
        raise


# --- Summary / search helpers ---------------------------------------------

def update_memory_summary(memory_id: str, summary: str) -> None:
    get_db().execute(
        "UPDATE memories SET summary = ?, updated_at = ? WHERE id = ?",
        (summary, _now(), memory_id),
    )


def audit_memory_integrity() -> dict:
    return {"checked_at": _now()}


GENERIC_ENTITY_ALIASES = {
    "he", "her", "hers", "herself", "him", "himself", "i", "it", "itself",
    "colleague", "company", "concept", "coworker", "friend", "girl", "guy",
    "man", "me", "myself", "object", "organization", "person", "place",
    "someone", "somebody", "something", "she", "them", "themselves", "they",
    "this person", "we", "who", "whom", "woman", "you", "yourself",
}


def _normalize_entity_name(value):
    import re as _re
    import unicodedata as _u
    if value is None:
        return ""
    s = _u.normalize("NFKC", str(value))
    s = _re.sub(r"\s+", " ", s).strip()
    return s


def _normalize_entity_key(value):
    import re as _re
    import unicodedata as _u
    s = _u.normalize("NFKC", str(value or "")).strip().lower()
    # Replace any Unicode punctuation or symbol with a space (mirrors \p{P}\p{S}).
    chars = []
    for ch in s:
        cat = _u.category(ch)
        if cat.startswith("P") or cat.startswith("S"):
            chars.append(" ")
        else:
            chars.append(ch)
    s = "".join(chars)
    s = _re.sub(r"\s+", " ", s).strip()
    return s


def _is_useful_entity_alias(value):
    key = _normalize_entity_key(value)
    return bool(key) and key not in GENERIC_ENTITY_ALIASES


def add_entity_alias(entity_id, alias, canonical=False):
    """Add an alias to an entity with NFKC normalization and case folding."""
    if not entity_id:
        return
    display_alias = _normalize_entity_name(alias)
    normalized = _normalize_entity_key(display_alias)
    if not normalized:
        return
    db = get_db()
    db.execute(
        "INSERT INTO entity_aliases (entity_id, alias, normalized_alias, canonical) "
        "VALUES (?, ?, ?, ?) "
        "ON CONFLICT(entity_id, normalized_alias) DO UPDATE SET "
        "canonical = MAX(entity_aliases.canonical, excluded.canonical)",
        (entity_id, display_alias, normalized, int(canonical)),
    )


def _find_exact_entity_matches(value, kind):
    key = _normalize_entity_key(value)
    if not key:
        return []
    return get_db().execute(
        """
        SELECT DISTINCT e.id, e.canonical_name, e.kind
        FROM entities e
        LEFT JOIN entity_aliases ea ON ea.entity_id = e.id
        WHERE e.kind = ?
          AND (ea.normalized_alias = ? OR lower(trim(e.canonical_name)) = ?)
        ORDER BY e.id ASC
        """,
        (kind, key, key),
    ).fetchall()


def _are_fuzzy_entity_keys(left, right):
    if not left or not right or left == right:
        return False
    left_tokens = left.split(" ")
    right_tokens = right.split(" ")
    if len(left_tokens) <= len(right_tokens):
        shorter = left_tokens
        longer = set(right_tokens)
    else:
        shorter = right_tokens
        longer = set(left_tokens)
    return len(shorter) > 0 and all(token in longer for token in shorter)


def _find_fuzzy_entity_candidates(values, kind, excluded_entity_id):
    keys = list({k for k in (_normalize_entity_key(v) for v in values) if k})
    if not keys:
        return []
    rows = get_db().execute(
        """
        SELECT DISTINCT e.id, e.canonical_name, e.kind, ea.normalized_alias
        FROM entities e
        JOIN entity_aliases ea ON ea.entity_id = e.id
        WHERE e.kind = ? AND e.id <> ?
        """,
        (kind, excluded_entity_id),
    ).fetchall()
    matches = {}
    for row in rows:
        if any(_are_fuzzy_entity_keys(k, row["normalized_alias"]) for k in keys):
            matches[row["id"]] = {
                "id": row["id"],
                "canonical_name": row["canonical_name"],
                "kind": row["kind"],
            }
    return list(matches.values())


def _create_entity_resolution_suggestion(source_entity_id, target_entity_id, observed_alias):
    if source_entity_id == target_entity_id:
        return
    db = get_db()
    source = db.execute(
        "SELECT canonical_name, kind FROM entities WHERE id = ?",
        (source_entity_id,),
    ).fetchone()
    target = db.execute(
        "SELECT canonical_name, kind FROM entities WHERE id = ?",
        (target_entity_id,),
    ).fetchone()
    if not source or not target or source["kind"] != target["kind"]:
        return
    db.execute(
        "INSERT OR IGNORE INTO entity_resolution_suggestions ("
        "  source_entity_id, target_entity_id, source_name, target_name,"
        "  kind, observed_alias, normalized_alias"
        ") VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            source_entity_id,
            target_entity_id,
            source["canonical_name"],
            target["canonical_name"],
            source["kind"],
            _normalize_entity_name(observed_alias),
            _normalize_entity_key(observed_alias),
        ),
    )


def _record_mention_alias_or_suggestions(entity_id, mention, kind):
    if not _is_useful_entity_alias(mention):
        return
    conflicting = [
        c
        for c in _find_exact_entity_matches(mention, kind)
        if c["id"] != entity_id
    ]
    if not conflicting:
        add_entity_alias(entity_id, mention, canonical=False)
        return
    for candidate in conflicting:
        _create_entity_resolution_suggestion(entity_id, candidate["id"], mention)


def resolve_entity_for_extraction(canonical_name, mention, kind):
    """Resolve or create an entity from an extraction entry.

    Mirrors ``resolveEntityForExtraction`` in src/db.js.
    """
    canonical = _normalize_entity_name(canonical_name or mention)
    canonical_matches = _find_exact_entity_matches(canonical, kind)
    if len(canonical_matches) == 1:
        entity_id = canonical_matches[0]["id"]
        add_entity_alias(entity_id, canonical, canonical=True)
        _record_mention_alias_or_suggestions(entity_id, mention, kind)
        return entity_id

    mention_matches = (
        _find_exact_entity_matches(mention, kind)
        if _is_useful_entity_alias(mention)
        else []
    )
    if len(canonical_matches) == 0 and len(mention_matches) == 1:
        entity_id = mention_matches[0]["id"]
        add_entity_alias(entity_id, canonical, canonical=False)
        add_entity_alias(entity_id, mention, canonical=False)
        return entity_id

    db = get_db()
    cursor = db.execute(
        "INSERT INTO entities (canonical_name, kind) VALUES (?, ?)",
        (canonical, kind),
    )
    entity_id = cursor.lastrowid
    add_entity_alias(entity_id, canonical, canonical=True)
    if _is_useful_entity_alias(mention):
        add_entity_alias(entity_id, mention, canonical=False)

    candidates = {}
    for c in canonical_matches + mention_matches:
        candidates[c["id"]] = c
    for c in _find_fuzzy_entity_candidates([canonical, mention], kind, entity_id):
        candidates[c["id"]] = c
    for candidate in candidates.values():
        _create_entity_resolution_suggestion(
            entity_id,
            candidate["id"],
            mention if _is_useful_entity_alias(mention) else canonical,
        )
    return entity_id


def _persist_derived_memory_graph(memory_id, extraction, connection=None):
    """Mirror of ``persistDerivedMemoryGraph`` in src/db.js.

    Persists entity links, relationships, and (via callers) region activations
    in the same transaction as the memory row.
    """
    conn = connection or get_db()
    entity_ids = {}
    for ent in extraction.get("entities") or []:
        name = ent.get("canonicalName") or ent.get("mention")
        entity_id = resolve_entity_for_extraction(
            canonical_name=name,
            mention=ent.get("mention"),
            kind=ent.get("kind", "concept"),
        )
        for alias in (name, ent.get("mention"), ent.get("canonicalName")):
            key = _normalize_entity_key(alias)
            if key:
                entity_ids[key] = entity_id
        link_memory_to_entity(
            memory_id,
            entity_id,
            ent.get("mention"),
            None,
            ent.get("confidence", 1.0),
        )
    for rel in extraction.get("relationships") or []:
        src_name = str(rel.get("subject") or "").strip()
        tgt_name = str(rel.get("object") or "").strip()
        src_id = entity_ids.get(_normalize_entity_key(src_name))
        if src_id is None:
            src_id = resolve_entity_for_extraction(
                canonical_name=src_name, mention=src_name, kind="concept"
            )
        tgt_id = entity_ids.get(_normalize_entity_key(tgt_name))
        if tgt_id is None:
            tgt_id = resolve_entity_for_extraction(
                canonical_name=tgt_name, mention=tgt_name, kind="concept"
            )
        evidence = rel.get("evidence")
        if evidence is None and rel.get("evidenceSpanIndexes"):
            spans = extraction.get("evidenceSpans") or []
            evidence = " … ".join(
                filter(
                    None,
                    [spans[i].get("text") for i in rel["evidenceSpanIndexes"]],
                )
            )
        add_relationship(
            src_id,
            tgt_id,
            rel.get("predicate", "related_to"),
            memory_id,
            rel.get("confidence", 1.0),
            evidence,
        )
