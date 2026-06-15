import { randomUUID } from "node:crypto";
import { retrieveExtractionContext } from "./extraction-context.js";
import {
  COGNITIVE_ANNOTATION_SCHEMA_VERSION,
  SEMANTIC_EXTRACTION_SCHEMA_VERSION,
} from "./schemas.js";

const DEFAULT_METADATA = Object.freeze({
  confidence: 0.6,
  tags: [],
});

export function createIngestionService(dependencies) {
  const {
    createMemorySource,
    updateMemorySourceStatus,
    extractAtomicMemories,
  } = dependencies;

  if (
    typeof createMemorySource !== "function"
    || typeof updateMemorySourceStatus !== "function"
    || typeof extractAtomicMemories !== "function"
  ) {
    throw new Error("Ingestion service is missing required dependencies");
  }

  async function ingest({
    text,
    ingestionDate = new Date().toISOString(),
    source = "ui",
    metadata = {},
    sourceId = randomUUID(),
  }) {
    createMemorySource({
      id: sourceId,
      text,
      source,
      ingestionDate,
    });
    return processSource({
      sourceId,
      text,
      ingestionDate,
      source,
      metadata,
    });
  }

  async function reprocess(sourceId, { metadata = {} } = {}) {
    const sourceRecord = dependencies.getMemorySource(sourceId, {
      includeRevisions: true,
    });
    if (!sourceRecord) throw new Error(`Source not found: ${sourceId}`);
    const revision = sourceRecord.revisions?.[0];
    return processSource({
      sourceId,
      sourceRevisionId: revision?.id ?? null,
      text: revision?.text ?? sourceRecord.text,
      ingestionDate:
        sourceRecord.ingestion_date
        ?? sourceRecord.ingestionDate
        ?? new Date().toISOString(),
      source: sourceRecord.source || "ui",
      metadata,
    });
  }

  async function processSource({
    sourceId,
    sourceRevisionId = null,
    text,
    ingestionDate,
    source,
    metadata,
  }) {
    updateMemorySourceStatus(sourceId, "processing", {
      incrementAttempts: true,
      model: dependencies.model,
      schemaVersion: SEMANTIC_EXTRACTION_SCHEMA_VERSION,
    });

    let similarMemories = [];
    try {
      similarMemories = await retrieveExtractionContext(text, dependencies);
    } catch {
      // Vector search is optional context, not a prerequisite for ingestion.
    }

    let semanticExtraction;
    try {
      semanticExtraction = await extractAtomicMemories(
        text,
        ingestionDate,
        similarMemories,
      );
    } catch (error) {
      updateMemorySourceStatus(sourceId, "extraction_failed", {
        error: error.message,
        model: dependencies.model,
        schemaVersion: SEMANTIC_EXTRACTION_SCHEMA_VERSION,
      });
      throw error;
    }

    const prepared = [];
    for (const atom of semanticExtraction.memories) {
      prepared.push(
        await prepareAtom({
          atom,
          source,
          ingestionDate,
          metadata,
        }),
      );
    }

    const persist = () => {
      const outcomes = prepared.map((item) =>
        persistAtom({
          ...item,
          sourceId,
          sourceRevisionId,
          source,
          ingestionDate,
        }),
      );
      updateMemorySourceStatus(sourceId, "completed", {
        model: dependencies.model,
        schemaVersion: SEMANTIC_EXTRACTION_SCHEMA_VERSION,
      });
      return outcomes;
    };
    const outcomes = dependencies.withTransaction
      ? dependencies.withTransaction(persist)
      : persist();

    await Promise.all(
      outcomes
        .filter(({ action }) => action !== "unchanged")
        .map(async ({ memory }) => {
          try {
            await dependencies.indexMemoryVector(memory);
            return true;
          } catch {
            return false;
          }
        }),
    );

    return { sourceId, memories: outcomes };
  }

  async function prepareAtom({ atom, source, ingestionDate, metadata }) {
    let candidates = [];
    let candidatesAvailable = true;
    try {
      candidates = await retrieveExtractionContext(atom.text, dependencies);
    } catch {
      candidatesAvailable = false;
    }

    let decision = createDecision("No similar stored memory was found.", 1);
    if (candidatesAvailable && candidates.length > 0) {
      try {
        decision = await dependencies.decideMemoryWrite(
          {
            text: atom.text,
            summary: atom.summary,
            ...atomMetadata(atom, metadata),
          },
          candidates.map(({ id }) => serializeCandidate(id, dependencies))
            .filter(Boolean),
        );
      } catch {
        decision = createDecision("Memory matching was inconclusive.");
      }
    } else if (!candidatesAvailable) {
      decision = createDecision("Memory candidate search was unavailable.");
    }

    const validMatch = decision.action === "create"
      || (
        decision.confidence >= 0.85
        && candidates.some(({ id }) => id === decision.matchedMemoryId)
      );
    if (!validMatch) {
      decision = createDecision("The possible memory match was uncertain.");
    }

    let storedAtom = atom;
    const replacementText = decision.replacementText?.trim();
    if (
      decision.action === "update"
      && replacementText
      && replacementText !== atom.text
    ) {
      let replacementContext = [];
      try {
        replacementContext = await retrieveExtractionContext(
          replacementText,
          dependencies,
        );
      } catch {
        // Replacement extraction remains valid without vector context.
      }
      const replacement = await dependencies.extractAtomicMemories(
        replacementText,
        ingestionDate,
        replacementContext,
      );
      if (replacement.memories.length !== 1) {
        throw new Error(
          "Memory update replacement must resolve to one atomic memory",
        );
      }
      storedAtom = replacement.memories[0];
    }

    return {
      atom: storedAtom,
      decision,
      memoryId:
        decision.action === "create"
          ? dependencies.createMemoryId?.() ?? randomUUID()
          : decision.matchedMemoryId,
      metadata: atomMetadata(atom, metadata),
      source,
      ingestionDate,
    };
  }

  function persistAtom({
    atom,
    decision,
    memoryId,
    metadata,
    sourceId,
    sourceRevisionId,
    source,
    ingestionDate,
  }) {
    let memory;
    if (decision.action === "unchanged") {
      memory = dependencies.getMemory(memoryId);
    } else if (decision.action === "update") {
      memory = dependencies.updateMemoryGraph({
        memoryId,
        rawText: atom.text,
        ingestionDate,
        extraction: atom,
        model: dependencies.model,
        metadata,
      }).memory;
    } else {
      memory = dependencies.storeMemory(
        memoryId,
        atom.text,
        ingestionDate,
        atom,
        dependencies.model,
        source,
        metadata,
      );
    }

    dependencies.linkSourceMemory({
      sourceId,
      sourceRevisionId,
      memoryId,
      action: decision.action,
      evidence: [],
    });
    if (decision.action !== "unchanged") {
      dependencies.enqueueAnnotationJob({
        memoryId,
        sourceId,
        model: dependencies.model,
        schemaVersion: COGNITIVE_ANNOTATION_SCHEMA_VERSION,
      });
    }

    return {
      action: normalizeAction(decision.action),
      memory,
      matchedMemoryId:
        decision.action === "create" ? null : decision.matchedMemoryId,
      confidence: decision.confidence,
      reason: decision.reason,
      annotationStatus: normalizeAnnotationStatus(
        dependencies.getAnnotationStatus?.(memoryId),
      ),
    };
  }

  return { ingest, reprocess };
}

