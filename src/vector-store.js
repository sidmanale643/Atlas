import { createHash } from "node:crypto";
import { connect as connectLanceDb } from "@lancedb/lancedb";
import { QdrantClient } from "@qdrant/js-client-rest";
import {
  Field,
  FixedSizeList,
  Float32,
  Float64,
  List,
  Schema,
  Utf8,
} from "apache-arrow";

export const EMBEDDING_MODEL =
  process.env.EMBEDDING_MODEL || "Xenova/all-MiniLM-L6-v2";
export const EMBEDDING_DIMENSIONS = Number.parseInt(
  process.env.EMBEDDING_DIMENSIONS || "384",
  10,
);
export const QDRANT_COLLECTION =
  process.env.QDRANT_COLLECTION || "atlas_memories";
export const LANCEDB_PATH = process.env.LANCEDB_PATH || "./lancedb";
export const LANCEDB_TABLE = process.env.LANCEDB_TABLE || "atlas_memories";

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

function lanceDbSchema(vectorSize, embeddingModel) {
  return new Schema(
    [
      new Field("memory_id", new Utf8(), false),
      new Field(
        "vector",
        new FixedSizeList(
          vectorSize,
          new Field("item", new Float32(), false),
        ),
        false,
      ),
      new Field("type", new Utf8(), true),
      new Field("title", new Utf8(), true),
      new Field("confidence", new Float64(), true),
      new Field(
        "tags",
        new List(new Field("item", new Utf8(), false)),
        false,
      ),
      new Field("scope", new Utf8(), false),
      new Field("embedding_model", new Utf8(), false),
      new Field("source", new Utf8(), false),
      new Field("ingestion_date", new Utf8(), true),
      new Field("created_at", new Utf8(), true),
      new Field("updated_at", new Utf8(), true),
    ],
    new Map([
      ["embedding_model", embeddingModel],
      ["embedding_dimensions", String(vectorSize)],
    ]),
  );
}

function escapeSqlString(value) {
  return String(value).replaceAll("'", "''");
}

function validateVector(vector, vectorSize) {
  if (!Array.isArray(vector) && !ArrayBuffer.isView(vector)) {
    throw new Error("Embedding must be an array or typed array");
  }
  if (vector.length !== vectorSize) {
    throw new Error(
      `Embedding has ${vector.length} dimensions; expected ${vectorSize}`,
    );
  }
}

export function createLanceDbMemoryVectorStore({
  connection,
  path = LANCEDB_PATH,
  tableName = LANCEDB_TABLE,
  embed = embedText,
  vectorSize = EMBEDDING_DIMENSIONS,
  embeddingModel = EMBEDDING_MODEL,
} = {}) {
  if (!Number.isInteger(vectorSize) || vectorSize <= 0) {
    throw new Error("LanceDB vector size must be a positive integer");
  }

  let connectionPromise = connection
    ? Promise.resolve(connection)
    : undefined;
  let tablePromise;

  async function getConnection() {
    if (!connectionPromise) {
      connectionPromise = connectLanceDb(path).catch((error) => {
        connectionPromise = undefined;
        throw error;
      });
    }
    return connectionPromise;
  }

  async function validateTable(table) {
    const schema = await table.schema();
    const vectorField = schema.fields.find((field) => field.name === "vector");
    const actualSize = vectorField?.type?.listSize;
    if (actualSize !== vectorSize) {
      throw new Error(
        `LanceDB table "${tableName}" uses ${actualSize ?? "unknown"} dimensions; expected ${vectorSize}`,
      );
    }

    const actualModel = schema.metadata?.get("embedding_model");
    if (actualModel !== embeddingModel) {
      throw new Error(
        `LanceDB table "${tableName}" uses embedding model "${actualModel || "unknown"}"; expected "${embeddingModel}"`,
      );
    }
    return table;
  }

  async function ensureTable() {
    if (!tablePromise) {
      tablePromise = (async () => {
        const db = await getConnection();
        const names = await db.tableNames();
        const table = names.includes(tableName)
          ? await db.openTable(tableName)
          : await db.createEmptyTable(
              tableName,
              lanceDbSchema(vectorSize, embeddingModel),
              { mode: "create", existOk: true },
            );
        return validateTable(table);
      })().catch((error) => {
        tablePromise = undefined;
        throw error;
      });
    }
    return tablePromise;
  }

  async function indexMemory(memory) {
    if (!memory?.id) throw new Error("Memory ID is required for vector indexing");

    const vector = await embed(memoryEmbeddingText(memory));
    validateVector(vector, vectorSize);
    const table = await ensureTable();
    await table
      .mergeInsert("memory_id")
      .whenMatchedUpdateAll()
      .whenNotMatchedInsertAll()
      .execute([
        {
          memory_id: String(memory.id),
          vector: Array.from(vector),
          type: memory.type == null ? null : String(memory.type),
          title: memory.title == null ? null : String(memory.title),
          confidence:
            memory.confidence == null ? null : Number(memory.confidence),
          tags: (memory.tags || []).map(String),
          scope: "agent",
          embedding_model: embeddingModel,
          source: String(memory.source || "ui"),
          ingestion_date:
            memory.ingestion_date == null
              ? null
              : String(memory.ingestion_date),
          created_at:
            memory.created_at == null ? null : String(memory.created_at),
          updated_at:
            memory.updated_at == null ? null : String(memory.updated_at),
        },
      ]);
  }

  async function searchMemories(query, { limit = 10, scoreThreshold } = {}) {
    const vector = await embed(query);
    validateVector(vector, vectorSize);
    const table = await ensureTable();
    const rows = await table
      .vectorSearch(Array.from(vector))
      .distanceType("cosine")
      .select(["memory_id", "_distance"])
      .limit(limit)
      .toArray();

    return rows
      .map((row) => ({
        id: row.memory_id,
        score: 1 - row._distance,
      }))
      .filter(
        (row) =>
          typeof row.id === "string" &&
          (scoreThreshold == null || row.score >= scoreThreshold),
      );
  }

  async function deleteMemory(memoryId) {
    const db = await getConnection();
    if (!(await db.tableNames()).includes(tableName)) return;
    const table = await ensureTable();
    await table.delete(`memory_id = '${escapeSqlString(memoryId)}'`);
  }

  async function deleteAllMemories() {
    const db = await getConnection();
    if (!(await db.tableNames()).includes(tableName)) return;

    const table = await tablePromise;
    table?.close();
    await db.dropTable(tableName);
    tablePromise = undefined;
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

export function assertAtlasModeSupported(environment = process.env) {
  const mode = String(environment.ATLAS_MODE || "local").trim().toLowerCase();
  if (mode === "cloud") {
    throw new Error(
      "ATLAS_MODE=cloud is not available yet; managed Atlas cloud service support has not been implemented.",
    );
  }
  if (mode !== "local") {
    throw new Error(`Invalid ATLAS_MODE "${mode}"; expected "local" or "cloud".`);
  }
  return mode;
}

function getDefaultStore() {
  if (!defaultStore) {
    assertAtlasModeSupported();
    defaultStore = createLanceDbMemoryVectorStore();
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
