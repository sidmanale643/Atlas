"""Deterministic validation of V3 semantic extraction output.

Port of ``src/semantic-validation.js``. The validator is intentionally
strict: it inspects evidence spans against the source text, drops
low-confidence entities/relationships, and surfaces boundary issues
that indicate the LLM split the source text incorrectly.
"""

from __future__ import annotations

import re
import unicodedata
from types import MappingProxyType
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .schemas import SemanticExtractionSchema


SEMANTIC_VALIDATION_CODES: MappingProxyType = MappingProxyType({
    "SCHEMA_INVALID": "schema_invalid",
    "EVIDENCE_OUT_OF_BOUNDS": "evidence_out_of_bounds",
    "EVIDENCE_TEXT_MISMATCH": "evidence_text_mismatch",
    "DURABILITY_REJECTED": "durability_rejected",
    "USER_FACING_INTERNAL_SUBJECT": "user_facing_internal_subject",
    "USER_FACING_IMPLEMENTATION_DATE": "user_facing_implementation_date",
    "OCCURRED_AT_TEXT_MISSING": "occurred_at_text_missing",
    "OCCURRED_AT_TEXT_MISMATCH": "occurred_at_text_mismatch",
    "EVIDENCE_INDEX_OUT_OF_BOUNDS": "evidence_index_out_of_bounds",
    "ENTITY_MENTION_UNSUPPORTED": "entity_mention_unsupported",
    "DUPLICATE_ENTITY": "duplicate_entity",
    "RELATIONSHIP_ENDPOINT_UNSUPPORTED": "relationship_endpoint_unsupported",
    "DUPLICATE_RELATIONSHIP": "duplicate_relationship",
    "DUPLICATE_ATOM": "duplicate_atom",
    "BOUNDARY_MULTIPLE_SENTENCES": "boundary_multiple_sentences",
    "BOUNDARY_MULTIPLE_SUBJECTS": "boundary_multiple_subjects",
    "BOUNDARY_BROAD_SOURCE_COVERAGE": "boundary_broad_source_coverage",
    "BOUNDARY_INDEPENDENT_AND_CLAIMS": "boundary_independent_and_claims",
})

SEMANTIC_ACCEPTANCE_THRESHOLDS: MappingProxyType = MappingProxyType({
    "durability": 0.70,
    "entity": 0.70,
    "relationship": 0.75,
    "secondaryType": 0.15,
})

EMPTY_DROP_COUNTS: MappingProxyType = MappingProxyType({
    "entities": 0,
    "relationships": 0,
    "types": 0,
    "actions": 0,
    "topics": 0,
})


class SemanticValidationError(Exception):
    def __init__(self, result: dict):
        details = "; ".join(
            f"{issue['code']}{' at ' + '.'.join(str(p) for p in issue['path']) if issue['path'] else ''}: {issue['message']}"
            for issue in result["issues"]
        )
        super().__init__(f"Semantic extraction failed deterministic validation: {details}")
        self.code = "SEMANTIC_EXTRACTION_INVALID"
        self.issues = result["issues"]
        self.drop_counts = result["drop_counts"]
        self.extraction = result["extraction"]


def _normalize_key(value) -> str:
    return (
        unicodedata.normalize("NFKC", str(value))
        .strip()
        .replace("\u00a0", " ")
    ).lower()


def _normalize_unique_strings(values, field: str, drop_counts: dict) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for value in values or []:
        text = str(value).strip()
        key = _normalize_key(text)
        if key in seen:
            drop_counts[field] += 1
            continue
        seen.add(key)
        out.append(text)
    return out


def _add_issue(issues: list, code: str, path: list, message: str) -> None:
    issues.append({"code": code, "path": list(path), "message": message})


