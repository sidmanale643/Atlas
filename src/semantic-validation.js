import { SemanticExtractionSchema } from "./schemas.js";

export const SEMANTIC_VALIDATION_CODES = Object.freeze({
  SCHEMA_INVALID: "schema_invalid",
  EVIDENCE_OUT_OF_BOUNDS: "evidence_out_of_bounds",
  EVIDENCE_TEXT_MISMATCH: "evidence_text_mismatch",
  DURABILITY_REJECTED: "durability_rejected",
  USER_FACING_FIRST_PERSON: "user_facing_first_person",
  USER_FACING_USER_MISSING: "user_facing_user_missing",
  USER_FACING_IMPLEMENTATION_DATE: "user_facing_implementation_date",
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

// Keep uppercase acronyms and Roman numerals such as "US" and "World War I"
// from being mistaken for first-person pronouns.
const FIRST_PERSON_PATTERN =
  /\b(?:I|[Mm]e|[Mm]y|[Mm]ine|[Mm]yself|[Ww]e|[Uu]s|[Oo]ur|[Oo]urs|[Oo]urselves|[Ss]elf|[Tt]he speaker)\b/;
const SOURCE_AUTHOR_PATTERN =
  /\b(?:I|[Mm]e|[Mm]y|[Mm]ine|[Mm]yself|[Ww]e|[Uu]s|[Oo]ur|[Oo]urs|[Oo]urselves)\b/;

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
    this.warnings = result.warnings;
    this.dropCounts = result.dropCounts;
    this.extraction = result.extraction;
  }
}

export function validateSemanticExtraction(sourceText, candidate) {
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
      warnings: [],
      dropCounts: { ...EMPTY_DROP_COUNTS },
    };
  }

  const warnings = [];
  const rejectedIssues = [];
  const dropCounts = { ...EMPTY_DROP_COUNTS };
  const accepted = [];

  for (const [atomIndex, memory] of parsed.data.memories.entries()) {
    const atomPath = ["memories", atomIndex];
    const normalized = normalizeMemory(
      sourceText,
      memory,
      atomPath,
      warnings,
      dropCounts,
    );

    if (
      !normalized.durability.durable
      || normalized.durability.confidence
        < SEMANTIC_ACCEPTANCE_THRESHOLDS.durability
    ) {
      warnings.push(issue(
        SEMANTIC_VALIDATION_CODES.DURABILITY_REJECTED,
        [...atomPath, "durability"],
        "dropped atom below the durable-memory acceptance threshold",
      ));
      continue;
    }

    const coreIssues = validateCoreMemory(sourceText, normalized, atomPath);
    if (coreIssues.length > 0) {
      rejectedIssues.push(...coreIssues);
      continue;
    }
    accepted.push(normalized);
  }

  const memories = deduplicateMemories(accepted, warnings);
  const noUsableMemory = parsed.data.memories.length > 0
    && memories.length === 0
    && rejectedIssues.length > 0;

  return {
    success: !noUsableMemory,
    extraction: { memories },
    issues: noUsableMemory ? rejectedIssues : [],
    warnings: [...warnings, ...(noUsableMemory ? [] : rejectedIssues)],
    dropCounts,
  };
}

export function assertValidSemanticExtraction(sourceText, candidate, options) {
  const result = validateSemanticExtraction(sourceText, candidate, options);
  if (!result.success) throw new SemanticValidationError(result);
  return result;
}

function normalizeMemory(sourceText, memory, atomPath, warnings, dropCounts) {
  const types = normalizeTypes(memory.types, warnings, dropCounts, atomPath);
  const entities = normalizeEntities(memory, warnings, dropCounts, atomPath);
  const relationships = normalizeRelationships(
    memory,
    entities,
    warnings,
    dropCounts,
    atomPath,
  );
  const actions = normalizeUniqueStrings(memory.actions, "actions", dropCounts);
  const topics = normalizeUniqueStrings(memory.topics, "topics", dropCounts);
  const occurredAt = normalizeOccurredAt(sourceText, memory.occurredAt, warnings, atomPath);
  const summary = FIRST_PERSON_PATTERN.test(memory.summary)
    ? memory.text
    : memory.summary;

  if (summary !== memory.summary) {
    warnings.push(issue(
      SEMANTIC_VALIDATION_CODES.USER_FACING_FIRST_PERSON,
      [...atomPath, "summary"],
      "replaced non-third-person summary with memory text",
    ));
  }

  return {
    ...memory,
    summary,
    types,
    occurredAt,
    entities,
    relationships,
    actions,
    topics,
  };
}

