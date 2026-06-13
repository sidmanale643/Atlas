import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const testDir = mkdtempSync(join(tmpdir(), "neurogram-server-"));
process.env.ENGRAM_DB_PATH = join(testDir, "test.db");

const { createNeurogramApp } = await import("./server.js");
const {
  closeDb,
  findEntities,
  storeMemory,
  upsertEntity,
} = await import("./db.js");

let server;
let baseUrl;
let mayaId;
let unusedEntityId;

function extraction(overrides = {}) {
  return {
    occurredAt: { text: "", normalized: null, confidence: 0 },
    types: [{ type: "episodic", weight: 0.8 }],
    emotions: [],
    entities: [],
    relationships: [],
    actions: [],
    topics: [],
    salience: 0.5,
    summary: "A test memory",
    ...overrides,
  };
}

test.before(async () => {
  storeMemory(
    "mem_graph_one",
    "Maya visited the museum.",
    "2026-06-12T00:00:00.000Z",
    extraction({
      entities: [
        {
          mention: "Maya",
          canonicalName: "Maya Patel",
          kind: "person",
          confidence: 0.99,
        },
        {
          mention: "the museum",
          canonicalName: "City Museum",
          kind: "place",
          confidence: 0.96,
        },
      ],
      relationships: [
        {
          subject: "maya",
          predicate: "visited",
          object: "CITY MUSEUM",
          confidence: 0.94,
          evidence: "Maya visited the museum",
        },
      ],
      summary: "Maya visited the museum.",
    }),
    "test-model",
    "ui",
  );
  storeMemory(
    "mem_graph_two",
    "I called Maya later.",
    "2026-06-12T01:00:00.000Z",
    extraction({
      entities: [
        {
          mention: "Maya",
          canonicalName: "Maya Patel",
          kind: "person",
          confidence: 0.98,
        },
      ],
      summary: "Called Maya later.",
    }),
    "test-model",
    "mcp",
  );

  mayaId = findEntities("Maya Patel")[0].id;
  unusedEntityId = upsertEntity("Unused concept", "concept");

  const app = createNeurogramApp({
    deleteAllMemoryVectors: async () => {},
    deleteMemoryVector: async () => {},
    indexMemoryVector: async () => {},
    searchMemoryVectors: async () => [
      { id: "mem_graph_two", score: 0.88 },
      { id: "mem_graph_one", score: 0.73 },
    ],
  });
  await new Promise((resolveListen) => {
    server = app.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  await new Promise((resolveClose, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolveClose();
    });
  });
  closeDb();
  rmSync(testDir, { recursive: true, force: true });
});

test("memory list includes persisted canonical entities", async () => {
  const response = await fetch(`${baseUrl}/api/memories`);
  assert.equal(response.status, 200);

  const memories = await response.json();
  const memory = memories.find((item) => item.id === "mem_graph_one");
  assert.deepEqual(
    memory.entities.map((entity) => entity.canonical_name).sort(),
    ["City Museum", "Maya Patel"],
  );
});

test("semantic search returns serialized memories in vector similarity order", async () => {
  const response = await fetch(
    `${baseUrl}/api/memories/search?q=spending+time+with+Maya&limit=2`,
  );
  assert.equal(response.status, 200);

  const result = await response.json();
  assert.equal(result.query, "spending time with Maya");
  assert.deepEqual(
    result.memories.map(({ id, similarity }) => ({ id, similarity })),
    [
      { id: "mem_graph_two", similarity: 0.88 },
      { id: "mem_graph_one", similarity: 0.73 },
    ],
  );
  assert.ok(result.memories.every((memory) => memory.extraction));
});

test("entity graph returns complete memories and structured relationships", async () => {
  const response = await fetch(`${baseUrl}/api/entities/${mayaId}/graph`);
  assert.equal(response.status, 200);

  const graph = await response.json();
  assert.equal(graph.entity.canonical_name, "Maya Patel");
  assert.deepEqual(
    graph.memories.map((memory) => memory.id).sort(),
    ["mem_graph_one", "mem_graph_two"],
  );
  assert.ok(graph.memories.every((memory) => memory.extraction));
  assert.ok(graph.memories.every((memory) => memory.regions.length > 0));
  assert.ok(graph.memories.every((memory) => memory.entities.length > 0));
  assert.equal(graph.relationships.length, 1);
  assert.deepEqual(graph.relationships[0].source, {
    id: mayaId,
    canonical_name: "Maya Patel",
    kind: "person",
  });
  assert.equal(graph.relationships[0].target.canonical_name, "City Museum");
  assert.equal(graph.relationships[0].memory_id, "mem_graph_one");
});

test("entity graph returns empty arrays for a known disconnected entity", async () => {
  const response = await fetch(
    `${baseUrl}/api/entities/${unusedEntityId}/graph`,
  );
  assert.equal(response.status, 200);
  const graph = await response.json();
  assert.equal(graph.entity.id, unusedEntityId);
  assert.equal(graph.entity.canonical_name, "Unused concept");
  assert.equal(graph.entity.kind, "concept");
  assert.deepEqual(graph.memories, []);
  assert.deepEqual(graph.relationships, []);
});

test("entity graph returns 404 for an unknown entity", async () => {
  const response = await fetch(`${baseUrl}/api/entities/999999/graph`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Entity not found" });
});