def _apply_acceptance_policy(memory: dict, drop_counts: dict) -> dict:
    all_entity_names = {
        _normalize_key(item)
        for entity in memory.get("entities", [])
        for item in (entity.get("mention"), entity.get("canonicalName"))
        if item
    }
    accepted_entities = []
    for entity in memory.get("entities", []):
        if entity.get("confidence", 0) >= SEMANTIC_ACCEPTANCE_THRESHOLDS["entity"]:
            accepted_entities.append(entity)
        else:
            drop_counts["entities"] += 1
    entity_names = {
        _normalize_key(name)
        for entity in accepted_entities
        for name in (entity.get("mention"), entity.get("canonicalName"))
        if name
    }
    accepted_relationships = []
    for relationship in memory.get("relationships", []):
        subject_dropped = _endpoint_references_dropped_entity(
            relationship.get("subject"), all_entity_names, entity_names
        )
        object_dropped = _endpoint_references_dropped_entity(
            relationship.get("object"), all_entity_names, entity_names
        )
        if subject_dropped or object_dropped:
            drop_counts["relationships"] += 1
            continue
        if relationship.get("confidence", 0) < SEMANTIC_ACCEPTANCE_THRESHOLDS["relationship"]:
            drop_counts["relationships"] += 1
            continue
        accepted_relationships.append(relationship)

    # Keep the highest-weight type plus any secondary type above the threshold.
    types = memory.get("types", [])
    dominant_index = -1
    for index, type_entry in enumerate(types):
        if dominant_index == -1 or type_entry.get("weight", 0) > types[dominant_index].get("weight", 0):
            dominant_index = index
    accepted_types = []
    for index, type_entry in enumerate(types):
        if index == dominant_index or type_entry.get("weight", 0) >= SEMANTIC_ACCEPTANCE_THRESHOLDS["secondaryType"]:
            accepted_types.append(type_entry)
        else:
            drop_counts["types"] += 1

    actions = _normalize_unique_strings(memory.get("actions", []), "actions", drop_counts)
    topics = _normalize_unique_strings(memory.get("topics", []), "topics", drop_counts)

    return {
        **memory,
        "entities": accepted_entities,
        "relationships": accepted_relationships,
        "types": accepted_types,
        "actions": actions,
        "topics": topics,
    }


def _endpoint_references_dropped_entity(endpoint, all_entity_names: set, accepted_entity_names: set) -> bool:
    if endpoint is None:
        return False
    key = _normalize_key(endpoint)
    return key in all_entity_names and key not in accepted_entity_names


def _validate_atom(source_text: str, memory: dict, atom_index: int, issues: list, boundary_audit: bool) -> None:
    atom_path = ["memories", atom_index]
    spans = memory.get("evidenceSpans", [])
    for span_index, span in enumerate(spans):
        path = [*atom_path, "evidenceSpans", span_index]
        if span.get("end", 0) > len(source_text):
            _add_issue(
                issues,
                SEMANTIC_VALIDATION_CODES["EVIDENCE_OUT_OF_BOUNDS"],
                path,
                f"span end {span['end']} exceeds source length {len(source_text)}",
            )
        if source_text[span.get("start", 0):span.get("end", 0)] != span.get("text"):
            _add_issue(
                issues,
                SEMANTIC_VALIDATION_CODES["EVIDENCE_TEXT_MISMATCH"],
                [*path, "text"],
                "span text must exactly equal the source slice",
            )

    durability = memory.get("durability", {})
    if (
        not durability.get("durable")
        or durability.get("confidence", 0) < SEMANTIC_ACCEPTANCE_THRESHOLDS["durability"]
    ):
        _add_issue(
            issues,
            SEMANTIC_VALIDATION_CODES["DURABILITY_REJECTED"],
            [*atom_path, "durability"],
            "atom does not meet the durable-memory acceptance threshold",
        )

    _validate_user_facing_prose(memory, atom_path, issues)
    _validate_occurred_at(source_text, memory.get("occurredAt", {}), atom_path, issues)
    _validate_entities(memory, atom_path, issues)
    _validate_relationships(memory, atom_path, issues)
    if boundary_audit:
        _audit_boundaries(source_text, memory, atom_path, issues)


_USER_FACING_INTERNAL = re.compile(r"\b(?:self|the speaker|the user)\b", re.IGNORECASE)
_USER_FACING_DATE = re.compile(r"\b(?:the )?(?:ingestion|source|current|today'?s) date\b", re.IGNORECASE)


