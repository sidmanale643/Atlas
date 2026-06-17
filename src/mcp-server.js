#!/usr/bin/env node

import "dotenv/config";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
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
} from "./db.js";
import { extractAtomicMemories } from "./llm.js";
import { getRelatedMemories as deriveRelatedMemories } from "./related-memories.js";
import { AddMemorySchema } from "./schemas.js";
import { createIngestionService } from "./ingestion-service.js";
import {
  assertAtlasModeSupported,
  deleteMemoryVector,
  hybridSearchMemories,
  indexMemoryVector,
  searchMemoryVectors,
} from "./vector-store.js";

process.env.LOG_STREAM = "stderr";

const memoryIdSchema = z
  .string()
  .min(1)
  .describe("Atlas memory ID, for example mem_12ab34cd");

const memoryWriteResultSchema = {
  sourceId: z.string().uuid(),
  status: z.literal("completed"),
  memories: z.array(z.object({
    action: z.enum(["created", "updated", "unchanged"]),
    memory: z.object({ id: memoryIdSchema }).passthrough(),
    matchedMemoryId: memoryIdSchema.nullable(),
    confidence: z.number().min(0).max(1),
    reason: z.string().min(1),
    evidenceSpans: z.array(z.object({
      start: z.number().int().nonnegative(),
      end: z.number().int().positive(),
      text: z.string(),
    })),
    annotationStatus: z.enum(["pending", "processing", "completed", "failed"]),
    indexStatus: z.enum(["pending", "processing", "completed", "failed"]),
  })),
};

