"""Entity-lens helpers for the 3D brain visualisation.

Port of ``src/shared/entity-lens.js``. Provides deterministic position
calculations for entity hubs, relationship previews, and the higher
level helpers for filtering, breadcrumb navigation, and normalizing
memory link responses.
"""

from __future__ import annotations

import math
from types import MappingProxyType
from typing import Iterable, Sequence


ENTITY_KIND_COLORS: MappingProxyType = MappingProxyType({
    "person": "#9bbcff",
    "place": "#7ee8d3",
    "object": "#ffd38a",
    "concept": "#e99fd1",
    "organization": "#ffad8a",
})

HUB_OUTWARD_OFFSET = 0.62
HUB_TANGENT_OFFSET = 0.12
PREVIEW_OUTWARD_OFFSET = 0.36
PREVIEW_TANGENT_OFFSET = 0.58
BRAIN_RADIUS = 1.95


def _to_vector(value) -> list[float]:
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        return [0, 0, 0]
    out = []
    for coordinate in value:
        try:
            number = float(coordinate)
        except (TypeError, ValueError):
            number = 0.0
        if not math.isfinite(number):
            number = 0.0
        out.append(number)
    return out


def _normalize(vector: Sequence[float], fallback: Sequence[float]) -> list[float]:
    length = math.hypot(*vector)
    if length > 1e-9:
        return [v / length for v in vector]
    return list(fallback)


def _cross(a: Sequence[float], b: Sequence[float]) -> list[float]:
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]


def _get_tangents(outward: Sequence[float]) -> tuple[list[float], list[float]]:
    reference = [0, 1, 0] if abs(outward[1]) < 0.9 else [1, 0, 0]
    tangent_a = _normalize(_cross(outward, reference), [1, 0, 0])
    return tangent_a, _normalize(_cross(outward, tangent_a), [0, 1, 0])


def _add_vectors(*vectors: Sequence[float]) -> list[float]:
    return [sum(vector[i] for vector in vectors) for i in range(3)]


def _scale_vector(vector: Sequence[float], scale: float) -> list[float]:
    return [coordinate * scale for coordinate in vector]


def _hash_unit(value: str) -> float:
    hash_value = 2166136261
    for char in value:
        hash_value ^= ord(char) & 0xFF
        hash_value = ((hash_value * 16777619) & 0xFFFFFFFF)
    return (hash_value & 0xFFFFFFFF) / 4294967296.0


def _clamp_unit(value: float) -> float:
    return min(max(value, 0.0), 1.0)


def _clamp_to_brain_boundary(position: Sequence[float]) -> list[float]:
    length = math.hypot(*position)
    if length <= BRAIN_RADIUS:
        return list(position)
    scale = BRAIN_RADIUS / length
    return [v * scale for v in position]


def calculate_entity_hub_position(origin_position, entity_id) -> list[float]:
    origin = _to_vector(origin_position)
    outward = _normalize(origin, [0, 0, 1])
    tangent_a, tangent_b = _get_tangents(outward)
    angle = _hash_unit(f"entity:{entity_id}:hub") * math.pi * 2
    return _clamp_to_brain_boundary(
        _add_vectors(
            origin,
            _scale_vector(outward, HUB_OUTWARD_OFFSET),
            _scale_vector(tangent_a, math.cos(angle) * HUB_TANGENT_OFFSET),
            _scale_vector(tangent_b, math.sin(angle) * HUB_TANGENT_OFFSET),
        )
    )


def calculate_relationship_preview_position(
    hub_position,
    counterpart_entity_id,
    direction: str,
) -> list[float]:
    hub = _to_vector(hub_position)
    outward = _normalize(hub, [0, 0, 1])
    tangent_a, tangent_b = _get_tangents(outward)
    direction_offset = math.pi if direction == "incoming" else 0.0
    angle = _hash_unit(f"entity:{counterpart_entity_id}:preview") * math.pi * 2 + direction_offset
    return _clamp_to_brain_boundary(
        _add_vectors(
            hub,
            _scale_vector(outward, PREVIEW_OUTWARD_OFFSET),
            _scale_vector(tangent_a, math.cos(angle) * PREVIEW_TANGENT_OFFSET),
            _scale_vector(tangent_b, math.sin(angle) * PREVIEW_TANGENT_OFFSET),
        )
    )


