import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createNeurogramMcpServer } from "../src/mcp-server.js";

function fixtureDependencies() {
  const memory = {
    id: "mem_test",
    raw_text: "Met Maya at the museum.",
    ingestion_date: "2026-06-12T00:00:00.000Z",
    summary: "Met Maya at a museum.",
  };

  return {
    getMemories: ({ limit, offset }) =>
      offset === 0 && limit > 0 ? [memory] : [],
    getMemory: (id) => (id === memory.id ? { ...memory } : undefined),
    getLatestExtraction: () => ({ extraction_json: { topics: ["museum"] } }),
    getEntitiesForMemory: () => [{ id: 1, canonical_name: "Maya" }],
    getRelationshipsForMemory: () => [],
    getRegionActivations: () => [{
      region: "hippocampus",
      weight: 1,
      hemispheres: { left: 0.5, right: 0.5 },
    }],
    getRelatedMemories: async (id, { limit, scoreThreshold }) =>
      id === memory.id
        ? {
            memoryId: id,
            links: [{
              memory: { ...memory },
              score: 0.91,
              reasons: ["Shared person: Maya"],
              sharedEntities: [
                { id: 1, canonical_name: "Maya", kind: "person" },
              ],
              sharedRelationships: [],
              semanticSimilarity: 0.8,
            }].slice(0, limit),
            semanticAvailable: scoreThreshold <= 0.8,
          }
        : null,
    searchMemoryVectors: async () => [{ id: memory.id, score: 0.87 }],
    decideMemoryWrite: async () => ({
      action: "unchanged",
      matchedMemoryId: memory.id,
      confidence: 1,
      reason: "Equivalent memory.",
      replacementText: memory.raw_text,
    }),
    findEntities: () => [{ id: 1, canonical_name: "Maya", kind: "person" }],
    getMemoriesForEntity: (id) => (id === 1 ? [memory] : []),
    updateMemorySummary: (_id, summary) => {
      memory.summary = summary;
    },
    deleteMemory: () => {},
    deleteMemoryVector: async () => {},
    indexMemoryVector: async () => {},
    extractMemory: async () => {
      throw new Error("not used");
    },
    getModel: async () => "test-model",
    storeMemory: () => {},
    updateMemoryGraph: () => {
      throw new Error("not used");
    },
  };
}

function extracted(summary) {
  return {
    summary,
    types: [],
    emotions: [],
    entities: [],
    relationships: [],
    actions: [],
    topics: [],
    contentCues: [],
  };
}

const addArguments = {
  text: "Use SQLite for the local prototype.",
  type: "decision",
  title: "Use SQLite for the local prototype.",
  tags: ["database", "prototype"],
};

