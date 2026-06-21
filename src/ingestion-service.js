import { randomUUID } from "node:crypto";
import { retrieveExtractionContext } from "./extraction-context.js";
import {
  COGNITIVE_ANNOTATION_SCHEMA_VERSION,
  SEMANTIC_EXTRACTION_SCHEMA_VERSION,
} from "./schemas.js";

const DEFAULT_METADATA = Object.freeze({ confidence: 0.6, tags: [] });

export function createIngestionService(dependencies) {
  for (const name of [
    "createMemorySource", "updateMemorySourceStatus", "extractAtomicMemories",
    "storeMemory", "updateMemoryGraph", "getMemory", "linkSourceMemory",
    "enqueueAnnotationJob", "enqueueVectorIndexJob", "withTransaction",
  ]) {
    if (typeof dependencies[name] !== "function") {
      throw new Error(`Ingestion service is missing required dependency: ${name}`);
    }
  }

  async function ingest({
    text,
    ingestionDate = new Date().toISOString(),
    source = "ui",
    metadata = {},
    sourceId = randomUUID(),
  }) {
    const existing = dependencies.getMemorySource?.(sourceId);
    if (existing) {
      if (existing.text !== text) {
        throw new Error(`Source ${sourceId} already exists with different text`);
      }
      if (existing.extraction_status === "completed") {
        return completedSourceResult(existing);
      }
    } else {
      dependencies.createMemorySource({
        id: sourceId,
        text,
        source,
        ingestionDate,
        metadata,
      });
    }
    return processSource({ sourceId, text, ingestionDate, source, metadata });
  }

  async function enqueue({
    text,
    ingestionDate = new Date().toISOString(),
    source = "ui",
    metadata = {},
    sourceId = randomUUID(),
  }) {
    if (typeof dependencies.enqueueIngestionJob !== "function") {
      throw new Error("Ingestion service is missing required dependency: enqueueIngestionJob");
    }
    const existing = dependencies.getMemorySource?.(sourceId);
    if (existing) {
      if (existing.text !== text) {
        throw new Error(`Source ${sourceId} already exists with different text`);
      }
      if (existing.extraction_status === "completed") {
        return completedSourceResult(existing);
      }
    } else {
      dependencies.createMemorySource({
        id: sourceId,
        text,
        source,
        ingestionDate,
        metadata,
      });
    }
    dependencies.enqueueIngestionJob({ sourceId });
    return { sourceId, status: "queued", memories: [] };
  }

  async function runIngestion(sourceId, { metadata = {} } = {}) {
    const sourceRecord = dependencies.getMemorySource?.(sourceId);
    if (!sourceRecord) throw new Error(`Source not found: ${sourceId}`);
    return processSource({
      sourceId,
      text: sourceRecord.text,
      ingestionDate: sourceRecord.ingestion_date,
      source: sourceRecord.source,
      metadata: { ...sourceRecord.metadata_json, ...metadata },
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
      ingestionDate: sourceRecord.ingestion_date,
      source: sourceRecord.source,
      metadata: { ...sourceRecord.metadata_json, ...metadata },
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
    const model = await resolveModel(dependencies);
    dependencies.updateMemorySourceStatus(sourceId, "processing", {
      incrementAttempts: true,
      model,
      schemaVersion: SEMANTIC_EXTRACTION_SCHEMA_VERSION,
    });

    try {
      const canonicalizationContext = await optionalCanonicalizationContext(
        text, dependencies, metadata.ownerHash,
      );
      const semanticExtraction = await dependencies.extractAtomicMemories(
        text,
        ingestionDate,
        canonicalizationContext,
      );

      const prepared = [];
      for (const atom of semanticExtraction.memories) {
        prepared.push(await prepareAtom({
          atom,
          source,
          ingestionDate,
          metadata,
          model,
        }));
      }

      const outcomes = dependencies.withTransaction(() => {
        const persisted = prepared.map((item) => persistAtom({
          ...item,
          sourceId,
          sourceRevisionId,
          source,
          ingestionDate,
          model,
        }));
        dependencies.updateMemorySourceStatus(sourceId, "completed", {
          model,
          schemaVersion: SEMANTIC_EXTRACTION_SCHEMA_VERSION,
        });
        return persisted;
      });

      return {
        sourceId,
        status: "completed",
        memories: outcomes,
        ...(outcomes.length === 0 ? { reason: "no_durable_memory" } : {}),
      };
    } catch (error) {
      dependencies.updateMemorySourceStatus(sourceId, "failed", {
        error: error.message,
        model,
        schemaVersion: SEMANTIC_EXTRACTION_SCHEMA_VERSION,
      });
      error.sourceId = sourceId;
      error.code ||= "INGESTION_FAILED";
      throw error;
    }
  }

  async function prepareAtom({ atom, source, ingestionDate, metadata, model }) {
    const candidates = await writeCandidates(atom.text, dependencies, metadata.ownerHash);
    let decision = createDecision("No similar stored memory was found.", 1);
    if (candidates.available && candidates.items.length > 0) {
      try {
        decision = await dependencies.decideMemoryWrite(
          { text: atom.text, summary: atom.summary, ...atomMetadata(atom, metadata) },
          candidates.items,
        );
      } catch {
        decision = createDecision("Memory matching was inconclusive.");
      }
    } else if (!candidates.available) {
      decision = createDecision("Memory candidate search was unavailable.");
    }

    if (decision.action !== "create") {
      const valid = decision.confidence >= 0.85
        && candidates.items.some(({ id }) => id === decision.matchedMemoryId);
      if (!valid) decision = createDecision("The possible memory match was uncertain.");
    }

    let storedAtom = atom;
    const replacementText = decision.replacementText?.trim();
    if (decision.action === "update" && replacementText && replacementText !== atom.text) {
      const replacement = await dependencies.extractAtomicMemories(
        replacementText,
        ingestionDate,
        await optionalCanonicalizationContext(replacementText, dependencies, metadata.ownerHash),
      );
      if (replacement.memories.length !== 1) {
        throw new Error("Memory update replacement must resolve to exactly one atomic memory");
      }
      storedAtom = replacement.memories[0];
    }

    return {
      atom: storedAtom,
      sourceEvidence: atom.evidenceSpans,
      decision,
      memoryId: decision.action === "create"
        ? dependencies.createMemoryId?.() ?? randomUUID()
        : decision.matchedMemoryId,
      metadata: atomMetadata(storedAtom, metadata),
      source,
      ingestionDate,
      model,
    };
  }

  function persistAtom({
    atom, sourceEvidence, decision, memoryId, metadata, sourceId,
    sourceRevisionId, source, ingestionDate, model,
  }) {
    let memory;
    if (decision.action === "unchanged") {
      memory = dependencies.getMemory(memoryId);
      if (!memory) throw new Error(`Matched memory not found: ${memoryId}`);
    } else if (decision.action === "update") {
      memory = dependencies.updateMemoryGraph({
        memoryId,
        rawText: atom.text,
        ingestionDate,
        extraction: atom,
        model,
        metadata,
        schemaVersion: SEMANTIC_EXTRACTION_SCHEMA_VERSION,
      }).memory;
    } else {
      memory = dependencies.storeMemory(
        memoryId,
        atom.text,
        ingestionDate,
        atom,
        model,
        source,
        metadata,
      );
    }

    const action = normalizeAction(decision.action);
    dependencies.linkSourceMemory({
      sourceId,
      sourceRevisionId,
      memoryId,
      action,
      evidence: sourceEvidence,
      model,
      schemaVersion: SEMANTIC_EXTRACTION_SCHEMA_VERSION,
      confidence: decision.confidence,
      reason: decision.reason,
    });
    if (action !== "unchanged") {
      dependencies.enqueueAnnotationJob({
        memoryId,
        sourceId,
        model,
        schemaVersion: COGNITIVE_ANNOTATION_SCHEMA_VERSION,
      });
      dependencies.enqueueVectorIndexJob({ memoryId, sourceId });
    }

    const serialized = dependencies.serializeMemory?.(memory) ?? memory;
    return {
      action,
      memory: serialized,
      matchedMemoryId: action === "created" ? null : decision.matchedMemoryId,
      confidence: decision.confidence,
      reason: decision.reason,
      evidenceSpans: sourceEvidence,
      annotationStatus: action === "unchanged"
        ? normalizeStatus(dependencies.getAnnotationStatus?.(memoryId), "completed")
        : "pending",
      indexStatus: action === "unchanged"
        ? normalizeStatus(dependencies.getVectorIndexStatus?.(memoryId), "completed")
        : "pending",
    };
  }

  function completedSourceResult(sourceRecord) {
    const links = dependencies.getSourceMemoryLinks?.(sourceRecord.id) || [];
    return {
      sourceId: sourceRecord.id,
      status: "completed",
      memories: links.map((link) => ({
        action: link.action,
        memory: dependencies.serializeMemory?.(dependencies.getMemory(link.memory_id))
          ?? dependencies.getMemory(link.memory_id),
        matchedMemoryId: link.action === "created" ? null : link.memory_id,
        confidence: link.decision_confidence,
        reason: link.decision_reason,
        evidenceSpans: link.evidence_json,
        annotationStatus: normalizeStatus(
          dependencies.getAnnotationStatus?.(link.memory_id),
          "completed",
        ),
        indexStatus: normalizeStatus(
          dependencies.getVectorIndexStatus?.(link.memory_id),
          "completed",
        ),
      })),
    };
  }

  return { ingest, enqueue, runIngestion, reprocess };
}

async function optionalCanonicalizationContext(text, dependencies, ownerHash) {
  try {
    return await retrieveExtractionContext(text, { ...dependencies, ownerHash });
  } catch {
    return { entities: [] };
  }
}

async function writeCandidates(text, dependencies, ownerHash) {
  try {
    const hits = await dependencies.searchMemoryVectors(text, { limit: 50 });
    return {
      available: true,
      items: hits
        .filter(({ id }) => !ownerHash || dependencies.getMemory(id)?.owner_hash === ownerHash)
        .slice(0, 5)
        .map(({ id }) => serializeCandidate(id, dependencies))
        .filter(Boolean),
    };
  } catch {
    return { available: false, items: [] };
  }
}

async function resolveModel(dependencies) {
  return dependencies.model || dependencies.getModel?.() || "unknown";
}

function atomMetadata(atom, metadata) {
  const extractedType = atom.category
    || metadata.type
    || categoryFromCognitiveType(atom.types);
  return {
    ...DEFAULT_METADATA,
    type: metadata.forceType && metadata.type
      ? metadata.type
      : extractedType,
    title: atom.summary || atom.text.slice(0, 50),
    confidence: atom.durability?.confidence ?? DEFAULT_METADATA.confidence,
    tags: Array.isArray(metadata.tags) ? metadata.tags : [],
    ...(metadata.ownerHash ? { ownerHash: metadata.ownerHash } : {}),
  };
}

function categoryFromCognitiveType(types = []) {
  switch (dominantType(types)) {
    case "episodic": return "event";
    case "procedural": return "learning";
    case "emotional": return "observation";
    case "working": return "instruction";
    default: return "fact";
  }
}

function dominantType(types = []) {
  return [...types].sort((left, right) =>
    right.weight - left.weight || left.type.localeCompare(right.type))[0]?.type || null;
}

function serializeCandidate(id, dependencies) {
  const memory = dependencies.getMemory(id);
  if (!memory) return null;
  const extraction = dependencies.getLatestExtraction?.(id)?.extraction_json ?? null;
  return { id: memory.id, text: memory.raw_text, summary: memory.summary,
    type: memory.type, title: memory.title, tags: memory.tags, extraction };
}

function createDecision(reason, confidence = 0) {
  return { action: "create", matchedMemoryId: null, confidence, reason, replacementText: "" };
}

function normalizeAction(action) {
  return action === "create" ? "created" : action === "update" ? "updated" : "unchanged";
}

function normalizeStatus(status, fallback) {
  return ["pending", "processing", "completed", "failed"].includes(status)
    ? status
    : fallback;
}
