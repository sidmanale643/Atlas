"""Deterministic 3D placement for memory nodes and region footprints.

Port of ``src/shared/memory-placement.js``. The placement algorithm
hashes the memory id together with the region to derive stable
tangent offsets and insets, then composes the anchor with an outward
step plus a tangent ellipse to scatter memories deterministically
inside a brain-bounded sphere.
"""

from __future__ import annotations

import math
from typing import Sequence

from .region_anchors import get_region_anchor


MIN_REGION_INSET = 0.34
REGION_INSET_RANGE = 0.14
MIN_TANGENT_OFFSET = 0.04
TANGENT_OFFSET_RANGE = 0.14
BRAIN_RADIUS = 1.95


def _hash_unit(value: str) -> float:
    """FNV-1a hash mapped to the unit interval, mirroring the JS version."""

    hash_value = 2166136261
    for char in value:
        hash_value ^= ord(char) & 0xFF
        # JS's Math.imul multiplies as a 32-bit signed integer. Python ints
        # are arbitrary precision, so we trim to 32 bits and reinterpret.
        hash_value = ((hash_value * 16777619) & 0xFFFFFFFF)
    return (hash_value & 0xFFFFFFFF) / 4294967296.0


def _normalize(vector: Sequence[float]) -> list[float]:
    length = math.hypot(*vector)
    return [v / length for v in vector]


def _cross(a: Sequence[float], b: Sequence[float]) -> list[float]:
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]


def _clamp_to_brain_boundary(position: Sequence[float]) -> list[float]:
    length = math.hypot(*position)
    if length <= BRAIN_RADIUS:
        return list(position)
    scale = BRAIN_RADIUS / length
    return [v * scale for v in position]


def get_dominant_region(regions) -> str | None:
    dominant = None
    for activation in regions or []:
        if not get_region_anchor(activation.get("region")):
            continue
        if not math.isfinite(activation.get("weight", float("nan"))):
            continue
        if (
            not dominant
            or activation["weight"] > dominant["weight"]
            or (
                activation["weight"] == dominant["weight"]
                and activation["region"].__lt__(dominant["region"])
            )
        ):
            dominant = activation
    return dominant["region"] if dominant else None


def _get_activation_anchor_position(activation) -> list[float] | None:
    if activation is None or activation.get("region") != "hippocampus":
        return None
    anchor = get_region_anchor("hippocampus")
    hemispheres = activation.get("hemispheres") or {}
    left = hemispheres.get("left")
    right = hemispheres.get("right")
    total = (left or 0) + (right or 0)
    if (
        not anchor
        or not anchor.get("hemispherePositions")
        or not math.isfinite(left or float("nan"))
        or not math.isfinite(right or float("nan"))
        or total <= 0
    ):
        return list(anchor["position"]) if anchor else None
    left_share = left / total
    right_share = right / total
    return [
        anchor["hemispherePositions"]["left"][i] * left_share
        + anchor["hemispherePositions"]["right"][i] * right_share
        for i in range(3)
    ]


def calculate_region_position(
    memory_id: str,
    region: str,
    position_override: Sequence[float] | None = None,
) -> list[float] | None:
    anchor = get_region_anchor(region)
    if not anchor:
        return None
    anchor_position = list(position_override) if position_override is not None else list(anchor["position"])

    outward = _normalize(anchor_position)
    reference = [0, 1, 0] if abs(outward[1]) < 0.9 else [1, 0, 0]
    tangent_a = _normalize(_cross(outward, reference))
    tangent_b = _cross(outward, tangent_a)

    angle = _hash_unit(f"{memory_id}:{region}:angle") * math.pi * 2
    tangent_distance = MIN_TANGENT_OFFSET + _hash_unit(f"{memory_id}:{region}:distance") * TANGENT_OFFSET_RANGE
    inset = MIN_REGION_INSET + _hash_unit(f"{memory_id}:{region}:inset") * REGION_INSET_RANGE
    tangent_x = math.cos(angle) * tangent_distance
    tangent_y = math.sin(angle) * tangent_distance

    position = [
        anchor_position[index]
        + outward[index] * -inset
        + tangent_a[index] * tangent_x
        + tangent_b[index] * tangent_y
        for index in range(3)
    ]
    return _clamp_to_brain_boundary(position)


def calculate_memory_position(memory_id: str, regions) -> list[float] | None:
    dominant_region = get_dominant_region(regions)
    dominant_activation = next(
        (a for a in (regions or []) if a.get("region") == dominant_region),
        None,
    )
    return calculate_region_position(
        memory_id,
        dominant_region,
        _get_activation_anchor_position(dominant_activation),
    )


def create_memory_node_state(memories) -> dict:
    """Return a mapping ``memory_id -> {core, activations}`` for graph rendering."""

    state: dict = {}
    for memory in memories:
        activations_in = memory.get("regions") or []
        activations = [
            activation for activation in activations_in
            if get_region_anchor(activation.get("region"))
            and math.isfinite(activation.get("weight", float("nan")))
            and activation.get("weight", 0) > 0
        ]
        activations.sort(
            key=lambda a: (-a["weight"], a["region"]),
        )
        if not activations:
            continue
        dominant_region = activations[0]["region"]

        normalized = []
        for index, activation in enumerate(activations):
            entry = {
                "region": activation["region"],
                "weight": activation["weight"],
                "isDominant": index == 0,
            }
            if activation.get("hemispheres") is not None:
                entry["hemispheres"] = activation["hemispheres"]
            normalized.append(entry)

        core_entry = {
            "region": dominant_region,
            "weight": normalized[0]["weight"],
        }
        if normalized[0].get("hemispheres") is not None:
            core_entry["hemispheres"] = normalized[0]["hemispheres"]
        core_entry["position"] = calculate_memory_position(memory["id"], activations)

        state[memory["id"]] = {
            "core": core_entry,
            "activations": normalized,
        }
    return state
