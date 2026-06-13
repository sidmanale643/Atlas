import assert from "node:assert/strict";
import test from "node:test";
import {
  createMemoryVectorStore,
  getQdrantCloudConfig,
  memoryEmbeddingText,
  memoryPointId,
} from "./vector-store.js";

function fakeClient({ exists = false } = {}) {
  const calls = [];
  let collectionExists = exists;

  return {
    calls,
    async collectionExists(name) {
      calls.push(["collectionExists", name]);
      return { exists: collectionExists };
    },
    async createCollection(name, config) {
      calls.push(["createCollection", name, config]);
      collectionExists = true;
    },
    async getCollection(name) {
      calls.push(["getCollection", name]);
      return { config: { params: { vectors: { size: 3 } } } };
    },
    async upsert(name, request) {
      calls.push(["upsert", name, request]);
    },
    async query(name, request) {
      calls.push(["query", name, request]);
      return {
        points: [
          { id: "point-1", score: 0.91, payload: { memory_id: "mem_one" } },
          { id: "point-2", score: 0.74, payload: { memory_id: "mem_two" } },
          { id: "point-3", score: 0.5, payload: {} },
        ],
      };
    },
    async delete(name, request) {
      calls.push(["delete", name, request]);
    },
    async deleteCollection(name) {
      calls.push(["deleteCollection", name]);
      collectionExists = false;
    },
  };
}

test("memory embedding text includes a distinct editable summary", () => {
  assert.equal(
    memoryEmbeddingText({
      raw_text: "Maya visited the museum.",
      summary: "A museum visit with Maya.",
    }),
    "Maya visited the museum.\nA museum visit with Maya.",
  );
  assert.equal(
    memoryEmbeddingText({
      raw_text: "Maya visited the museum.",
      summary: "Maya visited the museum.",
    }),
    "Maya visited the museum.",
  );
});

test("memory point IDs are deterministic Qdrant-compatible UUIDs", () => {
  const first = memoryPointId("mem_one");
  assert.equal(first, memoryPointId("mem_one"));
  assert.notEqual(first, memoryPointId("mem_two"));
  assert.match(
    first,
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});

test("Qdrant Cloud configuration requires HTTPS and a database API key", () => {
  assert.throws(
    () => getQdrantCloudConfig({}),
    /QDRANT_URL is required/,
  );
  assert.throws(
    () =>
      getQdrantCloudConfig({
        QDRANT_URL: "http://cluster.example.com:6333",
        QDRANT_API_KEY: "secret",
      }),
    /must use HTTPS/,
  );
  assert.throws(
    () =>
      getQdrantCloudConfig({
        QDRANT_URL: "https://cluster.example.com:6333",
      }),
    /QDRANT_API_KEY is required/,
  );

  assert.deepEqual(
    getQdrantCloudConfig({
      QDRANT_URL: "https://cluster.example.com:6333/",
      QDRANT_API_KEY: "secret",
      QDRANT_TIMEOUT_MS: "15000",
    }),
    {
      url: "https://cluster.example.com:6333",
      apiKey: "secret",
      timeout: 15000,
    },
  );
});

test("indexing creates the collection and upserts the memory vector", async () => {
  const client = fakeClient();
  const store = createMemoryVectorStore({
    client,
    embed: async () => [0.1, 0.2, 0.3],
    collectionName: "test_memories",
    vectorSize: 3,
    embeddingModel: "test-model",
  });

  await store.indexMemory({
    id: "mem_one",
    raw_text: "Maya visited the museum.",
    summary: "A museum visit.",
    source: "ui",
    ingestion_date: "2026-06-12T00:00:00.000Z",
  });

  assert.deepEqual(client.calls[1], [
    "createCollection",
    "test_memories",
    { vectors: { size: 3, distance: "Cosine" } },
  ]);
  const upsert = client.calls.find(([method]) => method === "upsert");
  assert.equal(upsert[2].points[0].payload.memory_id, "mem_one");
  assert.equal(upsert[2].points[0].payload.embedding_model, "test-model");
  assert.deepEqual(upsert[2].points[0].vector, [0.1, 0.2, 0.3]);
});

test("semantic search returns memory IDs and similarity scores in Qdrant order", async () => {
  const client = fakeClient({ exists: true });
  const store = createMemoryVectorStore({
    client,
    embed: async () => [0.3, 0.2, 0.1],
    collectionName: "test_memories",
    vectorSize: 3,
  });

  const hits = await store.searchMemories("art and exhibitions", {
    limit: 2,
    scoreThreshold: 0.7,
  });

  assert.deepEqual(hits, [
    { id: "mem_one", score: 0.91 },
    { id: "mem_two", score: 0.74 },
  ]);
  const query = client.calls.find(([method]) => method === "query");
  assert.equal(query[2].limit, 2);
  assert.equal(query[2].score_threshold, 0.7);
  assert.deepEqual(query[2].query, [0.3, 0.2, 0.1]);
});