function normalizeTypes(types, warnings, dropCounts, atomPath) {
  const dominantTypeIndex = types.reduce(
    (dominant, type, index) =>
      dominant === -1 || type.weight > types[dominant].weight ? index : dominant,
    -1,
  );
  return types.filter((type, index) => {
    const accepted = index === dominantTypeIndex
      || type.weight >= SEMANTIC_ACCEPTANCE_THRESHOLDS.secondaryType;
    if (!accepted) {
      dropCounts.types += 1;
      warnings.push(issue(
        SEMANTIC_VALIDATION_CODES.SCHEMA_INVALID,
        [...atomPath, "types", index],
        "dropped weak secondary memory type",
      ));
    }
    return accepted;
  });
}

function normalizeEntities(memory, warnings, dropCounts, atomPath) {
  const entities = [];
  const seen = new Set();

  for (const [entityIndex, entity] of memory.entities.entries()) {
    const path = [...atomPath, "entities", entityIndex];
    if (entity.confidence < SEMANTIC_ACCEPTANCE_THRESHOLDS.entity) {
      dropCounts.entities += 1;
      continue;
    }

    const evidence = resolveEvidence(memory, entity.evidenceSpanIndexes);
    const mention = evidence && findLiteral(evidence.map(({ text }) => text), entity.mention);
    if (!mention) {
      dropCounts.entities += 1;
      warnings.push(issue(
        SEMANTIC_VALIDATION_CODES.ENTITY_MENTION_UNSUPPORTED,
        [...path, "mention"],
        "dropped entity whose mention was not present in cited evidence",
      ));
      continue;
    }

    const normalized = { ...entity, mention };
    const key = [normalized.mention, normalized.kind, normalized.canonicalName || ""]
      .map(normalizeKey)
      .join("\u0000");
    if (seen.has(key)) {
      dropCounts.entities += 1;
      warnings.push(issue(
        SEMANTIC_VALIDATION_CODES.DUPLICATE_ENTITY,
        path,
        "dropped duplicate entity",
      ));
      continue;
    }
    seen.add(key);
    entities.push(normalized);
  }

  return entities;
}

function normalizeRelationships(memory, entities, warnings, dropCounts, atomPath) {
  const entityNames = new Map();
  for (const entity of entities) {
    for (const name of [entity.mention, entity.canonicalName]) {
      if (name) entityNames.set(normalizeKey(name), name);
    }
  }

  const relationships = [];
  const seen = new Set();
  for (const [relationshipIndex, relationship] of memory.relationships.entries()) {
    const path = [...atomPath, "relationships", relationshipIndex];
    if (relationship.confidence < SEMANTIC_ACCEPTANCE_THRESHOLDS.relationship) {
      dropCounts.relationships += 1;
      continue;
    }

    const evidence = resolveEvidence(memory, relationship.evidenceSpanIndexes);
    if (!evidence) {
      dropCounts.relationships += 1;
      warnings.push(issue(
        SEMANTIC_VALIDATION_CODES.EVIDENCE_INDEX_OUT_OF_BOUNDS,
        [...path, "evidenceSpanIndexes"],
        "dropped relationship with invalid evidence indexes",
      ));
      continue;
    }

    const subject = normalizeRelationshipEndpoint(
      relationship.subject,
      entityNames,
      evidence,
    );
    const object = normalizeRelationshipEndpoint(
      relationship.object,
      entityNames,
      evidence,
    );
    if (!subject || !object) {
      dropCounts.relationships += 1;
      warnings.push(issue(
        SEMANTIC_VALIDATION_CODES.RELATIONSHIP_ENDPOINT_UNSUPPORTED,
        path,
        "dropped relationship with an unsupported endpoint",
      ));
      continue;
    }

    const normalized = { ...relationship, subject, object };
    const key = [subject, normalized.predicate, object]
      .map(normalizeKey)
      .join("\u0000");
    if (seen.has(key)) {
      dropCounts.relationships += 1;
      warnings.push(issue(
        SEMANTIC_VALIDATION_CODES.DUPLICATE_RELATIONSHIP,
        path,
        "dropped duplicate relationship",
      ));
      continue;
    }
    seen.add(key);
    relationships.push(normalized);
  }

  return relationships;
}

