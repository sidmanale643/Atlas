import { createHash } from "node:crypto";
import { QdrantClient } from "@qdrant/js-client-rest";

export const EMBEDDING_MODEL =
  process.env.EMBEDDING_MODEL || "Xenova/all-MiniLM-L6-v2";
export const EMBEDDING_DIMENSIONS = Number.parseInt(
  process.env.EMBEDDING_DIMENSIONS || "384",
  10,
);
export const QDRANT_COLLECTION =
  process.env.QDRANT_COLLECTION || "atlas_memories";

let embedderPromise;
let defaultStore;

async function loadEmbedder() {
  if (!embedderPromise) {
    embedderPromise = import("@huggingface/transformers")
      .then(({ pipeline }) =>
        pipeline("feature-extraction", EMBEDDING_MODEL, {
          dtype: process.env.EMBEDDING_DTYPE || "q8",
        }),
      )
      .catch((error) => {
        embedderPromise = undefined;
        throw error;
      });
  }
  return embedderPromise;
}

export async function embedText(text) {
  const input = String(text || "").trim();
  if (!input) throw new Error("Cannot embed empty text");

  const embedder = await loadEmbedder();
  const output = await embedder(input, {
    pooling: "mean",
    normalize: true,
  });
  const values = output.tolist();
  const vector = Array.isArray(values[0]) ? values[0] : values;

  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embedding model returned ${vector.length} dimensions; expected ${EMBEDDING_DIMENSIONS}`,
    );
  }
  return vector;
}

export function memoryEmbeddingText(memory) {
  const rawText = String(memory?.raw_text || "").trim();
  const summary = String(memory?.summary || "").trim();
  return summary && summary !== rawText ? `${rawText}\n${summary}` : rawText;
}

export function memoryPointId(memoryId) {
  const bytes = createHash("sha256").update(String(memoryId)).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

export function createMemoryVectorStore({
  client,
  embed = embedText,
  collectionName = QDRANT_COLLECTION,
  vectorSize = EMBEDDING_DIMENSIONS,
  embeddingModel = EMBEDDING_MODEL,
} = {}) {
  let collectionPromise;

  async function ensureCollection() {
    if (!collectionPromise) {
      collectionPromise = (async () => {
        const { exists } = await client.collectionExists(collectionName);
        if (!exists) {
          try {
            await client.createCollection(collectionName, {
              vectors: { size: vectorSize, distance: "Cosine" },
            });
          } catch (error) {
            const result = await client.collectionExists(collectionName);
            if (!result.exists) throw error;
          }
        }

        const collection = await client.getCollection(collectionName);
        const vectors = collection.config?.params?.vectors;
        if (vectors?.size && vectors.size !== vectorSize) {
          throw new Error(
            `Qdrant collection "${collectionName}" uses ${vectors.size} dimensions; expected ${vectorSize}`,
          );
        }
      })().catch((error) => {
        collectionPromise = undefined;
        throw error;
      });
    }
    return collectionPromise;
  }

  async function indexMemory(memory) {
    if (!memory?.id) throw new Error("Memory ID is required for vector indexing");
    await ensureCollection();

    const text = memoryEmbeddingText(memory);
    const vector = await embed(text);
    if (vector.length !== vectorSize) {
      throw new Error(
        `Embedding has ${vector.length} dimensions; expected ${vectorSize}`,
      );
    }

    await client.upsert(collectionName, {
      wait: true,
      points: [
        {
          id: memoryPointId(memory.id),
          vector,
          payload: {
            memory_id: memory.id,
            type: memory.type,
            title: memory.title,
            confidence: memory.confidence,
            tags: memory.tags || [],
            scope: "agent",
            embedding_model: embeddingModel,
            source: memory.source || "ui",
            ingestion_date: memory.ingestion_date,
            created_at: memory.created_at,
            updated_at: memory.updated_at,
          },
        },
      ],
    });
  }

  async function searchMemories(query, { limit = 10, scoreThreshold } = {}) {
    await ensureCollection();
    const vector = await embed(query);

    const response = await client.query(collectionName, {
      query: vector,
      limit,
      score_threshold: scoreThreshold,
      with_payload: true,
      with_vector: false,
    });

    return response.points
      .filter((point) => typeof point.payload?.memory_id === "string")
      .map((point) => ({
        id: point.payload.memory_id,
        score: point.score,
      }));
  }

  async function deleteMemory(memoryId) {
    const { exists } = await client.collectionExists(collectionName);
    if (!exists) return;

    await client.delete(collectionName, {
      wait: true,
      points: [memoryPointId(memoryId)],
    });
  }

  async function deleteAllMemories() {
    const { exists } = await client.collectionExists(collectionName);
    if (!exists) return;

    await client.deleteCollection(collectionName);
    collectionPromise = undefined;
  }

  return {
    deleteAllMemories,
    deleteMemory,
    indexMemory,
    searchMemories,
  };
}

export function getQdrantCloudConfig(environment = process.env) {
  const url = String(environment.QDRANT_URL || "").trim();
  const apiKey = String(environment.QDRANT_API_KEY || "").trim();
  const timeout = Number.parseInt(
    environment.QDRANT_TIMEOUT_MS || "10000",
    10,
  );

  if (!url) {
    throw new Error(
      "QDRANT_URL is required. Use the HTTPS REST endpoint from your Qdrant Cloud cluster.",
    );
  }
  if (!apiKey) {
    throw new Error(
      "QDRANT_API_KEY is required. Create a Database API key in Qdrant Cloud.",
    );
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("QDRANT_URL must be a valid HTTPS URL.");
  }
  if (parsedUrl.protocol !== "https:") {
    throw new Error("QDRANT_URL must use HTTPS for Qdrant Cloud.");
  }
  if (!Number.isInteger(timeout) || timeout <= 0) {
    throw new Error("QDRANT_TIMEOUT_MS must be a positive integer.");
  }

  return {
    url: parsedUrl.href.replace(/\/$/, ""),
    apiKey,
    timeout,
  };
}

export function createQdrantCloudClient(environment = process.env) {
  const config = getQdrantCloudConfig(environment);
  return new QdrantClient({
    ...config,
    checkCompatibility: false,
  });
}

function getDefaultStore() {
  if (!defaultStore) {
    defaultStore = createMemoryVectorStore({
      client: createQdrantCloudClient(),
    });
  }
  return defaultStore;
}

export const indexMemoryVector = (memory) =>
  getDefaultStore().indexMemory(memory);
export const searchMemoryVectors = (query, options) =>
  getDefaultStore().searchMemories(query, options);
export const deleteMemoryVector = (memoryId) =>
  getDefaultStore().deleteMemory(memoryId);
export const deleteAllMemoryVectors = () =>
  getDefaultStore().deleteAllMemories();

const RRF_K = 60;

export async function hybridSearchMemories(
  query,
  { limit = 10, strategy = "hybrid", scoreThreshold, searchMemoriesFts } = {},
) {
  if (strategy === "bm25") {
    return bm25OnlySearch(query, { limit, scoreThreshold, searchMemoriesFts });
  }

  const vectorResultsPromise = searchMemoryVectors(query, {
    limit: Math.max(limit * 3, 30),
    scoreThreshold,
  }).catch(() => []);

  const bm25ResultsPromise = Promise.resolve(
    searchMemoriesFts
      ? searchMemoriesFts(query, { limit: Math.max(limit * 3, 30) })
      : [],
  );

  const [vectorResults, bm25Results] = await Promise.all([
    vectorResultsPromise,
    bm25ResultsPromise,
  ]);

  if (strategy === "vector") {
    return vectorResults;
  }

  return fuseWithRrf(vectorResults, bm25Results, limit);
}

function bm25OnlySearch(query, { limit, scoreThreshold, searchMemoriesFts }) {
  const bm25Results = searchMemoriesFts
    ? searchMemoriesFts(query, { limit })
    : [];
  if (!scoreThreshold) return bm25Results;
  const maxScore = Math.max(...bm25Results.map((r) => r.score), 0);
  if (maxScore === 0) return bm25Results;
  return bm25Results.filter(
    (r) => Math.abs(r.score / maxScore) >= Math.abs(scoreThreshold),
  );
}

export function fuseWithRrf(vectorResults, bm25Results, limit) {
  const scores = new Map();

  for (let rank = 0; rank < vectorResults.length; rank++) {
    const { id } = vectorResults[rank];
    const existing = scores.get(id) || 0;
    scores.set(id, existing + 1 / (RRF_K + rank + 1));
  }

  for (let rank = 0; rank < bm25Results.length; rank++) {
    const { id } = bm25Results[rank];
    const existing = scores.get(id) || 0;
    scores.set(id, existing + 1 / (RRF_K + rank + 1));
  }

  const fused = [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return fused;
}