function toolResult(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

function toolError(message) {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

function defaultDependencies() {
  const dependencies = {
    deleteMemory,
    deleteMemoryVector,
    decideMemoryWrite: async (...args) => {
      const module = await import("./llm.js");
      return module.decideMemoryWrite(...args);
    },
    extractAtomicMemories: async (...args) => {
      const module = await import("./llm.js");
      return module.extractAtomicMemories(...args);
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
    indexMemoryVector,
    searchMemoryVectors,
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
    getModel: async () => {
      const module = await import("./llm-config.js");
      return module.model;
    },
  };

  dependencies.getRelatedMemories = (id, options) =>
    deriveRelatedMemories(
      id,
      {
        getMemory: dependencies.getMemory,
        getStructuralMemoryLinks: dependencies.getStructuralMemoryLinks,
        searchMemoryVectors: dependencies.searchMemoryVectors,
        searchMemoriesFts,
        serializeMemory: (memory) => ({
          ...memory,
          extraction: dependencies.getLatestExtraction(memory.id),
          entities: dependencies.getEntitiesForMemory(memory.id),
          relationships: dependencies.getRelationshipsForMemory(memory.id),
          regions: dependencies.getRegionActivations(memory.id),
        }),
      },
      options,
    );

  return dependencies;
}

export function createAtlasMcpServer(overrides = {}) {
  const dependencies = { ...defaultDependencies(), ...overrides };
  const server = new McpServer({
    name: "Atlas",
    version: "0.1.0",
  });

  const getMemoryDetails = (id) => {
    const memory = dependencies.getMemory(id);
    if (!memory) return null;

    return {
      ...memory,
      extraction: dependencies.getLatestExtraction(id),
      entities: dependencies.getEntitiesForMemory(id),
      relationships: dependencies.getRelationshipsForMemory(id),
      regions: dependencies.getRegionActivations(id),
    };
  };
  dependencies.serializeMemory = (memory) => getMemoryDetails(memory?.id);
  dependencies.ingestionService ||= createIngestionService(dependencies);

  server.registerTool(
    "add_memory",
    {
      title: "Add memory",
      description:
        "Save durable source text to Atlas. The source is preserved exactly, split into evidence-backed atomic memories, and each atom is created, updated, or left unchanged. Type and title are optional source-level hints. Returns one consistent source-level result. Do not use for ephemeral chat, secrets, or transient state.",
      inputSchema: AddMemorySchema.shape,
      outputSchema: memoryWriteResultSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ text, type, title, confidence, tags }) => {
      try {
        const metadata = Object.fromEntries(Object.entries({
          type, title, confidence, tags,
        }).filter(([, value]) => value !== undefined));
        return toolResult(await dependencies.ingestionService.ingest({
          text,
          source: "mcp",
          metadata,
        }));
      } catch (error) {
        return toolError(`Could not add memory: ${error.message}`);
      }
    }
  );

  server.registerTool(
    "list_memories",
    {
      title: "List memories",
      description:
        "Browse Atlas's most recently stored memories in insertion order (newest first). Use this for a quick scan of what is already known, to enumerate memories by page, or when `search_memories` returns nothing and the user wants to see what exists. Supports `limit` (1-100, default 20) and `offset` (>=0, default 0) for pagination. Prefer `search_memories` when you need semantically relevant results for a question, and `find_entities` / `get_entity_memories` when you want everything about a specific person, place, or concept.",
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(20)
          .describe("Page size, 1-100. Defaults to 20."),
        offset: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe("Number of memories to skip for pagination. Defaults to 0."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ limit, offset }) =>
      toolResult({ memories: dependencies.getMemories({ limit, offset }) })
  );

  server.registerTool(
    "get_memory",
    {
      title: "Get memory",
      description:
        "Fetch ONE Atlas memory by its ID and return its full record: raw text, summary, type, title, confidence, tags, timestamps, the LLM extraction (entities, relationships, emotions, topics, brain-region activations), and any linked entities/relationships. Use this when you already have a memory ID from `add_memory`, `search_memories`, `list_memories`, or `get_related_memories` and need the complete payload. Returns an error if the ID does not exist. Do NOT use this to discover memories - call `search_memories` or `list_memories` first.",
      inputSchema: {
        id: z
          .string()
          .min(1)
          .describe(
            "Atlas memory ID returned by add_memory, search_memories, list_memories, or get_related_memories, for example mem_12ab34cd"
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      const memory = getMemoryDetails(id);
      return memory
        ? toolResult(memory)
        : toolError(`Memory not found: ${id}`);
    }
  );

  server.registerTool(
    "search_memories",
    {
      title: "Search memories",
      description:
        "Find memories using hybrid search (semantic + keyword). THIS IS THE PRIMARY WAY TO RECALL MEMORIES. Call this BEFORE asking the user to repeat information, and before `add_memory`, to avoid creating duplicates. Use a short descriptive query such as 'user's coffee preference' or 'project decisions last week'. Returns memories with a `rrfScore` (reciprocal rank fusion score). Supports `limit` (1-100, default 20), `scoreThreshold` in -1..1, and `strategy` ('hybrid', 'vector', or 'bm25', default 'hybrid'). Use `find_entities` instead when you need a known person/place/concept, and `list_memories` for a chronological browse.",
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe(
            "Natural-language search query describing what you are looking for, e.g. 'user's dietary restrictions' or 'Decisions about the Q4 launch'"
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(20)
          .describe("Max memories to return, 1-100. Defaults to 20."),
        scoreThreshold: z
          .number()
          .min(-1)
          .max(1)
          .optional()
          .describe(
            "Optional minimum similarity score in -1..1; lower returns more permissive results"
          ),
        strategy: z
          .enum(["hybrid", "vector", "bm25"])
          .default("hybrid")
          .describe(
            "Search strategy: 'hybrid' (default) combines semantic + BM25, 'vector' is semantic-only, 'bm25' is keyword-only"
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query, limit, scoreThreshold, strategy }) => {
      try {
        const hits = await hybridSearchMemories(query, {
          limit,
          scoreThreshold,
          strategy,
          searchMemoriesFts,
        });
        const memories = hits.flatMap(({ id, score }) => {
          const memory = getMemoryDetails(id);
          return memory ? [{ ...memory, rrfScore: score }] : [];
        });
        return toolResult({ query, strategy, memories });
      } catch (error) {
        return toolError(`Could not search memories: ${error.message}`);
      }
    }
  );

  server.registerTool(
    "get_related_memories",
    {
      title: "Get related memories",
      description:
        "Find memories connected to a given memory through FOUR signals combined: shared entities, shared subject-predicate-object relationships, semantic similarity, and BM25 keyword relevance. Use this AFTER obtaining a memory ID from `search_memories` or `add_memory` to expand context, surface contradictions, or follow a thread (e.g. 'what else do we know about Maya?'). Returns a ranked list of related memories with combined score, human-readable reasons, shared entities, shared relationships, and `semanticAvailable`/`bm25Available` flags. Supports `limit` (1-20, default 5) and `scoreThreshold` in -1..1 (default 0.65). Returns an error if `id` does not exist. This is NOT a general search - start with `search_memories` when you have a free-text question.",
      inputSchema: {
        id: z
          .string()
          .min(1)
          .describe(
            "Source memory ID (e.g. mem_12ab34cd) to find related memories for"
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(20)
          .default(5)
          .describe("Max related memories to return, 1-20. Defaults to 5."),
        scoreThreshold: z
          .number()
          .min(-1)
          .max(1)
          .default(0.65)
          .describe(
            "Minimum similarity score in -1..1 for the semantic-similarity signal. Defaults to 0.65."
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ id, limit, scoreThreshold }) => {
      try {
        const result = await dependencies.getRelatedMemories(id, {
          limit,
          scoreThreshold,
        });
        return result
          ? toolResult(result)
          : toolError(`Memory not found: ${id}`);
      } catch (error) {
        return toolError(`Could not get related memories: ${error.message}`);
      }
    }
  );

  server.registerTool(
    "find_entities",
    {
      title: "Find entities",
      description:
        "Look up canonical entities (people, places, objects, concepts, or organizations) that Atlas has extracted from memories. Use this when the user mentions a person, place, or topic by name and you want to confirm Atlas knows about them and retrieve their numeric `entityId`. Provide a partial name and review the matches. After finding the entity, call `get_entity_memories` with the returned `entityId` to list every memory linked to it. This is a name lookup against the entity graph - use `search_memories` for free-text semantic recall.",
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe(
            "Partial or full name to search for, e.g. 'Maya', 'Acme', 'Paris'"
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query }) =>
      toolResult({ entities: dependencies.findEntities(query) })
  );

  server.registerTool(
    "get_entity_memories",
    {
      title: "Get entity memories",
      description:
        "List every memory linked to a specific Atlas entity (person, place, object, concept, or organization). Use this AFTER `find_entities` returns an `entityId` to retrieve the full history of memories about that entity. Useful for 'tell me everything we know about X' or 'what has the user said about Y'. Do NOT pass a free-text name - resolve it through `find_entities` first to obtain the numeric `entityId`.",
      inputSchema: {
        entityId: z
          .number()
          .int()
          .positive()
          .describe(
            "Numeric entity ID returned by find_entities, e.g. 42"
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ entityId }) =>
      toolResult({
        entityId,
        memories: dependencies.getMemoriesForEntity(entityId),
      })
  );

  server.registerTool(
    "update_memory_summary",
    {
      title: "Update memory summary",
      description:
        "Replace the editable summary of an existing memory WITHOUT changing the original raw text, type, or extraction graph. Use this when the auto-generated summary is wrong, stale, or unclear and you want to fix only the human-readable summary. The memory's vector embedding is reindexed after the update, so semantic search will reflect the new summary. Prefer `add_memory` (which can return `action: \"updated\"`) when the underlying memory text itself has changed - it preserves the original ID and revision history. Returns the refreshed memory.",
      inputSchema: {
        id: z
          .string()
          .min(1)
          .describe(
            "Atlas memory ID to update, for example mem_12ab34cd"
          ),
        summary: z
          .string()
          .describe(
            "Replacement summary text that replaces the current summary"
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ id, summary }) => {
      if (!dependencies.getMemory(id)) {
        return toolError(`Memory not found: ${id}`);
      }
      dependencies.updateMemorySummary(id, summary);
      try {
        await dependencies.indexMemoryVector(dependencies.getMemory(id));
      } catch (error) {
        console.error(`Could not reindex memory ${id}: ${error.message}`);
      }
      return toolResult(dependencies.getMemory(id));
    }
  );

  server.registerTool(
    "delete_memory",
    {
      title: "Delete memory",
      description:
        "PERMANENTLY delete one Atlas memory, its extraction data, and its vector index entry. This is destructive and cannot be undone. Use this ONLY when the user explicitly asks to forget, remove, or delete a specific memory, or when correcting a test/dev record. Confirm with the user first when in doubt. Returns an error if the ID does not exist. To revise the underlying text or facts, prefer `add_memory` (which may return `action: \"updated\"`) so the original memory ID and revision history are preserved.",
      inputSchema: {
        id: z
          .string()
          .min(1)
          .describe(
            "Atlas memory ID to permanently delete, for example mem_12ab34cd"
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ id }) => {
      if (!dependencies.getMemory(id)) {
        return toolError(`Memory not found: ${id}`);
      }
      dependencies.deleteMemory(id);
      try {
        await dependencies.deleteMemoryVector(id);
      } catch (error) {
        console.error(`Could not delete vector for ${id}: ${error.message}`);
      }
      return toolResult({ ok: true, deletedMemoryId: id });
    }
  );

  return server;
}

export async function runAtlasMcpServer() {
  assertAtlasModeSupported();
  const server = createAtlasMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Atlas MCP server running on stdio");
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  runAtlasMcpServer().catch((error) => {
    console.error("Atlas MCP server failed:", error);
    process.exit(1);
  });
}