function normalizeRelationshipEndpoint(value, entityNames, evidence) {
  const key = normalizeKey(value);
  if (["self", "user", "the user", "user's"].includes(key)) {
    return "self";
  }
  if (entityNames.has(key)) return entityNames.get(key);
  return findLiteral(evidence.map(({ text }) => text), value);
}

function normalizeOccurredAt(sourceText, occurredAt, warnings, atomPath) {
  if (!occurredAt.text) {
    if (occurredAt.normalized === null) return occurredAt;
    warnings.push(issue(
      SEMANTIC_VALIDATION_CODES.OCCURRED_AT_TEXT_MISSING,
      [...atomPath, "occurredAt"],
      "cleared occurrence date without source text evidence",
    ));
    return { text: "", normalized: null, confidence: 0 };
  }

  const text = findLiteral([sourceText], occurredAt.text);
  if (text) return { ...occurredAt, text };
  warnings.push(issue(
    SEMANTIC_VALIDATION_CODES.OCCURRED_AT_TEXT_MISMATCH,
    [...atomPath, "occurredAt"],
    "cleared occurrence date not found in source text",
  ));
  return { text: "", normalized: null, confidence: 0 };
}

function validateCoreMemory(sourceText, memory, atomPath) {
  const issues = [];
  for (const [spanIndex, span] of memory.evidenceSpans.entries()) {
    const path = [...atomPath, "evidenceSpans", spanIndex];
    if (span.end > sourceText.length) {
      issues.push(issue(
        SEMANTIC_VALIDATION_CODES.EVIDENCE_OUT_OF_BOUNDS,
        path,
        `span end ${span.end} exceeds source length ${sourceText.length}`,
      ));
    }
    if (sourceText.slice(span.start, span.end) !== span.text) {
      issues.push(issue(
        SEMANTIC_VALIDATION_CODES.EVIDENCE_TEXT_MISMATCH,
        [...path, "text"],
        "span text must exactly equal the source slice",
      ));
    }
  }

  if (FIRST_PERSON_PATTERN.test(memory.text)) {
    issues.push(issue(
      SEMANTIC_VALIDATION_CODES.USER_FACING_FIRST_PERSON,
      [...atomPath, "text"],
      "text must refer to the memory owner in third person as user or user's",
    ));
  }
  const hasFirstPersonEvidence = memory.evidenceSpans.some(({ text }) =>
    SOURCE_AUTHOR_PATTERN.test(text)
  );
  if (hasFirstPersonEvidence && !/\buser\b/i.test(memory.text)) {
    issues.push(issue(
      SEMANTIC_VALIDATION_CODES.USER_FACING_USER_MISSING,
      [...atomPath, "text"],
      "text must identify the first-person source author as user",
    ));
  }
  return issues;
}

function resolveEvidence(memory, indexes) {
  if (indexes.some((index) => index >= memory.evidenceSpans.length)) return null;
  return indexes.map((index) => memory.evidenceSpans[index]);
}

function findLiteral(texts, value) {
  const needle = String(value).trim();
  if (!needle) return null;
  for (const text of texts) {
    const exactIndex = text.indexOf(needle);
    if (exactIndex >= 0) return text.slice(exactIndex, exactIndex + needle.length);
    const foldedIndex = text.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase());
    if (foldedIndex >= 0) return text.slice(foldedIndex, foldedIndex + needle.length);
  }
  return null;
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

function deduplicateMemories(memories, warnings) {
  const seen = new Set();
  return memories.filter((memory, index) => {
    const key = normalizeKey(memory.text);
    if (!seen.has(key)) {
      seen.add(key);
      return true;
    }
    warnings.push(issue(
      SEMANTIC_VALIDATION_CODES.DUPLICATE_ATOM,
      ["memories", index, "text"],
      "dropped duplicate atom",
    ));
    return false;
  });
}

function normalizeKey(value) {
  return String(value).normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function issue(code, path, message) {
  return { code, path, message };
}
