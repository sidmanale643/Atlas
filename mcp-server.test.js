import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createNeurogramMcpServer } from "./mcp-server.js";

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
    getRegionActivations: () => [{ region: "hippocampus", weight: 1 }],
    searchMemoryVectors: async () => [{ id: memory.id, score: 0.87 }],
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
  };
}

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
      "find_entities",
      "get_entity_memories",
      "update_memory_summary",
      "delete_memory",
    ]
  );
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
