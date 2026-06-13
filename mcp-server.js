#!/usr/bin/env node

import "dotenv/config";
import { randomUUID } from "node:crypto";
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
  storeMemory,
  updateMemorySummary,
} from "./db.js";
import {
  deleteMemoryVector,
  indexMemoryVector,
  searchMemoryVectors,
} from "./vector-store.js";

process.env.LOG_STREAM = "stderr";

const memoryIdSchema = z
  .string()
  .min(1)
  .describe("Neurogram memory ID, for example mem_12ab34cd");

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
  return {
    deleteMemory,
    deleteMemoryVector,
    extractMemory: async (...args) => {
      const module = await import("./llm.js");
      return module.extractMemory(...args);
    },
    findEntities,
    getEntitiesForMemory,
    getLatestExtraction,
    getMemories,
    getMemoriesForEntity,
    getMemory,
    getRegionActivations,
    getRelationshipsForMemory,
    indexMemoryVector,
    searchMemoryVectors,
    storeMemory,
    updateMemorySummary,
    getModel: async () => {
      const module = await import("./llm-config.js");
      return module.model;
    },
  };
}

export function createNeurogramMcpServer(overrides = {}) {
  const dependencies = { ...defaultDependencies(), ...overrides };
  const server = new McpServer({
    name: "Neurogram",
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

  server.registerTool(
    "add_memory",
    {
      title: "Add memory",
      description:
        "Extract and store a short personal memory in Neurogram. Requires the project's configured LLM API key.",
      inputSchema: {
        text: z
          .string()
          .min(1)
          .max(180)
          .describe("The memory text to extract and store"),
        ingestionDate: z
          .string()
          .datetime()
          .optional()
          .describe("Optional ISO-8601 date used to resolve relative dates"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ text, ingestionDate }) => {
      const id = `mem_${randomUUID().slice(0, 8)}`;
      const date = ingestionDate || new Date().toISOString();

      try {
        const extraction = await dependencies.extractMemory(text, date);
        const extractionModel = await dependencies.getModel();
        const memory = dependencies.storeMemory(
          id,
          text,
          date,
          extraction,
          extractionModel,
          "mcp"
        );
        try {
          await dependencies.indexMemoryVector(memory);
        } catch (error) {
          console.error(`Could not index memory ${id}: ${error.message}`);
        }
        return toolResult(getMemoryDetails(id));
      } catch (error) {
        return toolError(`Could not add memory: ${error.message}`);
      }
    }
  );

  server.registerTool(
    "list_memories",
    {
      title: "List memories",
      description: "List recently stored Neurogram memories.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
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
        "Get one Neurogram memory with its extraction, entities, relationships, and brain-region activations.",
      inputSchema: { id: memoryIdSchema },
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
        "Semantically search Neurogram memories using Sentence Transformers embeddings stored in Qdrant.",
      inputSchema: {
        query: z.string().min(1).describe("Natural-language semantic query"),
        limit: z.number().int().min(1).max(100).default(20),
        scoreThreshold: z.number().min(-1).max(1).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query, limit, scoreThreshold }) => {
      try {
        const hits = await dependencies.searchMemoryVectors(query, {
          limit,
          scoreThreshold,
        });
        const memories = hits.flatMap(({ id, score }) => {
          const memory = getMemoryDetails(id);
          return memory ? [{ ...memory, similarity: score }] : [];
        });
        return toolResult({ query, memories });
      } catch (error) {
        return toolError(`Could not search memories: ${error.message}`);
      }
    }
  );

  server.registerTool(
    "find_entities",
    {
      title: "Find entities",
      description:
        "Find people, places, objects, concepts, or organizations extracted from memories.",
      inputSchema: {
        query: z.string().min(1).describe("Partial canonical entity name"),
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
      description: "List every memory linked to a Neurogram entity.",
      inputSchema: {
        entityId: z.number().int().positive().describe("Numeric entity ID"),
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
        "Replace the editable summary of a memory. The original memory text remains unchanged.",
      inputSchema: {
        id: memoryIdSchema,
        summary: z.string().describe("Replacement summary"),
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
        "Permanently delete one Neurogram memory and its linked extraction data.",
      inputSchema: { id: memoryIdSchema },
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

export async function runNeurogramMcpServer() {
  const server = createNeurogramMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Neurogram MCP server running on stdio");
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  runNeurogramMcpServer().catch((error) => {
    console.error("Neurogram MCP server failed:", error);
    process.exit(1);
  });
}