def get_relationship_direction(relationship, entity_id) -> str | None:
    try:
        active_id = int(entity_id)
    except (TypeError, ValueError):
        return None
    source_id = (relationship or {}).get("source", {}).get("id")
    target_id = (relationship or {}).get("target", {}).get("id")
    try:
        if int(source_id) == active_id:
            return "outgoing"
        if int(target_id) == active_id:
            return "incoming"
    except (TypeError, ValueError):
        return None
    return None


def get_relationship_counterpart(relationship, entity_id):
    direction = get_relationship_direction(relationship, entity_id)
    if direction == "outgoing":
        return relationship.get("target")
    if direction == "incoming":
        return relationship.get("source")
    return None


def filter_entity_graph_memories(graph, visible_memory_ids) -> dict:
    if isinstance(visible_memory_ids, set):
        visible_ids = visible_memory_ids
    else:
        visible_ids = set(visible_memory_ids or [])
    unique: "dict[str, dict]" = {}
    for memory in (graph or {}).get("memories") or []:
        if memory and memory.get("id") and memory["id"] not in unique:
            unique[memory["id"]] = memory
    memories = list(unique.values())
    visible = [m for m in memories if m.get("id") in visible_ids]
    return {
        "visible": visible,
        "hidden": len(memories) - len(visible),
        "total": len(memories),
    }


def build_entity_spokes(graph, visible_memory_ids) -> dict:
    filtered = filter_entity_graph_memories(graph, visible_memory_ids)
    return {
        "spokes": [
            {
                "id": f"{graph['entity']['id']}:{memory['id']}",
                "entityId": graph["entity"]["id"],
                "memoryId": memory["id"],
            }
            for memory in filtered["visible"]
        ],
        "hidden": filtered["hidden"],
        "total": filtered["total"],
    }


def normalize_memory_link_response(response, selected_memory_id, limit=5) -> dict:
    if isinstance(limit, int) and limit > 0:
        normalized_limit = limit
    else:
        normalized_limit = 5
    selected_id = str(selected_memory_id)
    seen: set[str] = set()
    links: list[dict] = []
    for link in (response or {}).get("links") or []:
        memory = link.get("memory") or {}
        memory_id = memory.get("id")
        if memory_id is None:
            continue
        id_str = str(memory_id)
        if id_str == selected_id or id_str in seen:
            continue
        seen.add(id_str)
        score = link.get("score")
        try:
            score_value = float(score)
        except (TypeError, ValueError):
            score_value = float("nan")
        score_out = _clamp_unit(score_value) if math.isfinite(score_value) else 0.0
        sem_similarity = link.get("semanticSimilarity")
        try:
            sem_value = float(sem_similarity) if sem_similarity is not None else float("nan")
        except (TypeError, ValueError):
            sem_value = float("nan")
        sem_out = _clamp_unit(sem_value) if math.isfinite(sem_value) else None
        links.append({
            **link,
            "score": score_out,
            "reasons": list(link.get("reasons") or []),
            "sharedEntities": list(link.get("sharedEntities") or []),
            "sharedRelationships": list(link.get("sharedRelationships") or []),
            "semanticSimilarity": sem_out,
        })
        if len(links) == normalized_limit:
            break
    return {
        "memoryId": (response or {}).get("memoryId", selected_memory_id),
        "links": links,
        "semanticAvailable": (response or {}).get("semanticAvailable", True) is not False,
    }


def filter_memory_links_for_visible_memories(links, visible_memory_ids, limit=5) -> list[dict]:
    if isinstance(visible_memory_ids, set):
        visible_ids = visible_memory_ids
    else:
        visible_ids = set(visible_memory_ids or [])
    if isinstance(limit, int) and limit > 0:
        normalized_limit = limit
    else:
        normalized_limit = 5
    visible: list[dict] = []
    for link in links or []:
        memory_id = (link.get("memory") or {}).get("id")
        if memory_id not in visible_ids:
            continue
        visible.append(link)
        if len(visible) == normalized_limit:
            break
    return visible


def push_navigation(history: list, entry: dict) -> list:
    current = history[-1] if history else None
    if (
        current
        and current.get("type") == entry.get("type")
        and str(current.get("id")) == str(entry.get("id"))
    ):
        return list(history)
    return [*history, dict(entry)]


def restore_navigation(history: list, index: int) -> dict:
    if not isinstance(index, int) or index < 0 or index >= len(history):
        return {"history": list(history), "current": None}
    restored = [dict(entry) for entry in history[: index + 1]]
    return {"history": restored, "current": restored[-1] if restored else None}
