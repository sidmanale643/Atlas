"""Deterministic mapping from extraction output to brain region activations.

Port of ``src/shared/region-mapper.js``. The mapper produces a sorted
list of ``{region, weight, hemispheres?}`` entries from a single
``Extraction`` payload. The contribution rules live in
``REGION_RULES`` and the emotion rules in ``EMOTION_REGION_RULE``.

The JavaScript module exports ``MIN_REGION_ACTIVATION = 0.01`` and a
``REGION_MAPPING_VERSION = 2`` constant. Both are preserved here.
"""

from __future__ import annotations

import math
import re
from types import MappingProxyType
from typing import Iterable, Sequence


REGION_MAPPING_VERSION = 2

REGION_NAMES: tuple[str, ...] = (
    "hippocampus",
    "prefrontal",
    "associationCortex",
    "temporalCortex",
    "basalGanglia",
    "cerebellum",
    "motorCortex",
    "amygdala",
    "insula",
    "entorhinal",
    "parietalCortex",
)

REGION_RULES: MappingProxyType = MappingProxyType({
    "episodic": {
        "hippocampus": 0.65,
        "prefrontal": 0.2,
        "associationCortex": 0.15,
    },
    "semantic": {
        "temporalCortex": 0.55,
        "associationCortex": 0.35,
        "prefrontal": 0.1,
    },
    "procedural": {
        "basalGanglia": 0.45,
        "cerebellum": 0.35,
        "motorCortex": 0.2,
    },
    "emotional": {
        "amygdala": 0.5,
        "insula": 0.25,
        "prefrontal": 0.15,
        "hippocampus": 0.1,
    },
    "spatial": {
        "hippocampus": 0.4,
        "entorhinal": 0.3,
        "parietalCortex": 0.3,
    },
    "working": {
        "prefrontal": 0.6,
        "parietalCortex": 0.4,
    },
})

MIN_REGION_ACTIVATION = 0.01

EMOTION_REGION_RULE: MappingProxyType = MappingProxyType({
    "amygdala": 0.65,
    "insula": 0.35,
})

MOTOR_ACTION_ACTIVATION = 0.2

_PHYSICAL_ACTION_PATTERN = re.compile(
    r"\b(?:"
    r"climb(?:ed|ing)?|crawl(?:ed|ing)?|dance(?:d|ing)?|drive|drove|driving|"
    r"exercise(?:d|ing)?|grab(?:bed|bing)?|jump(?:ed|ing)?|kick(?:ed|ing)?|"
    r"lift(?:ed|ing)?|move(?:d|ing)?|play(?:ed|ing)?|pull(?:ed|ing)?|"
    r"push(?:ed|ing)?|ride|rode|riding|run|ran|running|swim|swam|swimming|"
    r"throw(?:ing)?|walk(?:ed|ing)?|write|wrote|writing"
    r")\b",
    re.IGNORECASE,
)


def _finite_unit(value) -> float:
    number = float(value) if isinstance(value, (int, float)) else 0.0
    if not math.isfinite(number):
        return 0.0
    return max(0.0, min(1.0, number))


def _normalize_extraction(extraction: dict | None) -> dict:
    extraction = dict(extraction or {})
    extraction["types"] = list(extraction.get("types") or [])
    extraction["actions"] = list(extraction.get("actions") or [])
    return extraction


def merge_semantic_and_cognitive(semantic: dict | None = None, cognitive: dict | None = None) -> dict:
    normalized = _normalize_extraction(semantic)
    cognitive = cognitive or {}
    return {
        **normalized,
        "emotions": list(cognitive.get("emotions") or []),
        "contentCues": list(cognitive.get("contentCues") or []),
        "salience": _finite_unit(cognitive.get("salience")),
    }


def _normalize_mapping_input(extraction: dict | None) -> dict:
    return {
        **_normalize_extraction(extraction),
        "emotions": list((extraction or {}).get("emotions") or []),
        "contentCues": list((extraction or {}).get("contentCues") or []),
    }


def _add_contribution(totals: dict, region: str, amount: float) -> None:
    if math.isfinite(amount) and amount > 0:
        totals[region] = totals.get(region, 0.0) + amount


def _max_signal(items: Iterable[float]) -> float:
    maximum = 0.0
    for value in items:
        if value > maximum:
            maximum = value
    return maximum