def _validate_user_facing_prose(memory: dict, atom_path: list, issues: list) -> None:
    for field in ("text", "summary"):
        value = memory.get(field, "") or ""
        if _USER_FACING_INTERNAL.search(value):
            _add_issue(
                issues,
                SEMANTIC_VALIDATION_CODES["USER_FACING_INTERNAL_SUBJECT"],
                [*atom_path, field],
                f"{field} must use first-person language; self is reserved for relationships",
            )
        if _USER_FACING_DATE.search(value):
            _add_issue(
                issues,
                SEMANTIC_VALIDATION_CODES["USER_FACING_IMPLEMENTATION_DATE"],
                [*atom_path, field],
                f"{field} must use the source time phrase or resolved calendar date",
            )


def _validate_occurred_at(source_text: str, occurred_at: dict, atom_path: list, issues: list) -> None:
    text = occurred_at.get("text", "") or ""
    if not text:
        if occurred_at.get("normalized") is not None:
            _add_issue(
                issues,
                SEMANTIC_VALIDATION_CODES["OCCURRED_AT_TEXT_MISSING"],
                [*atom_path, "occurredAt", "text"],
                "a normalized occurrence date requires an exact source time phrase",
            )
        return
    if text not in source_text:
        _add_issue(
            issues,
            SEMANTIC_VALIDATION_CODES["OCCURRED_AT_TEXT_MISMATCH"],
            [*atom_path, "occurredAt", "text"],
            "occurredAt.text must be an exact source substring",
        )


def _resolve_evidence(memory: dict, indexes, path: list, issues: list) -> list[dict]:
    evidence: list[dict] = []
    for position, index in enumerate(indexes or []):
        if index >= len(memory.get("evidenceSpans", [])):
            _add_issue(
                issues,
                SEMANTIC_VALIDATION_CODES["EVIDENCE_INDEX_OUT_OF_BOUNDS"],
                [*path, "evidenceSpanIndexes", position],
                f"evidence span index {index} does not exist",
            )
            continue
        evidence.append(memory["evidenceSpans"][index])
    return evidence


def _validate_entities(memory: dict, atom_path: list, issues: list) -> None:
    seen: set[str] = set()
    for entity_index, entity in enumerate(memory.get("entities", [])):
        path = [*atom_path, "entities", entity_index]
        evidence = _resolve_evidence(
            memory, entity.get("evidenceSpanIndexes"), path, issues
        )
        if not any(entity.get("mention", "") in span.get("text", "") for span in evidence):
            _add_issue(
                issues,
                SEMANTIC_VALIDATION_CODES["ENTITY_MENTION_UNSUPPORTED"],
                [*path, "mention"],
                "entity mention must occur exactly inside cited evidence",
            )
        key = "\u0000".join(
            _normalize_key(part)
            for part in [entity.get("mention", ""), entity.get("kind", ""), entity.get("canonicalName") or ""]
        )
        if key in seen:
            _add_issue(
                issues,
                SEMANTIC_VALIDATION_CODES["DUPLICATE_ENTITY"],
                path,
                "duplicate entity after normalization",
            )
        seen.add(key)


def _validate_relationships(memory: dict, atom_path: list, issues: list) -> None:
    entity_names = {
        _normalize_key(name)
        for entity in memory.get("entities", [])
        for name in (entity.get("mention"), entity.get("canonicalName"))
        if name
    }
    seen: set[str] = set()
    for relationship_index, relationship in enumerate(memory.get("relationships", [])):
        path = [*atom_path, "relationships", relationship_index]
        evidence = _resolve_evidence(
            memory, relationship.get("evidenceSpanIndexes"), path, issues
        )
        for field in ("subject", "object"):
            endpoint = relationship.get(field, "") or ""
            if _normalize_key(endpoint) == "self":
                continue
            if _normalize_key(endpoint) in entity_names:
                continue
            if any(endpoint in span.get("text", "") for span in evidence):
                continue
            _add_issue(
                issues,
                SEMANTIC_VALIDATION_CODES["RELATIONSHIP_ENDPOINT_UNSUPPORTED"],
                [*path, field],
                f"{field} must resolve to self, an extracted entity, or an exact evidence literal",
            )
        key = "\u0000".join(
            _normalize_key(part)
            for part in [relationship.get("subject", ""), relationship.get("predicate", ""), relationship.get("object", "")]
        )
        if key in seen:
            _add_issue(
                issues,
                SEMANTIC_VALIDATION_CODES["DUPLICATE_RELATIONSHIP"],
                path,
                "duplicate relationship after normalization",
            )
        seen.add(key)


