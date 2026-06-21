"""Memory comparison helpers: structural diff, hashing, and input shaping.

Port of ``src/memory-comparison.js``. The comparison pipeline turns a
pair of memory records into a deterministic comparison input (used for
hashing and caching), produces a stable structural diff, and builds an
explanatory activation analysis describing which brain regions shifted
and why.
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Callable

from .shared.region_anchors import REGION_ANCHORS
from .shared.region_mapper import get_region_contributions


def _finite_number(value) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return number if number == number and number not in (float("inf"), float("-inf")) else 0.0


def _nullable_number(value):
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number and number not in (float("inf"), float("-inf")) else None


def _normalize_key(value) -> str:
    return str(value or "").strip().casefold()


def _entity_key(entity: dict) -> str:
    return f"{_normalize_key(entity.get('kind'))}:{_normalize_key(entity.get('name'))}"


def _relationship_key(relationship: dict) -> str:
    return ":".join(_normalize_key(part) for part in (
        relationship.get("subject"),
        relationship.get("predicate"),
        relationship.get("object"),
    ))


def _unique_by(values: list, key: Callable) -> list:
    seen: dict = {}
    for value in values:
        seen[key(value)] = value
    return [seen[k] for k in sorted(seen.keys(), key=lambda k: key(seen[k]))]


def _unwrap_extraction(extraction) -> dict:
    if extraction is None:
        return {}
    return extraction.get("extraction_json") or extraction or {}


def _normalize_occurred_at(value) -> dict:
    if value is None:
        return {"text": "", "normalized": None}
    return {
        "text": str(value.get("text") or ""),
        "normalized": value.get("normalized") or None,
    }


def _normalize_weighted_values(values, label_key: str, weight_key: str) -> list[dict]:
    result = []
    for value in values or []:
        label = str(value.get(label_key) or "").strip()
        if not label:
            continue
        result.append({label_key: label, weight_key: _finite_number(value.get(weight_key))})
    result.sort(key=lambda entry: entry[label_key].casefold())
    return result


def _normalize_entities(stored_entities, extracted_entities) -> list[dict]:
    if stored_entities:
        values = [
            {"name": entity.get("canonical_name") or entity.get("mention"),
             "kind": entity.get("kind")}
            for entity in stored_entities
        ]
    else:
        values = [
            {"name": entity.get("canonicalName") or entity.get("mention"),
             "kind": entity.get("kind")}
            for entity in (extracted_entities or [])
        ]
    cleaned = [
        {"name": str(entity.get("name") or "").strip(),
         "kind": str(entity.get("kind") or "").strip()}
        for entity in values
    ]
    cleaned = [entity for entity in cleaned if entity["name"]]
    return _unique_by(cleaned, _entity_key)


def _normalize_relationships(stored_relationships, extracted_relationships) -> list[dict]:
    if stored_relationships:
        values = []
        for relationship in stored_relationships:
            values.append({
                "subject": (
                    relationship.get("source_name")
                    or (relationship.get("source") or {}).get("canonical_name")
                    or relationship.get("subject")
                ),
                "predicate": relationship.get("predicate"),
                "object": (
                    relationship.get("target_name")
                    or (relationship.get("target") or {}).get("canonical_name")
                    or relationship.get("object")
                ),
            })
    else:
        values = list(extracted_relationships or [])
    cleaned = [
        {
            "subject": str(relationship.get("subject") or "").strip(),
            "predicate": str(relationship.get("predicate") or "").strip(),
            "object": str(relationship.get("object") or "").strip(),
        }
        for relationship in values
    ]
    cleaned = [
        relationship for relationship in cleaned
        if relationship["subject"] or relationship["predicate"] or relationship["object"]
    ]
    return _unique_by(cleaned, _relationship_key)


def _normalize_strings(values) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for value in values or []:
        text = str(value or "").strip()
        if text and text not in seen:
            seen.add(text)
            out.append(text)
    out.sort(key=str.casefold)
    return out


def create_memory_comparison_input(memory: dict) -> dict:
    extraction = _unwrap_extraction(memory.get("extraction"))
    return {
        "id": str(memory.get("id")),
        "text": str(memory.get("raw_text") or ""),
        "summary": str(memory.get("summary") or extraction.get("summary") or ""),
        "source": str(memory.get("source") or "ui"),
        "createdAt": memory.get("created_at") or None,
        "updatedAt": memory.get("updated_at") or None,
        "ingestionDate": memory.get("ingestion_date") or None,
        "occurredAt": _normalize_occurred_at(extraction.get("occurredAt")),
        "types": _normalize_weighted_values(extraction.get("types"), "type", "weight"),
        "entities": _normalize_entities(memory.get("entities"), extraction.get("entities")),
        "relationships": _normalize_relationships(
            memory.get("relationships"),
            extraction.get("relationships"),
        ),
        "actions": _normalize_strings(extraction.get("actions")),
        "topics": _normalize_strings(extraction.get("topics")),
    }


def hash_memory_comparison_input(left_memory, right_memory) -> str:
    payload = {
        "left": create_memory_comparison_input(left_memory),
        "right": create_memory_comparison_input(right_memory),
    }
    return hashlib.sha256(json.dumps(payload, default=str).encode("utf-8")).hexdigest()


def _diff_weighted_values(left: list[dict], right: list[dict], key: str) -> list[dict]:
    left_map = {entry[key]: entry for entry in left}
    right_map = {entry[key]: entry for entry in right}
    labels = sorted(set(left_map.keys()) | set(right_map.keys()))
    return [
        {
            key: left_map.get(label, right_map.get(label, {})).get(key) or label,
            "left": left_map.get(label, {}).get("weight"),
            "right": right_map.get(label, {}).get("weight"),
            "delta": (
                None
                if (left_map.get(label) is None or right_map.get(label) is None)
                else right_map[label]["weight"] - left_map[label]["weight"]
            ),
        }
        for label in labels
    ]


def _diff_values(left, right, key: Callable = _normalize_key) -> dict:
    left_map = {key(value): value for value in left}
    right_map = {key(value): value for value in right}
    shared_keys = sorted(set(left_map.keys()) & set(right_map.keys()))
    left_only_keys = sorted(set(left_map.keys()) - set(right_map.keys()))
    right_only_keys = sorted(set(right_map.keys()) - set(left_map.keys()))
    return {
        "shared": [left_map[k] for k in shared_keys],
        "leftOnly": [left_map[k] for k in left_only_keys],
        "rightOnly": [right_map[k] for k in right_only_keys],
    }


def _value_delta(left, right) -> dict:
    return {"left": left, "right": right, "changed": left != right}


def _subtract_nullable(right, left):
    if any(value is None for value in (right, left)):
        return None
    return right - left


def _humanize(value: str) -> str:
    text = re.sub(r"([a-z])([A-Z])", r"\1 \2", str(value or ""))
    return text[:1].upper() + text[1:] if text else ""


def _format_percent(value) -> str:
    return f"{round((float(value) or 0) * 100)}%"


def _format_percentage_points(value) -> str:
    return f"{round((float(value) or 0) * 100)} percentage points"


def _capitalize(value: str) -> str:
    text = str(value or "")
    return text[:1].upper() + text[1:] if text else text


def _lowercase_first(value: str) -> str:
    text = str(value or "")
    return text[:1].lower() + text[1:] if text else text


def _diff_regions(
    left_regions=None,
    right_regions=None,
    left_extraction=None,
    right_extraction=None,
) -> list[dict]:
    def normalize(regions):
        out: dict = {}
        for region in regions or []:
            name = str(region.get("region"))
            hemispheres = region.get("hemispheres") or {}
            out[name] = {
                "weight": _finite_number(region.get("weight")),
                "left": _nullable_number(hemispheres.get("left")),
                "right": _nullable_number(hemispheres.get("right")),
            }
        return out

    left = normalize(left_regions)
    right = normalize(right_regions)
    left_contributions = _group_region_contributions(left_extraction)
    right_contributions = _group_region_contributions(right_extraction)
    return [
        {
            "region": region,
            "label": (REGION_ANCHORS.get(region) or {}).get("label") or _humanize(region),
            "role": (REGION_ANCHORS.get(region) or {}).get("role") or "",
            "left": left.get(region),
            "right": right.get(region),
            "leftReasons": _describe_contributions(left_contributions.get(region)),
            "rightReasons": _describe_contributions(right_contributions.get(region)),
            "delta": {
                "weight": _subtract_nullable(
                    (right.get(region) or {}).get("weight"),
                    (left.get(region) or {}).get("weight"),
                ),
                "leftHemisphere": _subtract_nullable(
                    (right.get(region) or {}).get("left"),
                    (left.get(region) or {}).get("left"),
                ),
                "rightHemisphere": _subtract_nullable(
                    (right.get(region) or {}).get("right"),
                    (left.get(region) or {}).get("right"),
                ),
            },
        }
        for region in sorted(set(left.keys()) | set(right.keys()))
    ]


def _group_region_contributions(extraction: dict) -> dict:
    grouped: dict = {}
    for contribution in get_region_contributions(extraction or {}):
        grouped.setdefault(contribution["region"], []).append(contribution)
    return grouped


def _describe_contributions(contributions) -> list[str]:
    items = sorted(contributions or [], key=lambda c: -c["amount"])
    descriptions: list[str] = []
    for contribution in items:
        if contribution["source"] == "type":
            descriptions.append(
                f"{_capitalize(contribution['type'])} type at "
                f"{_format_percent(contribution['typeWeight'])}, with "
                f"{_format_percent(contribution['ruleWeight'])} of that signal mapped here"
            )
        elif contribution["source"] == "emotion":
            descriptions.append(
                f"\"{contribution.get('label')}\" at "
                f"{_format_percent(contribution['intensity'])} intensity and "
                f"{_format_percent(contribution['arousal'])} arousal, with "
                f"{_format_percent(contribution['ruleWeight'])} of that signal mapped here"
            )
        else:
            descriptions.append(f"Physical action \"{contribution['action']}\" adds a motor signal")
    return descriptions


def _explain_region_difference(region: dict) -> str:
    delta = region["delta"]["weight"]
    if delta is None:
        present_side = "left" if region["left"] else "right"
        return f"{region['label']} is present only in the {present_side} memory's mapped profile."
    if abs(delta) < 0.005:
        return f"Both memories allocate nearly the same relative share to {region['label']}."
    higher_side = "right" if delta > 0 else "left"
    higher_reasons = region["rightReasons"] if higher_side == "right" else region["leftReasons"]
    reason = ""
    if higher_reasons:
        reason = f" The strongest mapped reason on that side is {_lowercase_first(higher_reasons[0])}."
    return (
        f"{region['label']} is {_format_percentage_points(abs(delta))} higher in the "
        f"{higher_side} memory.{reason}"
    )


def _get_dominant_type(extraction: dict):
    types = list(extraction.get("types") or [])
    if not types:
        return None
    return sorted(types, key=lambda t: (-(t.get("weight") or 0), t.get("type") or ""))[0]


def _build_activation_analysis(left_extraction, right_extraction, regions: list[dict]) -> dict:
    left_dominant = _get_dominant_type(left_extraction)
    right_dominant = _get_dominant_type(right_extraction)
    changed_regions = [
        region for region in regions
        if abs(region["delta"]["weight"] or 0) >= 0.005
    ]
    changed_regions.sort(
        key=lambda r: (
            -abs(r["delta"]["weight"] or 0),
            r["region"],
        )
    )
    findings = [
        {
            "region": region["region"],
            "label": region["label"],
            "role": region["role"],
            "leftWeight": (region["left"] or {}).get("weight") if region["left"] else None,
            "rightWeight": (region["right"] or {}).get("weight") if region["right"] else None,
            "delta": region["delta"]["weight"],
            "explanation": _explain_region_difference(region),
            "leftReasons": region["leftReasons"],
            "rightReasons": region["rightReasons"],
        }
        for region in changed_regions
    ]
    if left_dominant and right_dominant:
        type_comparison = (
            f"The left memory is weighted most as {left_dominant['type']} "
            f"({_format_percent(left_dominant['weight'])}), while the right is weighted "
            f"most as {right_dominant['type']} ({_format_percent(right_dominant['weight'])})."
        )
    else:
        type_comparison = "One or both memories lack a dominant extracted memory type."

    largest_shifts = []
    for region in changed_regions[:3]:
        side = "right" if region["delta"]["weight"] > 0 else "left"
        largest_shifts.append(
            f"{region['label']} is {_format_percentage_points(abs(region['delta']['weight']))} higher on the {side}"
        )
    if largest_shifts:
        summary = f"{type_comparison} The largest relative shifts are: {'; '.join(largest_shifts)}."
    else:
        summary = f"{type_comparison} Their relative activation profiles are nearly the same."

    return {
        "summary": summary,
        "findings": findings,
        "notes": [
            "Region percentages are normalized within each memory, so a stronger signal in one area can reduce another area's relative share even when its raw mapped signal is unchanged.",
            "Emotion mapping uses extracted emotional type weight plus intensity and arousal. Positive or negative valence does not by itself select a different region.",
            "These values explain Atlas's mapping heuristic; they are not measured neural activity or literal storage locations.",
        ],
    }


def build_memory_structural_diff(left_memory, right_memory) -> dict:
    left = create_memory_comparison_input(left_memory)
    right = create_memory_comparison_input(right_memory)
    left_extraction = _unwrap_extraction(left_memory.get("extraction"))
    right_extraction = _unwrap_extraction(right_memory.get("extraction"))
    regions = _diff_regions(
        left_memory.get("regions"),
        right_memory.get("regions"),
        left_extraction,
        right_extraction,
    )
    return {
        "types": _diff_weighted_values(left["types"], right["types"], "type"),
        "occurredAt": {
            "left": left["occurredAt"],
            "right": right["occurredAt"],
            "changed": json.dumps(left["occurredAt"], sort_keys=True) != json.dumps(right["occurredAt"], sort_keys=True),
        },
        "entities": _diff_values(left["entities"], right["entities"], _entity_key),
        "relationships": _diff_values(left["relationships"], right["relationships"], _relationship_key),
        "actions": _diff_values(left["actions"], right["actions"]),
        "topics": _diff_values(left["topics"], right["topics"]),
        "provenance": {
            "source": _value_delta(left["source"], right["source"]),
            "createdAt": _value_delta(left["createdAt"], right["createdAt"]),
            "updatedAt": _value_delta(left["updatedAt"], right["updatedAt"]),
            "ingestionDate": _value_delta(left["ingestionDate"], right["ingestionDate"]),
        },
        "regions": regions,
        "activationAnalysis": _build_activation_analysis(left_extraction, right_extraction, regions),
    }