def get_hippocampal_laterality(extraction) -> dict:
    """Return hippocampal hemisphere shares and cue signal summary.

    Mirrors the JavaScript implementation exactly. The ``spatialSignal``
    is the maximum of the spatial type weight and the spatial cue
    signals, while ``verbalSignal`` aggregates only verbal cues.
    """

    normalized = _normalize_mapping_input(extraction)
    active_cues = [
        cue for cue in normalized["contentCues"]
        if _finite_unit(cue.get("weight")) > 0 and _finite_unit(cue.get("confidence")) > 0
    ]
    verbal_cues = [cue for cue in active_cues if cue.get("kind") == "verbal"]
    spatial_cues = [cue for cue in active_cues if cue.get("kind") == "spatial"]
    verbal_signal = _max_signal(
        _finite_unit(cue.get("weight")) * _finite_unit(cue.get("confidence"))
        for cue in verbal_cues
    )
    spatial_type_signal = _max_signal(
        _finite_unit(t.get("weight"))
        for t in normalized["types"]
        if t.get("type") == "spatial"
    )
    spatial_cue_signal = _max_signal(
        _finite_unit(cue.get("weight")) * _finite_unit(cue.get("confidence"))
        for cue in spatial_cues
    )
    spatial_signal = max(spatial_type_signal, spatial_cue_signal)
    bias = max(-0.15, min(0.15, 0.15 * (spatial_signal - verbal_signal)))
    return {
        "leftShare": 0.5 - bias,
        "rightShare": 0.5 + bias,
        "verbalSignal": verbal_signal,
        "spatialSignal": spatial_signal,
        "cues": [*verbal_cues, *spatial_cues],
    }


def get_region_contributions(extraction) -> list[dict]:
    normalized = _normalize_mapping_input(extraction)
    contributions: list[dict] = []

    for type_entry in normalized["types"]:
        type_name = type_entry.get("type")
        rule = REGION_RULES.get(type_name)
        weight = _finite_unit(type_entry.get("weight"))
        if not rule or weight <= 0:
            continue
        for region, region_weight in rule.items():
            contributions.append({
                "region": region,
                "source": "type",
                "type": type_name,
                "typeWeight": weight,
                "ruleWeight": region_weight,
                "amount": weight * region_weight,
            })

    for emotion in normalized["emotions"]:
        intensity = _finite_unit(emotion.get("intensity"))
        arousal = _finite_unit(emotion.get("arousal"))
        emotion_activation = intensity * arousal
        if emotion_activation <= 0:
            continue
        for region, region_weight in EMOTION_REGION_RULE.items():
            contributions.append({
                "region": region,
                "source": "emotion",
                "label": emotion.get("label"),
                "intensity": intensity,
                "arousal": arousal,
                "confidence": emotion.get("confidence"),
                "ruleWeight": region_weight,
                "amount": emotion_activation * region_weight,
            })

    physical_action = next(
        (
            action for action in normalized["actions"]
            if isinstance(action, str) and _PHYSICAL_ACTION_PATTERN.search(action)
        ),
        None,
    )
    if physical_action:
        contributions.append({
            "region": "motorCortex",
            "source": "action",
            "action": physical_action,
            "amount": MOTOR_ACTION_ACTIVATION,
        })

    return contributions


def map_extraction_to_regions(extraction) -> list[dict]:
    normalized = _normalize_mapping_input(extraction)
    totals: dict[str, float] = {}
    for contribution in get_region_contributions(normalized):
        _add_contribution(totals, contribution["region"], contribution["amount"])

    significant = [(region, weight) for region, weight in totals.items()
                   if weight >= MIN_REGION_ACTIVATION]
    total_weight = sum(weight for _, weight in significant)
    if total_weight == 0:
        return []

    laterality = get_hippocampal_laterality(normalized)
    result = []
    for region, weight in significant:
        normalized_weight = weight / total_weight
        if region != "hippocampus":
            result.append({"region": region, "weight": normalized_weight})
            continue
        left = normalized_weight * laterality["leftShare"]
        result.append({
            "region": region,
            "weight": normalized_weight,
            "hemispheres": {
                "left": left,
                "right": normalized_weight - left,
            },
        })
    result.sort(key=lambda entry: (-entry["weight"], entry["region"]))
    return result


def map_semantic_to_regions(semantic) -> list[dict]:
    return map_extraction_to_regions(_normalize_extraction(semantic))


def map_semantic_and_cognitive_to_regions(semantic, cognitive) -> list[dict]:
    return map_extraction_to_regions(merge_semantic_and_cognitive(semantic, cognitive))