_SENTENCE_PATTERN = re.compile(r"[^.!?]+[.!?]+(?:\s+|$)")

_STATE_PREDICATES = {
    "lives_in", "works_at", "prefers", "related_to", "uses", "scheduled_for",
}


def _sentence_count(text: str) -> int:
    return len(_SENTENCE_PATTERN.findall(str(text)))


def _audit_boundaries(source_text: str, memory: dict, atom_path: list, issues: list) -> None:
    if _sentence_count(memory.get("text", "")) > 1:
        _add_issue(
            issues,
            SEMANTIC_VALIDATION_CODES["BOUNDARY_MULTIPLE_SENTENCES"],
            [*atom_path, "text"],
            "atom contains multiple complete sentences",
        )
    subjects = {_normalize_key(rel.get("subject", "")) for rel in memory.get("relationships", [])}
    if len(subjects) > 1:
        _add_issue(
            issues,
            SEMANTIC_VALIDATION_CODES["BOUNDARY_MULTIPLE_SUBJECTS"],
            [*atom_path, "relationships"],
            "atom contains relationship claims about multiple subjects",
        )
    if _sentence_count(source_text) > 1 and source_text:
        covered = sum(max(0, span.get("end", 0) - span.get("start", 0))
                      for span in memory.get("evidenceSpans", []))
        if covered / len(source_text) >= 0.8:
            _add_issue(
                issues,
                SEMANTIC_VALIDATION_CODES["BOUNDARY_BROAD_SOURCE_COVERAGE"],
                [*atom_path, "evidenceSpans"],
                "one atom covers most of a multi-sentence source",
            )
    predicates = {
        _normalize_key(rel.get("predicate", "")).replace(" ", "_")
        for rel in memory.get("relationships", [])
    }
    state_predicates = predicates & _STATE_PREDICATES
    if re.search(r"\band\b", memory.get("text", ""), re.IGNORECASE) and len(state_predicates) > 1:
        _add_issue(
            issues,
            SEMANTIC_VALIDATION_CODES["BOUNDARY_INDEPENDENT_AND_CLAIMS"],
            [*atom_path, "text"],
            "atom joins multiple independently evolving state predicates with 'and'",
        )


def _validate_duplicate_atoms(memories: list[dict], issues: list) -> None:
    seen: dict[str, int] = {}
    for index, memory in enumerate(memories):
        key = _normalize_key(memory.get("text", ""))
        if key in seen:
            _add_issue(
                issues,
                SEMANTIC_VALIDATION_CODES["DUPLICATE_ATOM"],
                ["memories", index, "text"],
                f"duplicates atom {seen[key]}",
            )
        else:
            seen[key] = index


def validate_semantic_extraction(source_text, candidate, *, boundary_audit: bool = True) -> dict:
    if not isinstance(source_text, str):
        raise TypeError("sourceText must be a string")

    try:
        parsed = SemanticExtractionSchema.model_validate(candidate)
    except ValidationError as error:
        return {
            "success": False,
            "extraction": None,
            "issues": [
                {
                    "code": SEMANTIC_VALIDATION_CODES["SCHEMA_INVALID"],
                    "path": [str(item) for item in issue["path"]],
                    "message": issue["msg"],
                }
                for issue in error.errors()
            ],
            "drop_counts": {key: 0 for key in EMPTY_DROP_COUNTS},
        }

    issues: list = []
    drop_counts = {key: 0 for key in EMPTY_DROP_COUNTS}
    normalized_memories = []
    for atom_index, memory in enumerate(parsed.memories):
        normalized = _apply_acceptance_policy(memory.model_dump(), drop_counts)
        _validate_atom(source_text, normalized, atom_index, issues, boundary_audit)
        normalized_memories.append(normalized)
    _validate_duplicate_atoms(normalized_memories, issues)

    return {
        "success": len(issues) == 0,
        "extraction": {"memories": normalized_memories},
        "issues": issues,
        "drop_counts": drop_counts,
    }


def assert_valid_semantic_extraction(source_text, candidate, **options) -> dict:
    result = validate_semantic_extraction(source_text, candidate, **options)
    if not result["success"]:
        raise SemanticValidationError(result)
    return result
