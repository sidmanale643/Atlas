import { SemanticExtractionSchema } from "./schemas.js";

export const SEMANTIC_VALIDATION_CODES = Object.freeze({
  SCHEMA_INVALID: "schema_invalid",
  EVIDENCE_OUT_OF_BOUNDS: "evidence_out_of_bounds",
  EVIDENCE_TEXT_MISMATCH: "evidence_text_mismatch",
  DURABILITY_REJECTED: "durability_rejected",
  OCCURRED_AT_TEXT_MISSING: "occurred_at_text_missing",
  OCCURRED_AT_TEXT_MISMATCH: "occurred_at_text_mismatch",
  EVIDENCE_INDEX_OUT_OF_BOUNDS: "evidence_index_out_of_bounds",
  ENTITY_MENTION_UNSUPPORTED: "entity_mention_unsupported",
  DUPLICATE_ENTITY: "duplicate_entity",
  RELATIONSHIP_ENDPOINT_UNSUPPORTED: "relationship_endpoint_unsupported",
  DUPLICATE_RELATIONSHIP: "duplicate_relationship",
  DUPLICATE_ATOM: "duplicate_atom",
  BOUNDARY_MULTIPLE_SENTENCES: "boundary_multiple_sentences",
  BOUNDARY_MULTIPLE_SUBJECTS: "boundary_multiple_subjects",
  BOUNDARY_BROAD_SOURCE_COVERAGE: "boundary_broad_source_coverage",
  BOUNDARY_INDEPENDENT_AND_CLAIMS: "boundary_independent_and_claims",
});

export const SEMANTIC_ACCEPTANCE_THRESHOLDS = Object.freeze({
  durability: 0.70,
  entity: 0.70,
  relationship: 0.75,
  secondaryType: 0.15,
});

const EMPTY_DROP_COUNTS = Object.freeze({
  entities: 0,
  relationships: 0,
  types: 0,
  actions: 0,
  topics: 0,
});

export class SemanticValidationError extends Error {
  constructor(result) {
    const details = result.issues
      .map(({ code, path, message }) =>
        `${code}${path.length ? ` at ${path.join(".")}` : ""}: ${message}`)
      .join("; ");
    super(`Semantic extraction failed deterministic validation: ${details}`);
    this.name = "SemanticValidationError";
    this.code = "SEMANTIC_EXTRACTION_INVALID";
    this.issues = result.issues;
    this.dropCounts = result.dropCounts;
    this.extraction = result.extraction;
  }
}

export function validateSemanticExtraction(
  sourceText,
  candidate,
  { boundaryAudit = true } = {},
) {
  if (typeof sourceText !== "string") {
    throw new TypeError("sourceText must be a string");
  }

  const parsed = SemanticExtractionSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      success: false,
      extraction: null,
      issues: parsed.error.issues.map((issue) => ({
        code: SEMANTIC_VALIDATION_CODES.SCHEMA_INVALID,
        path: issue.path,
        message: issue.message,
      })),
      dropCounts: { ...EMPTY_DROP_COUNTS },
    };
  }

  const issues = [];
  const dropCounts = { ...EMPTY_DROP_COUNTS };
  const memories = parsed.data.memories.map((memory, atomIndex) => {
    const normalized = applyAcceptancePolicy(memory, dropCounts);
    validateAtom(sourceText, normalized, atomIndex, issues, boundaryAudit);
    return normalized;
  });
  validateDuplicateAtoms(memories, issues);

  return {
    success: issues.length === 0,
    extraction: { memories },
    issues,
    dropCounts,
  };
}

export function assertValidSemanticExtraction(sourceText, candidate, options) {
  const result = validateSemanticExtraction(sourceText, candidate, options);
  if (!result.success) throw new SemanticValidationError(result);
  return result;
}

