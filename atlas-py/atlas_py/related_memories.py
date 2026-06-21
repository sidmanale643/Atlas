"""Related-memories aggregator.

Port of ``src/related-memories.js``. The aggregator takes a memory id
and a set of injected dependencies (the database, the vector store,
the FTS index, and a serializer) and returns a ranked list of related
memories together with the reasons that produced the score. Signals
combine via the ``1 - Π(1 - s)`` rule from information retrieval; if
either vector or FTS search raises, the result still includes
whatever signals were available.
"""

from __future__ import annotations

from types import MappingProxyType
from typing import Any, Awaitable, Callable, Optional


ENTITY_SIGNAL_WEIGHTS: MappingProxyType = MappingProxyType({
    "person": 0.55,
    "organization": 0.45,
    "place": 0.4,
    "concept": 0.3,
    "object": 0.25,
})

RELATIONSHIP_SIGNAL_WEIGHT = 0.55
BM25_SIGNAL_WEIGHT = 0.3


def _clamp(value, low=0.0, high=1.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return low
    if number != number or number in (float("inf"), float("-inf")):
        return low
    return max(low, min(high, number))


def combine_signals(signals) -> float:
    remaining = 1.0
    for signal in signals:
        remaining *= 1 - _clamp(signal)
    return 1 - remaining


def _unique_entities(entities) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for entity in entities or []:
        key = f"{entity.get('id')}:{entity.get('canonical_name')}:{entity.get('kind')}"
        if key in seen:
            continue
        seen.add(key)
        out.append(entity)
    return out


def _unique_relationships(relationships) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for relationship in relationships or []:
        key = ":".join(str(relationship.get(part) or "") for part in ("subject", "predicate", "object"))
        if key in seen:
            continue
        seen.add(key)
        out.append(relationship)
    return out


async def get_related_memories(
    memory_id: str,
    dependencies: dict,
    *,
    limit: int = 5,
    score_threshold: float = 0.65,
) -> Optional[dict]:
    """Return ranked related memories for ``memory_id``.

    The ``dependencies`` dict provides the same five hooks the Node
    version accepts (``getMemory``, ``getStructuralMemoryLinks``,
    ``searchMemoryVectors``, ``searchMemoriesFts``, ``serializeMemory``).
    """

    get_memory = dependencies["getMemory"]
    get_structural = dependencies["getStructuralMemoryLinks"]
    search_vectors = dependencies["searchMemoryVectors"]
    search_fts = dependencies.get("searchMemoriesFts")
    serialize = dependencies["serializeMemory"]

    origin = get_memory(memory_id)
    if not origin:
        return None

    structural_links = get_structural(memory_id) or []
    semantic_available = True
    semantic_hits: list[dict] = []
    try:
        result = search_vectors(_memory_embedding_text(origin), {
            "limit": max(limit * 4, 20),
            "scoreThreshold": score_threshold,
        })
        # Support both coroutines and plain return values, mirroring the
        # JavaScript test fixtures that pass plain functions.
        semantic_hits = await result if hasattr(result, "__await__") else result
    except Exception:
        semantic_available = False

    bm25_available = True
    bm25_hits: list[dict] = []
    try:
        text_for_bm25 = " ".join(filter(None, [
            origin.get("title"),
            origin.get("summary"),
            origin.get("raw_text"),
        ]))
        if search_fts is not None:
            bm25_hits = search_fts(text_for_bm25, {"limit": max(limit * 4, 20)})
        else:
            # If no FTS implementation is supplied, behave as if the index is empty.
            bm25_hits = []
    except Exception:
        bm25_available = False

    candidates: dict[str, dict] = {}
    for link in structural_links:
        candidate_id = str(link.get("memory_id") or link.get("memoryId") or "")
        if not candidate_id or candidate_id == str(memory_id):
            continue
        candidate = candidates.setdefault(candidate_id, {
            "memoryId": candidate_id,
            "sharedEntities": [],
            "sharedRelationships": [],
            "semanticSimilarity": None,
            "bm25Score": None,
        })
        candidate["sharedEntities"] = _unique_entities(
            link.get("shared_entities") or link.get("sharedEntities") or []
        )
        candidate["sharedRelationships"] = _unique_relationships(
            link.get("shared_relationships") or link.get("sharedRelationships") or []
        )

    for hit in semantic_hits:
        candidate_id = str(hit.get("id") or "")
        similarity = hit.get("score")
        if (
            not candidate_id
            or candidate_id == str(memory_id)
            or not isinstance(similarity, (int, float))
            or similarity != similarity
            or similarity < score_threshold
        ):
            continue
        candidate = candidates.setdefault(candidate_id, {
            "memoryId": candidate_id,
            "sharedEntities": [],
            "sharedRelationships": [],
            "semanticSimilarity": None,
            "bm25Score": None,
        })
        candidate["semanticSimilarity"] = similarity

    # Match the JavaScript implementation: ``Math.max(...hits, 0)`` of
    # the raw (signed) scores, which means a single negative score with
    # nothing higher collapses to 0 and disables the BM25 signal.
    max_bm25 = max([h.get("score") or 0 for h in bm25_hits] + [0])
    for hit in bm25_hits:
        candidate_id = str(hit.get("id") or "")
        if not candidate_id or candidate_id == str(memory_id):
            continue
        score_value = hit.get("score") or 0
        if max_bm25 == 0:
            normalized_score = 0
        else:
            normalized_score = abs(score_value) / abs(max_bm25)
        candidate = candidates.setdefault(candidate_id, {
            "memoryId": candidate_id,
            "sharedEntities": [],
            "sharedRelationships": [],
            "semanticSimilarity": None,
            "bm25Score": None,
        })
        candidate["bm25Score"] = normalized_score

    scored: list[dict] = []
    for candidate in candidates.values():
        memory = get_memory(candidate["memoryId"])
        if not memory:
            continue
        signals = [
            ENTITY_SIGNAL_WEIGHTS.get(entity.get("kind"), 0.2)
            for entity in candidate["sharedEntities"]
        ]
        signals.extend([RELATIONSHIP_SIGNAL_WEIGHT] * len(candidate["sharedRelationships"]))
        if candidate["semanticSimilarity"] is not None:
            signals.append(_clamp(candidate["semanticSimilarity"]))
        if candidate["bm25Score"] is not None:
            signals.append(_clamp(candidate["bm25Score"]) * BM25_SIGNAL_WEIGHT)
        score = combine_signals(signals)
        if score <= 0:
            continue
        scored.append({
            "memory": serialize(memory),
            "score": score,
            "reasons": _build_reasons(candidate),
            "sharedEntities": candidate["sharedEntities"],
            "sharedRelationships": candidate["sharedRelationships"],
            "semanticSimilarity": candidate["semanticSimilarity"],
            "bm25Score": candidate["bm25Score"],
        })

    scored.sort(key=_compare_links)
    return {
        "memoryId": str(memory_id),
        "links": scored[:limit],
        "semanticAvailable": semantic_available,
        "bm25Available": bm25_available,
    }


def _memory_embedding_text(memory: dict) -> str:
    return "\n".join(filter(None, [
        memory.get("title"),
        memory.get("summary"),
        memory.get("raw_text"),
    ]))


def _build_reasons(candidate: dict) -> list[str]:
    reasons: list[str] = []
    for entity in candidate["sharedEntities"]:
        reasons.append(f"Shared {entity.get('kind')}: {entity.get('canonical_name')}")
    for relationship in candidate["sharedRelationships"]:
        reasons.append(
            "Shared relationship: "
            f"{relationship.get('subject')} {relationship.get('predicate')} {relationship.get('object')}"
        )
    if candidate["semanticSimilarity"] is not None:
        reasons.append(
            f"Semantic similarity {round(candidate['semanticSimilarity'] * 100)}%"
        )
    if candidate["bm25Score"] is not None:
        reasons.append(
            f"Keyword relevance {round(candidate['bm25Score'] * 100)}%"
        )
    return reasons


def _compare_links(link):
    memory = link.get("memory") or {}
    score = link.get("score") or 0
    created_raw = memory.get("created_at") or ""
    # ``Date.parse`` in JS returns milliseconds since epoch for ISO strings
    # and ``NaN`` for invalid input (which we coerce to 0). Use the same
    # convention so a more recent ``created_at`` always sorts first.
    from datetime import datetime
    try:
        created = datetime.fromisoformat(created_raw.replace("Z", "+00:00")).timestamp() * 1000
    except (TypeError, ValueError):
        created = 0
    return (-score, -created, str(memory.get("id") or ""))
