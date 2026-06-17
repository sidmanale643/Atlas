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
  createMemorySource,
  enqueueAnnotationJob,
  enqueueVectorIndexJob,
  getAnnotationStatus,
  getMemorySource,
  getSourceMemoryLinks,
  getVectorIndexStatus,
  linkSourceMemory,
  updateMemorySourceStatus,
  withTransaction,
} from "../db.js";
import {
  deleteMemoryVector,
  hybridSearchMemories,
  indexMemoryVector,
  searchMemoryVectors,
} from "../vector-store.js";
import { getRelatedMemories as deriveRelatedMemories } from "../related-memories.js";
import { retrieveExtractionContext } from "../extraction-context.js";
import { createIngestionService } from "../ingestion-service.js";

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
    createMemorySource,
    updateMemorySourceStatus,
    getMemorySource,
    getSourceMemoryLinks,
    linkSourceMemory,
    enqueueAnnotationJob,
    enqueueVectorIndexJob,
    getAnnotationStatus,
    getVectorIndexStatus,
    withTransaction,
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

  dependencies.ingestionService = createIngestionService(dependencies);

  return dependencies;
}