export function atomicExtractionFromLegacy(text, extraction) {
  return {
    memories: [{
      text,
      summary: extraction.summary || text,
      types: extraction.types || [],
      occurredAt: extraction.occurredAt || {
        text: "",
        normalized: null,
        confidence: 0,
      },
      entities: extraction.entities || [],
      relationships: extraction.relationships || [],
      actions: extraction.actions || [],
      topics: extraction.topics || [],
    }],
  };
}

function atomMetadata(atom, metadata) {
  const supplied = Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => value !== undefined),
  );
  return {
    ...DEFAULT_METADATA,
    ...supplied,
    type: metadata.type || dominantType(atom.types),
    title: metadata.title || atom.summary || atom.text.slice(0, 50),
    tags: Array.isArray(metadata.tags) ? metadata.tags : [],
  };
}

function dominantType(types = []) {
  return [...types].sort(
    (left, right) =>
      right.weight - left.weight || left.type.localeCompare(right.type),
  )[0]?.type || "fact";
}

function serializeCandidate(id, dependencies) {
  const memory = dependencies.getMemory(id);
  if (!memory) return null;
  return {
    ...memory,
    extraction: dependencies.getLatestExtraction?.(id) ?? null,
  };
}

function createDecision(reason, confidence = 0) {
  return {
    action: "create",
    matchedMemoryId: null,
    confidence,
    reason,
    replacementText: "",
  };
}

function normalizeAction(action) {
  if (action === "create") return "created";
  if (action === "update") return "updated";
  return "unchanged";
}

function normalizeAnnotationStatus(value) {
  if (typeof value === "string") return value;
  return value?.status || "pending";
}