function applyAcceptancePolicy(memory, dropCounts) {
  const allEntityNames = new Set(
    memory.entities.flatMap((entity) => [entity.mention, entity.canonicalName])
      .filter(Boolean)
      .map(normalizeKey),
  );
  const entities = memory.entities.filter((entity) => {
    const accepted = entity.confidence >= SEMANTIC_ACCEPTANCE_THRESHOLDS.entity;
    if (!accepted) dropCounts.entities += 1;
    return accepted;
  });
  const entityNames = new Set(
    entities.flatMap((entity) => [entity.mention, entity.canonicalName])
      .filter(Boolean)
      .map(normalizeKey),
  );
  const relationships = memory.relationships.filter((relationship) => {
    const accepted = relationship.confidence
      >= SEMANTIC_ACCEPTANCE_THRESHOLDS.relationship;
    if (!accepted) dropCounts.relationships += 1;
    return accepted;
  }).filter((relationship) => {
    const accepted = !endpointReferencesDroppedEntity(
      relationship.subject,
      allEntityNames,
      entityNames,
    ) && !endpointReferencesDroppedEntity(
      relationship.object,
      allEntityNames,
      entityNames,
    );
    if (!accepted) dropCounts.relationships += 1;
    return accepted;
  });
  const dominantTypeIndex = memory.types.reduce(
    (dominant, type, index, types) =>
      dominant === -1 || type.weight > types[dominant].weight ? index : dominant,
    -1,
  );
  const types = memory.types.filter((type, index) => {
    const accepted = index === dominantTypeIndex
      || type.weight >= SEMANTIC_ACCEPTANCE_THRESHOLDS.secondaryType;
    if (!accepted) dropCounts.types += 1;
    return accepted;
  });
  const actions = normalizeUniqueStrings(memory.actions, "actions", dropCounts);
  const topics = normalizeUniqueStrings(memory.topics, "topics", dropCounts);

  return { ...memory, entities, relationships, types, actions, topics };
}

function endpointReferencesDroppedEntity(endpoint, allEntityNames, acceptedEntityNames) {
  const key = normalizeKey(endpoint);
  return allEntityNames.has(key) && !acceptedEntityNames.has(key);
}

function normalizeUniqueStrings(values, field, dropCounts) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const trimmed = value.trim();
    const key = normalizeKey(trimmed);
    if (seen.has(key)) {
      dropCounts[field] += 1;
      continue;
    }
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function validateAtom(sourceText, memory, atomIndex, issues, boundaryAudit) {
  const atomPath = ["memories", atomIndex];
  const spans = memory.evidenceSpans;
  for (const [spanIndex, span] of spans.entries()) {
    const path = [...atomPath, "evidenceSpans", spanIndex];
    if (span.end > sourceText.length) {
      addIssue(
        issues,
        SEMANTIC_VALIDATION_CODES.EVIDENCE_OUT_OF_BOUNDS,
        path,
        `span end ${span.end} exceeds source length ${sourceText.length}`,
      );
    }
    if (sourceText.slice(span.start, span.end) !== span.text) {
      addIssue(
        issues,
        SEMANTIC_VALIDATION_CODES.EVIDENCE_TEXT_MISMATCH,
        [...path, "text"],
        "span text must exactly equal the source slice",
      );
    }
  }

  if (!memory.durability.durable
    || memory.durability.confidence < SEMANTIC_ACCEPTANCE_THRESHOLDS.durability) {
    addIssue(
      issues,
      SEMANTIC_VALIDATION_CODES.DURABILITY_REJECTED,
      [...atomPath, "durability"],
      "atom does not meet the durable-memory acceptance threshold",
    );
  }

  validateOccurredAt(sourceText, memory.occurredAt, atomPath, issues);
  validateEntities(memory, atomPath, issues);
  validateRelationships(memory, atomPath, issues);
  if (boundaryAudit) auditBoundaries(sourceText, memory, atomPath, issues);
}

function validateOccurredAt(sourceText, occurredAt, atomPath, issues) {
  if (!occurredAt.text) {
    if (occurredAt.normalized !== null) {
      addIssue(
        issues,
        SEMANTIC_VALIDATION_CODES.OCCURRED_AT_TEXT_MISSING,
        [...atomPath, "occurredAt", "text"],
        "a normalized occurrence date requires an exact source time phrase",
      );
    }
    return;
  }
  if (!sourceText.includes(occurredAt.text)) {
    addIssue(
      issues,
      SEMANTIC_VALIDATION_CODES.OCCURRED_AT_TEXT_MISMATCH,
      [...atomPath, "occurredAt", "text"],
      "occurredAt.text must be an exact source substring",
    );
  }
}

function validateEntities(memory, atomPath, issues) {
  const seen = new Set();
  for (const [entityIndex, entity] of memory.entities.entries()) {
    const path = [...atomPath, "entities", entityIndex];
    const evidence = resolveEvidence(memory, entity.evidenceSpanIndexes, path, issues);
    if (!evidence.some((span) => span.text.includes(entity.mention))) {
      addIssue(
        issues,
        SEMANTIC_VALIDATION_CODES.ENTITY_MENTION_UNSUPPORTED,
        [...path, "mention"],
        "entity mention must occur exactly inside cited evidence",
      );
    }
    const key = [entity.mention, entity.kind, entity.canonicalName || ""]
      .map(normalizeKey)
      .join("\u0000");
    if (seen.has(key)) {
      addIssue(
        issues,
        SEMANTIC_VALIDATION_CODES.DUPLICATE_ENTITY,
        path,
        "duplicate entity after normalization",
      );
    }
    seen.add(key);
  }
}

