"""Pydantic v2 schemas that mirror the JavaScript Zod definitions.

Port of ``src/schemas.js`` covering only the schema families exercised
by passing tests. The output format mimics the JS Zod helpers:

* ``parse`` / ``safe_parse`` mirror ``ZodSchema.parse`` / ``safeParse``.
* ``to_json_schema`` mirrors ``ZodSchema.toJSONSchema`` and is used
  to send schemas to the LLM as tool parameters.
* All shapes default to ``extra="forbid"`` so unknown fields are
  rejected — the JS Zod ``.strict()`` behavior the tests rely on.
"""

from __future__ import annotations

from typing import Annotated, Any, Optional

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)


# --- Configuration helper ----------------------------------------------------

class _BaseModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @classmethod
    def safe_parse(cls, value):
        try:
            data = cls.model_validate(value)
            return {"ok": True, "value": data.model_dump(exclude_none=True), "data": data}
        except Exception as e:
            errs = getattr(e, "errors", lambda: [])()
            issues = []
            for er in errs:
                issues.append({"loc": er.get("loc", ()), "msg": er.get("msg", "invalid")})
            return {"ok": False, "issues": issues, "error": e}


# --- Request Schemas ---------------------------------------------------------

class AddMemorySchema(_BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)
    type: Optional[str] = None
    title: Optional[str] = Field(default=None, min_length=1, max_length=50)
    confidence: float = Field(default=0.6, ge=0.0, le=1.0)
    tags: list[str] = Field(default_factory=list)

    @field_validator("type")
    @classmethod
    def _validate_type(cls, value: Optional[str]) -> Optional[str]:
        valid = {
            "relationship", "preference", "fact", "decision", "learning",
            "event", "instruction", "observation", "error",
        }
        if value is not None and value not in valid:
            raise ValueError(f"unsupported memory type: {value}")
        return value

    @field_validator("tags", mode="before")
    @classmethod
    def _normalize_tags(cls, value):
        return value or []


class AddInputSchema(AddMemorySchema):
    """Schema for the CLI's `add` command.

    Inherits validators from AddMemorySchema, but every field except text is
    optional and has no default — the LLM infers type/title/confidence/tags
    when the caller omits them.
    """

    model_config = ConfigDict(extra="forbid")
    confidence: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    tags: Optional[list[str]] = None

    @field_validator("type")
    @classmethod
    def _validate_type(cls, value: Optional[str]) -> Optional[str]:
        valid = {
            "relationship", "preference", "fact", "decision", "learning",
            "event", "instruction", "observation", "error",
        }
        if value is not None and value not in valid:
            raise ValueError(f"unsupported memory type: {value}")
        return value

    @field_validator("tags", mode="before")
    @classmethod
    def _normalize_tags(cls, value):
        return value or []


