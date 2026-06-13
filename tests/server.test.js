import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const testDir = mkdtempSync(join(tmpdir(), "neurogram-server-"));
process.env.ENGRAM_DB_PATH = join(testDir, "test.db");

const { createNeurogramApp } = await import("../src/server.js");
const {
  closeDb,
  findEntities,
  storeMemory,
  upsertEntity,
} = await import("../src/db.js");

let server;
let baseUrl;
let mayaId;
let unusedEntityId;
let comparisonCalls = 0;
let comparisonShouldFail = false;

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
    compareMemories: async () => {
      comparisonCalls += 1;
      if (comparisonShouldFail) throw new Error("Provider unavailable");
      return {
        relationship: "overlapping",
        confidence: 0.9,
        overview: "Both memories involve Maya.",
        sharedFacts: [{
          statement: "Maya appears in both memories.",
          leftEvidence: "Maya",
          rightEvidence: "Maya",
          confidence: 1,
        }],
        differences: [],
        contradictions: [],
        caveats: [],
      };
    },
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
  const hippocampus = memory.regions.find(
    ({ region }) => region === "hippocampus",
  );
  assert.deepEqual(Object.keys(hippocampus.hemispheres).sort(), ["left", "right"]);
});

test("memory catalog returns a stable paginated shape with filters and entities", async () => {
  const response = await fetch(
    `${baseUrl}/api/catalog/memories?source=mcp&sort=title&order=asc&limit=1&offset=0`,
  );
  assert.equal(response.status, 200);
  const result = await response.json();

  assert.deepEqual(
    {
      total: result.total,
      limit: result.limit,
      offset: result.offset,
      ids: result.items.map((item) => item.id),
    },
    { total: 1, limit: 1, offset: 0, ids: ["mem_graph_two"] },
  );
  assert.equal(result.items[0].entities[0].canonical_name, "Maya Patel");
});

test("entity catalog includes linked memory and relationship counts", async () => {
  const response = await fetch(
    `${baseUrl}/api/catalog/entities?q=Maya&kind=person&sort=memory_count&order=desc`,
  );
  assert.equal(response.status, 200);
  const result = await response.json();

  assert.equal(result.total, 1);
  assert.equal(result.limit, 25);
  assert.equal(result.offset, 0);
  assert.equal(result.items[0].id, mayaId);
  assert.equal(result.items[0].memory_count, 2);
  assert.equal(result.items[0].relationship_count, 1);
});

test("catalog endpoints reject invalid pagination, sorting, and filters", async () => {
  const urls = [
    "/api/catalog/memories?limit=0",
    "/api/catalog/memories?offset=-1",
    "/api/catalog/memories?sort=raw_text",
    "/api/catalog/memories?source=unknown",
    "/api/catalog/entities?kind=unknown",
    "/api/catalog/entities?order=sideways",
  ];

  for (const path of urls) {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.status, 400, path);
    assert.equal(typeof (await response.json()).error, "string");
  }
});

test("catalog page is served for memory and entity routes", async () => {
  for (const path of ["/memories", "/entities"]) {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/html/);
    assert.match(await response.text(), /class="catalog-sidebar"/);
  }
});

test("comparison page is served at a shareable route", async () => {
  const response = await fetch(`${baseUrl}/memories/compare?left=a&right=b`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /id="comparisonContent"/);
});

test("memory comparison generates, caches, and regenerates analysis", async () => {
  const body = {
    leftMemoryId: "mem_graph_one",
    rightMemoryId: "mem_graph_two",
  };
  const first = await fetch(`${baseUrl}/api/memory-comparisons`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal(first.status, 200);
  const firstResult = await first.json();
  assert.equal(firstResult.generation.cached, false);
  assert.equal(firstResult.generation.saved, true);
  assert.equal(firstResult.analysis.relationship, "overlapping");
  assert.equal(firstResult.structuralDiff.entities.shared[0].name, "Maya Patel");
  assert.equal(comparisonCalls, 1);

  const cached = await fetch(`${baseUrl}/api/memory-comparisons`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal(cached.status, 200);
  assert.equal((await cached.json()).generation.cached, true);
  assert.equal(comparisonCalls, 1);

  const regenerated = await fetch(`${baseUrl}/api/memory-comparisons`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, regenerate: true }),
  });
  assert.equal(regenerated.status, 200);
  assert.equal((await regenerated.json()).generation.cached, false);
  assert.equal(comparisonCalls, 2);
});

test("comparison endpoint validates IDs and returns deterministic fallback", async () => {
  const identical = await fetch(`${baseUrl}/api/memory-comparisons`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      leftMemoryId: "mem_graph_one",
      rightMemoryId: "mem_graph_one",
    }),
  });
  assert.equal(identical.status, 400);

  const missing = await fetch(`${baseUrl}/api/memory-comparisons`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      leftMemoryId: "missing",
      rightMemoryId: "mem_graph_one",
    }),
  });
  assert.equal(missing.status, 404);
  assert.deepEqual((await missing.json()).missing, ["missing"]);

  comparisonShouldFail = true;
  const failed = await fetch(`${baseUrl}/api/memory-comparisons`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      leftMemoryId: "mem_graph_two",
      rightMemoryId: "mem_graph_one",
      regenerate: true,
    }),
  });
  comparisonShouldFail = false;
  assert.equal(failed.status, 502);
  const result = await failed.json();
  assert.equal(result.analysis, null);
  assert.equal(result.generation.saved, false);
  assert.equal(result.left.id, "mem_graph_two");
  assert.ok(result.structuralDiff.regions.length > 0);
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

test("related-memory links combine structural and semantic signals", async () => {
  const response = await fetch(
    `${baseUrl}/api/memories/mem_graph_one/links?limit=5&scoreThreshold=0.65`,
  );
  assert.equal(response.status, 200);

  const result = await response.json();
  assert.equal(result.memoryId, "mem_graph_one");
  assert.equal(result.semanticAvailable, true);
  assert.equal(result.links[0].memory.id, "mem_graph_two");
  assert.ok(result.links[0].score > 0.88);
  assert.ok(
    result.links[0].reasons.some((reason) => reason.includes("Maya Patel")),
  );
  assert.equal(result.links[0].semanticSimilarity, 0.88);
});

test("related-memory links validate query parameters and origin IDs", async () => {
  for (const path of [
    "/api/memories/mem_graph_one/links?limit=0",
    "/api/memories/mem_graph_one/links?limit=21",
    "/api/memories/mem_graph_one/links?scoreThreshold=invalid",
    "/api/memories/mem_graph_one/links?scoreThreshold=2",
  ]) {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.status, 400, path);
  }

  const missing = await fetch(
    `${baseUrl}/api/memories/missing/links`,
  );
  assert.equal(missing.status, 404);
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
  assert.ok(Array.isArray(graph.aliases));
  assert.ok(Array.isArray(graph.suggestions));
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

test("entity-resolution endpoints validate status and decisions", async () => {
  const pending = await fetch(
    `${baseUrl}/api/entity-resolution/suggestions?status=pending`,
  );
  assert.equal(pending.status, 200);
  assert.ok(Array.isArray((await pending.json()).suggestions));

  const invalidStatus = await fetch(
    `${baseUrl}/api/entity-resolution/suggestions?status=unknown`,
  );
  assert.equal(invalidStatus.status, 400);

  const invalidDecision = await fetch(
    `${baseUrl}/api/entity-resolution/suggestions/1`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "maybe" }),
    },
  );
  assert.equal(invalidDecision.status, 400);
});
