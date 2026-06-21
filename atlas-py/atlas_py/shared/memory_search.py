"""Memory text search helpers.

Port of ``src/shared/memory-search.js``. The search is purely
client-side / local: it joins the memory text, summary, and entity
mentions into a normalised haystack, then ensures every whitespace-
separated query term matches as a substring. When the caller supplies
``semanticIds`` (i.e. an upstream vector search returned matches in
Qdrant order), the result set is reordered to that order rather than
falling back to local matching.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Iterable, Sequence


def _normalize_search_value(value) -> str:
    text = str(value or "").strip().lower()
    # JS uses toLocaleLowerCase(); Python's ``casefold`` is the closest
    # equivalent for unicode case folding and is sufficient for the tests
    # we cover, which only exercise ASCII.
    return unicodedata.normalize("NFKC", text).casefold()


def _get_entity_search_values(entity: dict | None) -> list:
    if not entity:
        return []
    return [
        entity.get("canonical_name"),
        entity.get("canonicalName"),
        entity.get("mention"),
    ]


def _searchable_text(memory: dict) -> str:
    extraction = memory.get("extraction") or {}
    stored_entities = memory.get("entities") or []
    extraction_entities = extraction.get("entities") or []
    pieces = [memory.get("text"), memory.get("summary")]
    for entity in stored_entities:
        pieces.extend(_get_entity_search_values(entity))
    for entity in extraction_entities:
        pieces.extend(_get_entity_search_values(entity))
    return _normalize_search_value(" ".join(str(value) for value in pieces if value is not None))


def matches_memory_search(memory: dict, query: str) -> bool:
    terms = [term for term in re.split(r"\s+", _normalize_search_value(query)) if term]
    if not terms:
        return True
    haystack = _searchable_text(memory)
    return all(term in haystack for term in terms)


def filter_memories_for_search(
    memories: Sequence[dict],
    *,
    query: str = "",
    source: str = "all",
    semanticIds: Iterable | None = None,
) -> list[dict]:
    def source_matches(memory: dict) -> bool:
        return source == "all" or memory.get("source") == source

    normalized_query = _normalize_search_value(query)

    if not normalized_query:
        return [m for m in memories if source_matches(m)]

    if semanticIds is not None:
        memories_by_id = {str(memory.get("id")): memory for memory in memories}
        return [
            memories_by_id[str(memory_id)]
            for memory_id in semanticIds
            if str(memory_id) in memories_by_id
            and source_matches(memories_by_id[str(memory_id)])
        ]

    return [
        m for m in memories
        if source_matches(m) and matches_memory_search(m, normalized_query)
    ]