class MemoryComparisonRequest(_BaseModel):
    leftMemoryId: str = Field(..., min_length=1)
    rightMemoryId: str = Field(..., min_length=1)
    regenerate: bool = False

    @field_validator("leftMemoryId", "rightMemoryId")
    @classmethod
    def _trim(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def _different_ids(self):
        if self.leftMemoryId == self.rightMemoryId:
            raise ValueError("Memory IDs must be different")
        return self


# --- LLM Extraction Schemas --------------------------------------------------

class OccurredAtSchema(_BaseModel):
    text: str
    normalized: Optional[str]
    confidence: float = Field(..., ge=0.0, le=1.0)


class MemoryTypeSchema(_BaseModel):
    type: str
    weight: float = Field(..., ge=0.0, le=1.0)

    @field_validator("type")
    @classmethod
    def _validate_type(cls, value: str) -> str:
        valid = {"episodic", "semantic", "procedural", "emotional", "spatial", "working"}
        if value not in valid:
            raise ValueError(f"unsupported memory type: {value}")
        return value


class ContentCueSchema(_BaseModel):
    kind: str
    weight: float = Field(..., ge=0.0, le=1.0)
    confidence: float = Field(..., ge=0.0, le=1.0)
    evidence: str = Field(..., min_length=1)

    @field_validator("kind")
    @classmethod
    def _validate_kind(cls, value: str) -> str:
        if value not in {"verbal", "spatial"}:
            raise ValueError(f"unsupported content cue kind: {value}")
        return value


class EmotionSchema(_BaseModel):
    label: str
    valence: float = Field(..., ge=-1.0, le=1.0)
    arousal: float = Field(..., ge=0.0, le=1.0)
    intensity: float = Field(..., ge=0.0, le=1.0)
    confidence: float = Field(..., ge=0.0, le=1.0)
    evidence: str


class EntitySchema(_BaseModel):
    mention: str
    kind: str
    canonicalName: Optional[str]
    confidence: float = Field(..., ge=0.0, le=1.0)

    @field_validator("kind")
    @classmethod
    def _validate_kind(cls, value: str) -> str:
        valid = {"person", "place", "object", "concept", "organization"}
        if value not in valid:
            raise ValueError(f"unsupported entity kind: {value}")
        return value


class RelationshipSchema(_BaseModel):
    subject: str
    predicate: str
    object: str
    confidence: float = Field(..., ge=0.0, le=1.0)
    evidence: str


def _validate_types_sum(types: list[MemoryTypeSchema]) -> list[MemoryTypeSchema]:
    total = sum(t.weight for t in types)
    if total > 1.0001:
        raise ValueError(f"Type weights sum to {total:.3f}, which exceeds 1.0")
    return types


class ExtractionSchema(_BaseModel):
    occurredAt: OccurredAtSchema
    types: list[MemoryTypeSchema]
    emotions: list[EmotionSchema]
    entities: list[EntitySchema]
    relationships: list[RelationshipSchema]
    actions: list[str]
    topics: list[str]
    contentCues: list[ContentCueSchema]
    salience: float = Field(..., ge=0.0, le=1.0)
    summary: str

    @field_validator("types")
    @classmethod
    def _check_weight_sum(cls, value: list[MemoryTypeSchema]) -> list[MemoryTypeSchema]:
        return _validate_types_sum(value)


# --- Memory Comparison Schema -----------------------------------------------

class ComparisonFindingSchema(_BaseModel):
    statement: str = Field(..., min_length=1)
    leftEvidence: Optional[str] = Field(default=None, min_length=1)
    rightEvidence: Optional[str] = Field(default=None, min_length=1)
    confidence: float = Field(..., ge=0.0, le=1.0)


class TwoSidedComparisonFindingSchema(ComparisonFindingSchema):
    @model_validator(mode="after")
    def _both_sides(self):
        if not self.leftEvidence:
            raise ValueError("leftEvidence is required")
        if not self.rightEvidence:
            raise ValueError("rightEvidence is required")
        return self


class MemoryComparisonSchema(_BaseModel):
    relationship: str
    confidence: float = Field(..., ge=0.0, le=1.0)
    overview: str = Field(..., min_length=1)
    sharedFacts: list[TwoSidedComparisonFindingSchema]
    differences: list[ComparisonFindingSchema]
    contradictions: list[TwoSidedComparisonFindingSchema]
    caveats: list[str] = Field(default_factory=list)

    @field_validator("relationship")
    @classmethod
    def _validate_relationship(cls, value: str) -> str:
        valid = {
            "duplicate", "overlapping", "complementary",
            "contradictory", "unrelated", "uncertain",
        }
        if value not in valid:
            raise ValueError(f"unsupported relationship value: {value}")
        return value

    @field_validator("differences")
    @classmethod
    def _validate_differences(cls, value: list[ComparisonFindingSchema]):
        for index, finding in enumerate(value):
            if not (finding.leftEvidence or finding.rightEvidence):
                raise ValueError("At least one evidence field is required")
        return value


# --- Memory Write Decision Schema -------------------------------------------

class MemoryWriteDecisionSchema(_BaseModel):
    action: str
    matchedMemoryId: Optional[str]
    confidence: float = Field(..., ge=0.0, le=1.0)
    reason: str = Field(..., min_length=1)
    replacementText: str = Field(..., min_length=1)

    @field_validator("action")
    @classmethod
    def _validate_action(cls, value: str) -> str:
        if value not in {"create", "update", "unchanged"}:
            raise ValueError(f"unsupported write action: {value}")
        return value

    @field_validator("matchedMemoryId")
    @classmethod
    def _trim_matched(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @model_validator(mode="after")
    def _conservative_invariants(self):
        if self.action == "create" and self.matchedMemoryId is not None:
            raise ValueError("matchedMemoryId must be null when action is create")
        if self.action != "create" and self.matchedMemoryId is None:
            raise ValueError("matchedMemoryId is required for update and unchanged actions")
        if self.action != "create" and self.confidence < 0.85:
            raise ValueError("update and unchanged actions require confidence of at least 0.85")
        return self


# --- JSON Schema helpers ----------------------------------------------------

def _strip_metadata(schema: dict) -> dict:
    """Remove pydantic-only metadata (``$schema``, ``title``) so the
    JSON shape matches the JS Zod output."""

    return {key: value for key, value in schema.items()
            if key not in {"$schema", "title"}}


def to_json_schema(model: type[BaseModel]) -> dict:
    return _strip_metadata(model.model_json_schema())


# --- Constants exposed as tests --------------------------------------------

# Note: the JavaScript source exports ``EXTRACTION_SCHEMA_VERSION = 3``
# (the V3 atomic schema) while the legacy test still expects ``2``. We
# match the source for behavioural parity. Callers that need the legacy
# value can import the ``LEGACY_EXTRACTION_SCHEMA_VERSION`` alias.
SEMANTIC_EXTRACTION_SCHEMA_VERSION = 3
COGNITIVE_ANNOTATION_SCHEMA_VERSION = 1
SEMANTIC_SCHEMA_VERSION = SEMANTIC_EXTRACTION_SCHEMA_VERSION
COGNITIVE_SCHEMA_VERSION = COGNITIVE_ANNOTATION_SCHEMA_VERSION
EXTRACTION_SCHEMA_VERSION = SEMANTIC_EXTRACTION_SCHEMA_VERSION
MEMORY_COMPARISON_SCHEMA_VERSION = 1
LEGACY_EXTRACTION_SCHEMA_VERSION = 2

# Build JSON schemas the LLM module can attach to tool calls.
MemoryWriteDecisionJsonSchema = to_json_schema(MemoryWriteDecisionSchema) | {"additionalProperties": False}
MemoryComparisonJsonSchema = to_json_schema(MemoryComparisonSchema)
ExtractionJsonSchema = to_json_schema(ExtractionSchema)

# --- V3 Atomic Memory Schema -------------------------------------------------

import datetime as _dt
import re as _re


_ISO_DATE = _re.compile(
    r"^(\d{4})-(\d{2})-(\d{2})"
    r"(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d))?$"
)


def _is_valid_iso_date(value) -> bool:
    if not isinstance(value, str):
        return False
    match = _ISO_DATE.match(value)
    if not match:
        return False
    year, month, day = (int(group) for group in match.groups())
    try:
        calendar = _dt.date(year, month, day)
    except ValueError:
        return False
    return calendar == _dt.date(year, month, day)


def _trim_text(value: str, maximum: int) -> str:
    if value is None:
        return value
    text = str(value).strip()
    if not text or len(text) > maximum:
        raise ValueError(f"text length must be 1..{maximum}")
    return text


class EvidenceSpanSchema(_BaseModel):
    start: int = Field(..., ge=0)
    end: int = Field(..., gt=0)
    text: str = Field(..., min_length=1)

    @model_validator(mode="after")
    def _check_range(self):
        if self.end <= self.start:
            raise ValueError("evidence span end must be greater than start")
        return self


class DurabilitySchema(_BaseModel):
    durable: bool
    confidence: float = Field(..., ge=0.0, le=1.0)
    reason: str

    @field_validator("reason")
    @classmethod
    def _trim(cls, value: str) -> str:
        return _trim_text(value, 500)


class V3OccurredAtSchema(_BaseModel):
    text: str = Field(default="", max_length=200)
    normalized: Optional[str] = None
    confidence: float = Field(..., ge=0.0, le=1.0)

    @field_validator("normalized")
    @classmethod
    def _check_iso(cls, value):
        if value is None:
            return value
        if not _is_valid_iso_date(value):
            raise ValueError("normalized must be a valid ISO-8601 date or timestamp")
        return value


class V3MemoryTypeSchema(_BaseModel):
    type: str
    weight: float = Field(..., gt=0.0, le=1.0)

    @field_validator("type")
    @classmethod
    def _validate_type(cls, value: str) -> str:
        valid = {"episodic", "semantic", "procedural", "emotional", "spatial", "working"}
        if value not in valid:
            raise ValueError(f"unsupported memory type: {value}")
        return value


class V3EntitySchema(_BaseModel):
    mention: str
    kind: str
    canonicalName: Optional[str] = None
    confidence: float = Field(..., ge=0.0, le=1.0)
    evidenceSpanIndexes: list[int] = Field(default_factory=list)

    @field_validator("mention")
    @classmethod
    def _trim_mention(cls, value: str) -> str:
        return _trim_text(value, 200)

    @field_validator("kind")
    @classmethod
    def _check_kind(cls, value: str) -> str:
        valid = {"person", "place", "object", "concept", "organization"}
        if value not in valid:
            raise ValueError(f"unsupported entity kind: {value}")
        return value


class V3RelationshipSchema(_BaseModel):
    subject: str
    predicate: str
    object: str
    confidence: float = Field(..., ge=0.0, le=1.0)
    evidenceSpanIndexes: list[int] = Field(default_factory=list)

    @field_validator("subject", "predicate", "object")
    @classmethod
    def _trim(cls, value: str) -> str:
        return _trim_text(value, 200)


class AtomicMemorySchema(_BaseModel):
    text: str
    summary: str
    evidenceSpans: list[EvidenceSpanSchema]
    durability: DurabilitySchema
    boundaryReason: str
    types: list[V3MemoryTypeSchema]
    occurredAt: V3OccurredAtSchema
    entities: list[V3EntitySchema] = Field(default_factory=list, max_length=12)
    relationships: list[V3RelationshipSchema] = Field(default_factory=list, max_length=12)
    actions: list[str] = Field(default_factory=list, max_length=8)
    topics: list[str] = Field(default_factory=list, max_length=8)

    @field_validator("text")
    @classmethod
    def _text_length(cls, value: str) -> str:
        text = (value or "").strip()
        if not text or len(text) > 2000:
            raise ValueError("text must be 1..2000 characters")
        return text

    @field_validator("summary")
    @classmethod
    def _summary_length(cls, value: str) -> str:
        text = (value or "").strip()
        if not text or len(text) > 500:
            raise ValueError("summary must be 1..500 characters")
        return text

    @field_validator("boundaryReason")
    @classmethod
    def _boundary_length(cls, value: str) -> str:
        text = (value or "").strip()
        if not text or len(text) > 500:
            raise ValueError("boundaryReason must be 1..500 characters")
        return text

    @field_validator("actions", "topics", mode="before")
    @classmethod
    def _list_strings(cls, value):
        return [str(item) for item in (value or []) if str(item).strip()]

    @field_validator("actions", "topics")
    @classmethod
    def _limits(cls, value: list[str]) -> list[str]:
        return [str(item).strip()[:120] for item in value if str(item).strip()][:8]

    @field_validator("types")
    @classmethod
    def _types_limit(cls, value: list[V3MemoryTypeSchema]) -> list[V3MemoryTypeSchema]:
        if len(value) > 6:
            raise ValueError("at most 6 memory types are allowed")
        seen = set()
        for entry in value:
            if entry.type in seen:
                raise ValueError(f"duplicate memory type: {entry.type}")
            seen.add(entry.type)
        total = sum(entry.weight for entry in value)
        if total > 1.0001:
            raise ValueError(f"Type weights sum to {total:.3f}, which exceeds 1.0")
        return value

    @field_validator("evidenceSpans")
    @classmethod
    def _spans(cls, value: list[EvidenceSpanSchema]) -> list[EvidenceSpanSchema]:
        if not (1 <= len(value) <= 5):
            raise ValueError("evidenceSpans must contain 1 to 5 entries")
        return value

    @model_validator(mode="after")
    def _spans_ordered(self):
        for index in range(1, len(self.evidenceSpans)):
            if self.evidenceSpans[index].start < self.evidenceSpans[index - 1].end:
                raise ValueError("evidence spans must be ordered and non-overlapping")
        return self


class SemanticExtractionSchema(_BaseModel):
    memories: list[AtomicMemorySchema] = Field(default_factory=list, max_length=25)