async function connectClient(dependencies) {
  const server = createNeurogramMcpServer(dependencies);
  const client = new Client({ name: "neurogram-test", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return { client, server };
}

test("MCP advertises the Neurogram memory tools", async (t) => {
  const { client, server } = await connectClient(fixtureDependencies());
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const response = await client.listTools();
  assert.deepEqual(
    response.tools.map((tool) => tool.name),
    [
      "add_memory",
      "list_memories",
      "get_memory",
      "search_memories",
      "get_related_memories",
      "find_entities",
      "get_entity_memories",
      "update_memory_summary",
      "delete_memory",
    ]
  );
  const addMemory = response.tools.find((tool) => tool.name === "add_memory");
  assert.deepEqual(addMemory.inputSchema.required.sort(), [
    "text",
    "title",
    "type",
  ]);
  assert.deepEqual(addMemory.inputSchema.properties.type.enum, [
    "relationship",
    "preference",
    "fact",
    "decision",
    "learning",
    "event",
    "instruction",
    "observation",
    "error",
  ]);
  assert.equal(addMemory.inputSchema.properties.confidence.default, 0.6);
  assert.deepEqual(addMemory.inputSchema.properties.tags.default, []);
  assert.match(addMemory.description, /creates, updates, or leaves/i);
  assert.deepEqual(addMemory.outputSchema.properties.action.enum, [
    "created",
    "updated",
    "unchanged",
  ]);
  assert.deepEqual(addMemory.outputSchema.required.sort(), [
    "action",
    "confidence",
    "matchedMemoryId",
    "memory",
    "reason",
  ]);
  const relatedMemories = response.tools.find(
    (tool) => tool.name === "get_related_memories",
  );
  assert.equal(relatedMemories.inputSchema.properties.limit.default, 5);
  assert.equal(relatedMemories.inputSchema.properties.limit.maximum, 20);
  assert.equal(
    relatedMemories.inputSchema.properties.scoreThreshold.default,
    0.65,
  );
});

test("add_memory applies the indexed-memory schema", async (t) => {
  let storedMemory;
  let indexedMemory;
  const dependencies = {
    ...fixtureDependencies(),
    extractMemory: async () => extracted("Use SQLite locally."),
    searchMemoryVectors: async () => [],
    storeMemory: (
      id,
      text,
      ingestionDate,
      _extraction,
      _model,
      source,
      metadata,
    ) => {
      storedMemory = {
        id,
        raw_text: text,
        ingestion_date: ingestionDate,
        source,
        scope: "agent",
        created_at: ingestionDate,
        updated_at: ingestionDate,
        ...metadata,
      };
      return storedMemory;
    },
    getMemory: (id) => (id === storedMemory?.id ? storedMemory : undefined),
    indexMemoryVector: async (memory) => {
      indexedMemory = memory;
    },
  };
  const { client, server } = await connectClient(dependencies);
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const response = await client.callTool({
    name: "add_memory",
    arguments: addArguments,
  });

  assert.equal(response.isError, undefined);
  assert.equal(response.structuredContent.action, "created");
  assert.equal(response.structuredContent.matchedMemoryId, null);
  assert.equal(response.structuredContent.confidence, 1);
  assert.match(storedMemory.id, /^mem_[0-9a-f]{8}$/);
  assert.equal(storedMemory.type, "decision");
  assert.equal(storedMemory.confidence, 0.6);
  assert.deepEqual(storedMemory.tags, ["database", "prototype"]);
  assert.equal(storedMemory.scope, "agent");
  assert.equal(storedMemory.source, "mcp");
  assert.equal(indexedMemory, storedMemory);
});

test("add_memory creates conservatively when candidate search is unavailable", async (t) => {
  let stored = false;
  const memories = new Map();
  const dependencies = {
    ...fixtureDependencies(),
    extractMemory: async () => extracted("Use SQLite locally."),
    searchMemoryVectors: async () => {
      throw new Error("Qdrant unavailable");
    },
    storeMemory: (id, text, date, extraction, _model, source, metadata) => {
      stored = true;
      const memory = {
        id,
        raw_text: text,
        ingestion_date: date,
        summary: extraction.summary,
        source,
        ...metadata,
      };
      memories.set(id, memory);
      return memory;
    },
    getMemory: (id) => memories.get(id),
  };
  const { client, server } = await connectClient(dependencies);
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const response = await client.callTool({
    name: "add_memory",
    arguments: addArguments,
  });

  assert.equal(response.structuredContent.action, "created");
  assert.equal(response.structuredContent.confidence, 0);
  assert.match(response.structuredContent.reason, /search was unavailable/i);
  assert.equal(stored, true);
});

test("add_memory creates conservatively when the write decision fails", async (t) => {
  let storedMemory;
  const candidate = {
    id: "mem_test",
    raw_text: "Use Postgres for production.",
    summary: "Use Postgres in production.",
  };
  const dependencies = {
    ...fixtureDependencies(),
    getMemory: (id) => {
      if (id === candidate.id) return candidate;
      return id === storedMemory?.id ? storedMemory : undefined;
    },
    extractMemory: async () => extracted("Use SQLite locally."),
    decideMemoryWrite: async () => {
      throw new Error("invalid decision");
    },
    storeMemory: (id, text, date, extraction, _model, source, metadata) => {
      storedMemory = {
        id,
        raw_text: text,
        ingestion_date: date,
        summary: extraction.summary,
        source,
        ...metadata,
      };
      return storedMemory;
    },
  };
  const { client, server } = await connectClient(dependencies);
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const response = await client.callTool({
    name: "add_memory",
    arguments: addArguments,
  });

  assert.equal(response.structuredContent.action, "created");
  assert.match(response.structuredContent.reason, /inconclusive/i);
  assert.equal(storedMemory.raw_text, addArguments.text);
});

test("add_memory updates a high-confidence evolving memory", async (t) => {
  const memory = {
    id: "mem_preference",
    raw_text: "I prefer coffee.",
    ingestion_date: "2026-06-01T00:00:00.000Z",
    summary: "The speaker prefers coffee.",
    type: "preference",
    title: "Coffee preference",
    confidence: 0.9,
    tags: ["drinks"],
    source: "mcp",
    scope: "agent",
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z",
  };
  const extractedTexts = [];
  let updateInput;
  let indexedMemory;
  let searchOptions;
  const dependencies = {
    ...fixtureDependencies(),
    getMemory: (id) => id === memory.id ? { ...memory } : undefined,
    getLatestExtraction: () => ({
      extraction_json: extracted(memory.summary),
    }),
    getEntitiesForMemory: () => [],
    getRegionActivations: () => [],
    extractMemory: async (text) => {
      extractedTexts.push(text);
      return extracted(
        text === "I prefer tea."
          ? "The speaker prefers tea."
          : "The speaker now prefers tea.",
      );
    },
    searchMemoryVectors: async (_query, options) => {
      searchOptions = options;
      return [{ id: memory.id, score: 0.93 }];
    },
    decideMemoryWrite: async () => ({
      action: "update",
      matchedMemoryId: memory.id,
      confidence: 0.94,
      reason: "The same preference has a newer value.",
      replacementText: "I prefer tea.",
    }),
    updateMemoryGraph: (input) => {
      updateInput = input;
      Object.assign(memory, {
        raw_text: input.rawText,
        ingestion_date: input.ingestionDate,
        summary: input.extraction.summary,
        ...input.metadata,
      });
      return { memory: { ...memory }, revisionNumber: 1 };
    },
    storeMemory: () => {
      throw new Error("should not create");
    },
    indexMemoryVector: async (value) => {
      indexedMemory = value;
    },
  };
  const { client, server } = await connectClient(dependencies);
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const response = await client.callTool({
    name: "add_memory",
    arguments: {
      text: "I prefer tea now.",
      type: "preference",
      title: "Tea preference",
      confidence: 0.95,
      tags: ["tea"],
    },
  });

  assert.equal(response.structuredContent.action, "updated");
  assert.equal(response.structuredContent.matchedMemoryId, memory.id);
  assert.equal(response.structuredContent.confidence, 0.94);
  assert.deepEqual(searchOptions, { limit: 5 });
  assert.deepEqual(extractedTexts, ["I prefer tea now.", "I prefer tea."]);
  assert.equal(updateInput.memoryId, memory.id);
  assert.equal(updateInput.rawText, "I prefer tea.");
  assert.equal(updateInput.model, "test-model");
  assert.deepEqual(updateInput.metadata.tags, ["tea"]);
  assert.equal(indexedMemory.id, memory.id);
  assert.equal(indexedMemory.raw_text, "I prefer tea.");
});

test("add_memory leaves an equivalent memory unchanged without writing", async (t) => {
  let writes = 0;
  let indexes = 0;
  const dependencies = {
    ...fixtureDependencies(),
    extractMemory: async () => extracted("Met Maya at a museum."),
    decideMemoryWrite: async () => ({
      action: "unchanged",
      matchedMemoryId: "mem_test",
      confidence: 0.99,
      reason: "The memories are equivalent.",
      replacementText: "Met Maya at the museum.",
    }),
    storeMemory: () => {
      writes += 1;
    },
    updateMemoryGraph: () => {
      writes += 1;
    },
    indexMemoryVector: async () => {
      indexes += 1;
    },
  };
  const { client, server } = await connectClient(dependencies);
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const response = await client.callTool({
    name: "add_memory",
    arguments: {
      text: "I met Maya at the museum.",
      type: "event",
      title: "Met Maya at the museum",
    },
  });

  assert.equal(response.structuredContent.action, "unchanged");
  assert.equal(response.structuredContent.memory.id, "mem_test");
  assert.equal(writes, 0);
  assert.equal(indexes, 0);
});

test("add_memory creates when an update decision is below the safety threshold", async (t) => {
  let updated = false;
  let storedMemory;
  const candidate = {
    id: "mem_test",
    raw_text: "The launch is Monday.",
    summary: "The launch is Monday.",
  };
  const dependencies = {
    ...fixtureDependencies(),
    extractMemory: async () => extracted("The launch is Tuesday."),
    decideMemoryWrite: async () => ({
      action: "update",
      matchedMemoryId: "mem_test",
      confidence: 0.84,
      reason: "This may be the same fact.",
      replacementText: "The launch is Tuesday.",
    }),
    updateMemoryGraph: () => {
      updated = true;
    },
    storeMemory: (id, text, date, extraction, _model, source, metadata) => {
      storedMemory = {
        id,
        raw_text: text,
        ingestion_date: date,
        summary: extraction.summary,
        source,
        ...metadata,
      };
      return storedMemory;
    },
    getMemory: (id) => {
      if (id === candidate.id) return candidate;
      return id === storedMemory?.id ? storedMemory : undefined;
    },
  };
  const { client, server } = await connectClient(dependencies);
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const response = await client.callTool({
    name: "add_memory",
    arguments: {
      text: "The launch is Tuesday.",
      type: "fact",
      title: "Launch date",
    },
  });

  assert.equal(response.structuredContent.action, "created");
  assert.match(response.structuredContent.reason, /uncertain/i);
  assert.equal(updated, false);
});

test("add_memory creates a distinct event even when candidates are similar", async (t) => {
  let storedMemory;
  const candidate = {
    id: "mem_test",
    raw_text: "Met Maya at the museum.",
    summary: "Met Maya at a museum.",
  };
  const dependencies = {
    ...fixtureDependencies(),
    extractMemory: async () => extracted("Met Maya at a gallery."),
    decideMemoryWrite: async () => ({
      action: "create",
      matchedMemoryId: null,
      confidence: 0.96,
      reason: "This is a separate event.",
      replacementText: "Met Maya at a gallery today.",
    }),
    storeMemory: (id, text, date, extraction, _model, source, metadata) => {
      storedMemory = {
        id,
        raw_text: text,
        ingestion_date: date,
        summary: extraction.summary,
        source,
        ...metadata,
      };
      return storedMemory;
    },
    getMemory: (id) => {
      if (id === candidate.id) return candidate;
      return id === storedMemory?.id ? storedMemory : undefined;
    },
  };
  const { client, server } = await connectClient(dependencies);
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const response = await client.callTool({
    name: "add_memory",
    arguments: {
      text: "I met Maya at a gallery today.",
      type: "event",
      title: "Met Maya at a gallery",
    },
  });

  assert.equal(response.structuredContent.action, "created");
  assert.equal(response.structuredContent.confidence, 0.96);
  assert.equal(storedMemory.raw_text, "I met Maya at a gallery today.");
});

test("get_memory returns the complete memory graph", async (t) => {
  const { client, server } = await connectClient(fixtureDependencies());
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const response = await client.callTool({
    name: "get_memory",
    arguments: { id: "mem_test" },
  });

  assert.equal(response.isError, undefined);
  assert.equal(response.structuredContent.id, "mem_test");
  assert.equal(response.structuredContent.entities[0].canonical_name, "Maya");
  assert.equal(response.structuredContent.regions[0].region, "hippocampus");
  assert.deepEqual(
    response.structuredContent.regions[0].hemispheres,
    { left: 0.5, right: 0.5 },
  );
});

test("missing memories return an MCP tool error", async (t) => {
  const { client, server } = await connectClient(fixtureDependencies());
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const response = await client.callTool({
    name: "get_memory",
    arguments: { id: "mem_missing" },
  });

  assert.equal(response.isError, true);
  assert.match(response.content[0].text, /Memory not found/);
});

test("search_memories returns semantic similarity scores", async (t) => {
  const { client, server } = await connectClient(fixtureDependencies());
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const response = await client.callTool({
    name: "search_memories",
    arguments: { query: "an outing with a friend", limit: 5 },
  });

  assert.equal(response.isError, undefined);
  assert.equal(response.structuredContent.memories[0].id, "mem_test");
  assert.equal(response.structuredContent.memories[0].similarity, 0.87);
});

test("get_related_memories returns the service response unchanged", async (t) => {
  let call;
  const expected = {
    memoryId: "mem_test",
    links: [{
      memory: { id: "mem_related", summary: "Visited with Maya." },
      score: 0.91,
      reasons: ["Shared person: Maya"],
      sharedEntities: [
        { id: 1, canonical_name: "Maya", kind: "person" },
      ],
      sharedRelationships: [],
      semanticSimilarity: 0.8,
    }],
    semanticAvailable: true,
  };
  const { client, server } = await connectClient({
    ...fixtureDependencies(),
    getRelatedMemories: async (id, options) => {
      call = { id, options };
      return expected;
    },
  });
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const response = await client.callTool({
    name: "get_related_memories",
    arguments: {
      id: "mem_test",
      limit: 3,
      scoreThreshold: 0.7,
    },
  });

  assert.equal(response.isError, undefined);
  assert.deepEqual(call, {
    id: "mem_test",
    options: { limit: 3, scoreThreshold: 0.7 },
  });
  assert.deepEqual(response.structuredContent, expected);
});

test("get_related_memories applies defaults and reports missing memories", async (t) => {
  let options;
  const { client, server } = await connectClient({
    ...fixtureDependencies(),
    getRelatedMemories: async (_id, receivedOptions) => {
      options = receivedOptions;
      return null;
    },
  });
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const response = await client.callTool({
    name: "get_related_memories",
    arguments: { id: "mem_missing" },
  });

  assert.deepEqual(options, { limit: 5, scoreThreshold: 0.65 });
  assert.equal(response.isError, true);
  assert.match(response.content[0].text, /Memory not found: mem_missing/);
});

test("get_related_memories reports service failures", async (t) => {
  const { client, server } = await connectClient({
    ...fixtureDependencies(),
    getRelatedMemories: async () => {
      throw new Error("link service unavailable");
    },
  });
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const response = await client.callTool({
    name: "get_related_memories",
    arguments: { id: "mem_test" },
  });

  assert.equal(response.isError, true);
  assert.match(
    response.content[0].text,
    /Could not get related memories: link service unavailable/,
  );
});