function validateRelationships(memory, atomPath, issues) {
  const entityNames = new Set(
    memory.entities.flatMap((entity) => [entity.mention, entity.canonicalName])
      .filter(Boolean)
      .map(normalizeKey),
  );
  const seen = new Set();
  for (const [relationshipIndex, relationship] of memory.relationships.entries()) {
    const path = [...atomPath, "relationships", relationshipIndex];
    const evidence = resolveEvidence(
      memory,
      relationship.evidenceSpanIndexes,
      path,
      issues,
    );
    for (const field of ["subject", "object"]) {
      const endpoint = relationship[field];
      const resolved = normalizeKey(endpoint) === "self"
        || entityNames.has(normalizeKey(endpoint))
        || evidence.some((span) => span.text.includes(endpoint));
      if (!resolved) {
        addIssue(
          issues,
          SEMANTIC_VALIDATION_CODES.RELATIONSHIP_ENDPOINT_UNSUPPORTED,
          [...path, field],
          `${field} must resolve to self, an extracted entity, or an exact evidence literal`,
        );
      }
    }
    const key = [relationship.subject, relationship.predicate, relationship.object]
      .map(normalizeKey)
      .join("\u0000");
    if (seen.has(key)) {
      addIssue(
        issues,
        SEMANTIC_VALIDATION_CODES.DUPLICATE_RELATIONSHIP,
        path,
        "duplicate relationship after normalization",
      );
    }
    seen.add(key);
  }
}

function resolveEvidence(memory, indexes, path, issues) {
  const evidence = [];
  for (const [position, index] of indexes.entries()) {
    if (index >= memory.evidenceSpans.length) {
      addIssue(
        issues,
        SEMANTIC_VALIDATION_CODES.EVIDENCE_INDEX_OUT_OF_BOUNDS,
        [...path, "evidenceSpanIndexes", position],
        `evidence span index ${index} does not exist`,
      );
      continue;
    }
    evidence.push(memory.evidenceSpans[index]);
  }
  return evidence;
}

function validateDuplicateAtoms(memories, issues) {
  const seen = new Map();
  for (const [index, memory] of memories.entries()) {
    const key = normalizeKey(memory.text);
    if (seen.has(key)) {
      addIssue(
        issues,
        SEMANTIC_VALIDATION_CODES.DUPLICATE_ATOM,
        ["memories", index, "text"],
        `duplicates atom ${seen.get(key)}`,
      );
    } else {
      seen.set(key, index);
    }
  }
}

function auditBoundaries(sourceText, memory, atomPath, issues) {
  if (sentenceCount(memory.text) > 1) {
    addIssue(
      issues,
      SEMANTIC_VALIDATION_CODES.BOUNDARY_MULTIPLE_SENTENCES,
      [...atomPath, "text"],
      "atom contains multiple complete sentences",
    );
  }

  const subjects = new Set(memory.relationships.map((item) => normalizeKey(item.subject)));
  if (subjects.size > 1) {
    addIssue(
      issues,
      SEMANTIC_VALIDATION_CODES.BOUNDARY_MULTIPLE_SUBJECTS,
      [...atomPath, "relationships"],
      "atom contains relationship claims about multiple subjects",
    );
  }

  if (sentenceCount(sourceText) > 1 && sourceText.length > 0) {
    const covered = memory.evidenceSpans.reduce(
      (total, span) => total + Math.max(0, span.end - span.start),
      0,
    );
    if (covered / sourceText.length >= 0.8) {
      addIssue(
        issues,
        SEMANTIC_VALIDATION_CODES.BOUNDARY_BROAD_SOURCE_COVERAGE,
        [...atomPath, "evidenceSpans"],
        "one atom covers most of a multi-sentence source",
      );
    }
  }

  const statePredicates = new Set([
    "lives_in",
    "works_at",
    "prefers",
    "related_to",
    "uses",
    "scheduled_for",
  ]);
  const predicates = new Set(
    memory.relationships
      .map((item) => normalizeKey(item.predicate).replaceAll(" ", "_"))
      .filter((predicate) => statePredicates.has(predicate)),
  );
  if (/\band\b/i.test(memory.text) && predicates.size > 1) {
    addIssue(
      issues,
      SEMANTIC_VALIDATION_CODES.BOUNDARY_INDEPENDENT_AND_CLAIMS,
      [...atomPath, "text"],
      "atom joins multiple independently evolving state predicates with 'and'",
    );
  }
}

function sentenceCount(text) {
  return (String(text).match(/[^.!?]+[.!?]+(?:\s+|$)/g) || []).length;
}

function normalizeKey(value) {
  return String(value).normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function addIssue(issues, code, path, message) {
  issues.push({ code, path, message });
}
