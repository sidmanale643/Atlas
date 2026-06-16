import {
  closeDb,
  deleteMemory,
  findEntities,
  getEntitiesForMemory,
  getLatestExtraction,
  getMemories,
  getMemoriesForEntity,
  getMemory,
  getRegionActivations,
  getRelationshipsForMemory,
  getStructuralMemoryLinks,
  searchMemoriesFts,
  storeMemory,
  updateMemoryGraph,
  updateMemorySummary,
} from "../db.js";
import {
  deleteMemoryVector,
  hybridSearchMemories,
  indexMemoryVector,
  searchMemoryVectors,
} from "../vector-store.js";
import { getRelatedMemories as deriveRelatedMemories } from "../related-memories.js";
import { retrieveExtractionContext } from "../extraction-context.js";

function serializeMemory(memory) {
  if (!memory) return null;
  return {
    ...memory,
    extraction: getLatestExtraction(memory.id),
    entities: getEntitiesForMemory(memory.id),
    relationships: getRelationshipsForMemory(memory.id),
    regions: getRegionActivations(memory.id),
  };
}

export function defaultDependencies() {
  const dependencies = {
    closeDb,
    decideMemoryWrite: async (...args) => {
      const mod = await import("../llm.js");
      return mod.decideMemoryWrite(...args);
    },
    deleteMemory,
    deleteMemoryVector,
    extractAtomicMemories: async (...args) => {
      const mod = await import("../llm.js");
      return mod.extractAtomicMemories(...args);
    },
    findEntities,
    getEntitiesForMemory,
    getLatestExtraction,
    getMemories,
    getMemoriesForEntity,
    getMemory,
    getRegionActivations,
    getRelationshipsForMemory,
    getStructuralMemoryLinks,
    hybridSearchMemories,
    indexMemoryVector,
    model: undefined,
    retrieveExtractionContext,
    searchMemoryVectors,
    serializeMemory,
    storeMemory,
    updateMemoryGraph,
    updateMemorySummary,
  };

  dependencies.getModel = async () => {
    const mod = await import("../llm-config.js");
    dependencies.model = mod.model;
    return mod.model;
  };

  dependencies.getRelatedMemories = (id, options) =>
    deriveRelatedMemories(
      id,
      {
        getMemory,
        getStructuralMemoryLinks,
        searchMemoryVectors,
        searchMemoriesFts,
        serializeMemory,
      },
      options,
    );

  // Lazy: only build the ingestion service when `add` is actually invoked.
  dependencies.ingestionService = {
    ingest: async (input) => {
      const mod = await import("../memory-write.js");
      return mod.ingestMemory({
        dependencies,
        text: input.text,
        source: input.source || "cli",
        metadata: input.metadata || {},
      });
    },
  };

  return dependencies;
}

