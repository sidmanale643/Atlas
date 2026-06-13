import "dotenv/config";
import express from "express";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import { pathToFileURL } from "url";
import { randomUUID } from "crypto";
import { compareMemories, extractMemory } from "./llm.js";
import { model } from "./llm-config.js";
import {
  MEMORY_COMPARISON_SCHEMA_VERSION,
  MemoryComparisonRequest,
  MemoryRequest,
  SummaryRequest,
} from "./schemas.js";
import {
  buildMemoryStructuralDiff,
  hashMemoryComparisonInput,
} from "./memory-comparison.js";
import { getRelatedMemories as deriveRelatedMemories } from "./related-memories.js";
import createLogger from "./logger.js";
import {
  deleteAllMemoryVectors,
  deleteMemoryVector,
  indexMemoryVector,
  searchMemoryVectors,
} from "./vector-store.js";
import {
  getDb,
  getMemory,
  getMemories,
  getMemoriesByIds,
  updateMemorySummary,
  storeMemory,
  getLatestExtraction,
  getEntity,
  getEntityAliases,
  getEntityCatalog,
  getEntityResolutionSuggestions,
  getEntitiesForMemory,
  getMemoriesForEntity,
  getMemoryCatalog,
  getMemoryComparison,
  getRelationshipsForMemory,
  getRelationshipsForEntity,
  getStructuralMemoryLinks,
  getRegionActivations,
  backfillRegionActivations,
  findEntities,
  getGraphData,
  saveMemoryComparison,
  resolveEntityResolutionSuggestion,
  deleteAllMemories,
  deleteMemory,
} from "./db.js";

const log = createLogger("server");
const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");
const sharedDir = join(__dirname, "shared");
const PORT = process.env.PORT || 3000;

const defaultDependencies = {
  backfillRegionActivations,
  compareMemories,
  deleteAllMemoryVectors,
  deleteAllMemories,
  deleteMemoryVector,
  deleteMemory,
  extractMemory,
  findEntities,
  getDb,
  getEntitiesForMemory,
  getEntity,
  getEntityAliases,
  getEntityCatalog,
  getEntityResolutionSuggestions,
  getGraphData,
  getLatestExtraction,
  getMemories,
  getMemoriesByIds,
  getMemoryCatalog,
  getMemoryComparison,
  getMemoriesForEntity,
  getMemory,
  getRegionActivations,
  getRelationshipsForEntity,
  getRelationshipsForMemory,
  getStructuralMemoryLinks,
  model,
  indexMemoryVector,
  searchMemoryVectors,
  saveMemoryComparison,
  resolveEntityResolutionSuggestion,
  storeMemory,
  updateMemorySummary,
};

export function createNeurogramApp(overrides = {}) {
  const dependencies = { ...defaultDependencies, ...overrides };
  const app = express();

  dependencies.getDb();
  dependencies.backfillRegionActivations();
  app.use(express.json());
  app.use(express.static(publicDir));
  app.use("/js", express.static(sharedDir));
  app.set("etag", false);

  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      log.info("request", {
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        ms: Date.now() - start,
      });
    });
    next();
  });

  app.post("/api/memories", async (req, res) => {
    const parsed = MemoryRequest.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues });
    }

    const { text, ingestionDate } = parsed.data;
    const id = `mem_${randomUUID().slice(0, 8)}`;
    const date = ingestionDate || new Date().toISOString();

    try {
      const extraction = await dependencies.extractMemory(text, date);
      const memory = dependencies.storeMemory(
        id,
        text,
        date,
        extraction,
        dependencies.model,
        "ui",
      );
      await syncVectorIndex(
        () => dependencies.indexMemoryVector(memory),
        { action: "index", id },
      );
      const response = serializeMemory(memory, dependencies, {
        extraction,
        includeRelationships: true,
      });

      log.info("memory stored", {
        id,
        types: extraction.types.map((item) => item.type),
      });
      res.status(201).json(response);
    } catch (error) {
      log.error("extraction failed", { id, error: error.message });
      res.status(502).json({
        error: "Extraction failed",
        detail: error.message,
      });
    }
  });

  app.get("/api/memories", (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    const source = req.query.source || undefined;
    const rows = dependencies.getMemories({ limit, offset, source });
    res.json(rows.map((row) => serializeMemory(row, dependencies)));
  });

  app.get("/api/catalog/memories", (req, res) => {
    const parsed = parseCatalogQuery(req.query, {
      defaultSort: "created_at",
      defaultOrder: "desc",
      sorts: ["title", "type", "source", "confidence", "created_at"],
      filters: {
        source: ["ui", "mcp"],
        type: null,
      },
    });
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    res.json(dependencies.getMemoryCatalog(parsed.value));
  });

  app.get("/api/catalog/entities", (req, res) => {
    const parsed = parseCatalogQuery(req.query, {
      defaultSort: "canonical_name",
      defaultOrder: "asc",
      sorts: [
        "canonical_name",
        "kind",
        "memory_count",
        "relationship_count",
        "created_at",
      ],
      filters: {
        kind: ["person", "place", "object", "concept", "organization"],
      },
    });
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    res.json(dependencies.getEntityCatalog(parsed.value));
  });

  app.get("/api/memories/search", async (req, res) => {
    const query = String(req.query.q || "").trim();
    if (!query) {
      return res.status(400).json({ error: "q query param required" });
    }

    const limit = clampInteger(req.query.limit, 10, 1, 100);
    const scoreThreshold = parseOptionalNumber(req.query.scoreThreshold);

    try {
      const hits = await dependencies.searchMemoryVectors(query, {
        limit,
        scoreThreshold,
      });
      const hitIds = hits.map(({ id }) => id);
      const memoriesById = new Map(
        dependencies.getMemoriesByIds(hitIds).map((m) => [m.id, m]),
      );
      const memories = hits.flatMap(({ id, score }) => {
        const memory = memoriesById.get(id);
        return memory
          ? [{ ...serializeMemory(memory, dependencies), similarity: score }]
          : [];
      });
      res.json({ query, memories });
    } catch (error) {
      log.error("vector search failed", { error: error.message });
      res.status(503).json({
        error: "Vector search unavailable",
        detail: error.message,
      });
    }
  });

  app.get("/api/memories/:id", (req, res) => {
    const memory = dependencies.getMemory(req.params.id);
    if (!memory) return res.status(404).json({ error: "Memory not found" });

    res.json(
      serializeMemory(memory, dependencies, {
        includeRelationships: true,
      }),
    );
  });

  app.get("/api/memories/:id/links", async (req, res) => {
    const limit = parseStrictInteger(req.query.limit, 5, 1, 20, "limit");
    if (!limit.ok) return res.status(400).json({ error: limit.error });
    const scoreThreshold = parseStrictNumber(
      req.query.scoreThreshold,
      0.65,
      -1,
      1,
      "scoreThreshold",
    );
    if (!scoreThreshold.ok) {
      return res.status(400).json({ error: scoreThreshold.error });
    }

    const result = await deriveRelatedMemories(
      req.params.id,
      {
        getMemory: dependencies.getMemory,
        getStructuralMemoryLinks: dependencies.getStructuralMemoryLinks,
        searchMemoryVectors: dependencies.searchMemoryVectors,
        serializeMemory: (memory) =>
          serializeMemory(memory, dependencies, {
            includeRelationships: true,
          }),
      },
      {
        limit: limit.value,
        scoreThreshold: scoreThreshold.value,
      },
    );
    if (!result) return res.status(404).json({ error: "Memory not found" });
    res.json(result);
  });

  app.post("/api/memory-comparisons", async (req, res) => {
    const parsed = MemoryComparisonRequest.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues });
    }

    const { leftMemoryId, rightMemoryId, regenerate } = parsed.data;
    const leftMemory = dependencies.getMemory(leftMemoryId);
    const rightMemory = dependencies.getMemory(rightMemoryId);
    if (!leftMemory || !rightMemory) {
      return res.status(404).json({
        error: "Memory not found",
        missing: [
          ...(!leftMemory ? [leftMemoryId] : []),
          ...(!rightMemory ? [rightMemoryId] : []),
        ],
      });
    }

    const left = serializeMemory(leftMemory, dependencies, {
      includeRelationships: true,
    });
    const right = serializeMemory(rightMemory, dependencies, {
      includeRelationships: true,
    });
    const structuralDiff = buildMemoryStructuralDiff(left, right);
    const inputHash = hashMemoryComparisonInput(left, right);
    const cacheKey = {
      leftMemoryId,
      rightMemoryId,
      inputHash,
      model: dependencies.model,
      schemaVersion: MEMORY_COMPARISON_SCHEMA_VERSION,
    };

    if (!regenerate) {
      const cached = dependencies.getMemoryComparison(cacheKey);
      if (cached) {
        return res.json(
          comparisonResponse({
            left,
            right,
            structuralDiff,
            analysis: cached.comparison_json,
            cache: cached,
            cached: true,
            inputHash,
            model: dependencies.model,
          }),
        );
      }
    }

    try {
      const analysis = await dependencies.compareMemories(left, right);
      const cache = dependencies.saveMemoryComparison({
        ...cacheKey,
        comparison: analysis,
      });
      res.json(
        comparisonResponse({
          left,
          right,
          structuralDiff,
          analysis,
          cache,
          cached: false,
          inputHash,
          model: dependencies.model,
        }),
      );
    } catch (error) {
      log.error("memory comparison failed", {
        leftMemoryId,
        rightMemoryId,
        error: error.message,
      });
      res.status(502).json({
        error: "Comparison generation failed",
        detail: error.message,
        left,
        right,
        structuralDiff,
        analysis: null,
        generation: {
          cached: false,
          saved: false,
          model: dependencies.model,
          schemaVersion: MEMORY_COMPARISON_SCHEMA_VERSION,
          inputHash,
          generatedAt: null,
        },
      });
    }
  });

  app.delete("/api/memories", async (_req, res) => {
    dependencies.deleteAllMemories();
    await syncVectorIndex(
      () => dependencies.deleteAllMemoryVectors(),
      { action: "delete-all" },
    );
    log.info("all memories deleted");
    res.json({ ok: true });
  });

  app.delete("/api/memories/:id", async (req, res) => {
    const memory = dependencies.getMemory(req.params.id);
    if (!memory) return res.status(404).json({ error: "Memory not found" });
    dependencies.deleteMemory(req.params.id);
    await syncVectorIndex(
      () => dependencies.deleteMemoryVector(req.params.id),
      { action: "delete", id: req.params.id },
    );
    log.info("memory deleted", { id: req.params.id });
    res.json({ ok: true });
  });

  app.patch("/api/memories/:id/summary", async (req, res) => {
    const parsed = SummaryRequest.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues });
    }

    dependencies.updateMemorySummary(req.params.id, parsed.data.summary);
    const memory = dependencies.getMemory(req.params.id);
    if (memory) {
      await syncVectorIndex(
        () => dependencies.indexMemoryVector(memory),
        { action: "reindex", id: req.params.id },
      );
    }
    log.info("summary updated", { id: req.params.id });
    res.json({ ok: true });
  });

  app.get("/api/entities", (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: "q query param required" });
    res.json(dependencies.findEntities(q));
  });

  app.get("/api/graph", (_req, res) => {
    try {
      res.json(dependencies.getGraphData());
    } catch (err) {
      console.error("Graph data error:", err);
      res.status(500).json({ error: "Failed to load graph data" });
    }
  });

  app.get("/api/entities/:id/graph", (req, res) => {
    const entityId = Number.parseInt(req.params.id, 10);
    const entity = Number.isInteger(entityId)
      ? dependencies.getEntity(entityId)
      : null;
    if (!entity) return res.status(404).json({ error: "Entity not found" });

    const memories = dependencies
      .getMemoriesForEntity(entityId)
      .map((memory) => serializeMemory(memory, dependencies));
    const relationships = dependencies
      .getRelationshipsForEntity(entityId)
      .map(serializeRelationship);
    const aliases = dependencies.getEntityAliases(entityId);
    const suggestions = dependencies
      .getEntityResolutionSuggestions({ status: "pending" })
      .filter(
        (suggestion) =>
          Number(suggestion.source_entity_id) === entityId
          || Number(suggestion.target_entity_id) === entityId,
      );
    res.json({ entity, aliases, memories, relationships, suggestions });
  });

  app.get("/api/entities/:id/memories", (req, res) => {
    const memories = dependencies.getMemoriesForEntity(
      Number.parseInt(req.params.id, 10),
    );
    res.json(memories);
  });

  app.get("/api/entity-resolution/suggestions", (req, res) => {
    const status = String(req.query.status || "pending");
    if (!["pending", "merged", "rejected"].includes(status)) {
      return res.status(400).json({ error: `Invalid status: ${status}` });
    }
    res.json({
      suggestions: dependencies.getEntityResolutionSuggestions({ status }),
    });
  });

  app.patch("/api/entity-resolution/suggestions/:id", (req, res) => {
    const suggestionId = Number(req.params.id);
    const decision = req.body?.decision;
    if (!Number.isSafeInteger(suggestionId) || suggestionId <= 0) {
      return res.status(400).json({ error: "Invalid suggestion ID" });
    }
    if (!["merge", "reject"].includes(decision)) {
      return res.status(400).json({
        error: "decision must be merge or reject",
      });
    }

    const result = dependencies.resolveEntityResolutionSuggestion(
      suggestionId,
      decision,
    );
    if (!result) {
      return res.status(404).json({ error: "Suggestion not found" });
    }
    res.json(result);
  });

  app.post("/api/extract", async (req, res) => {
    const parsed = MemoryRequest.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues });
    }

    const { text, ingestionDate } = parsed.data;

    try {
      const extraction = await dependencies.extractMemory(
        text,
        ingestionDate || new Date().toISOString(),
      );
      res.json(extraction);
    } catch (error) {
      log.error("extraction failed (legacy)", { error: error.message });
      res.status(502).json({
        error: "Extraction failed",
        detail: error.message,
      });
    }
  });

  app.get(["/memories", "/entities"], (_req, res) => {
    res.sendFile(join(publicDir, "catalog.html"));
  });
  app.get("/memories/compare", (_req, res) => {
    res.sendFile(join(publicDir, "compare.html"));
  });
  app.get("/graph", (_req, res) => {
    res.sendFile(join(publicDir, "graph.html"));
  });

  return app;
}

async function syncVectorIndex(operation, context) {
  try {
    await operation();
    return true;
  } catch (error) {
    log.warn("vector index sync failed", { ...context, error: error.message });
    return false;
  }
}

function clampInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}

function parseOptionalNumber(value) {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseCatalogQuery(
  query,
  { defaultSort, defaultOrder, sorts, filters },
) {
  const limit = parseStrictInteger(query.limit, 25, 1, 100, "limit");
  if (!limit.ok) return limit;
  const offset = parseStrictInteger(
    query.offset,
    0,
    0,
    Number.MAX_SAFE_INTEGER,
    "offset",
  );
  if (!offset.ok) return offset;

  const sort = query.sort === undefined ? defaultSort : String(query.sort);
  if (!sorts.includes(sort)) {
    return { ok: false, error: `Invalid sort: ${sort}` };
  }
  const order = query.order === undefined
    ? defaultOrder
    : String(query.order).toLowerCase();
  if (!["asc", "desc"].includes(order)) {
    return { ok: false, error: `Invalid order: ${query.order}` };
  }

  const value = {
    q: String(query.q || "").trim(),
    limit: limit.value,
    offset: offset.value,
    sort,
    order,
  };
  for (const [name, allowed] of Object.entries(filters)) {
    if (query[name] === undefined || query[name] === "") continue;
    const filterValue = String(query[name]);
    if (allowed && !allowed.includes(filterValue)) {
      return { ok: false, error: `Invalid ${name}: ${filterValue}` };
    }
    value[name] = filterValue;
  }
  return { ok: true, value };
}

function parseStrictInteger(value, fallback, minimum, maximum, name) {
  if (value === undefined) return { ok: true, value: fallback };
  if (!/^\d+$/.test(String(value))) {
    return { ok: false, error: `Invalid ${name}: ${value}` };
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    return { ok: false, error: `Invalid ${name}: ${value}` };
  }
  return { ok: true, value: parsed };
}

function parseStrictNumber(value, fallback, minimum, maximum, name) {
  if (value === undefined) return { ok: true, value: fallback };
  const parsed = Number(value);
  if (
    !Number.isFinite(parsed)
    || parsed < minimum
    || parsed > maximum
  ) {
    return { ok: false, error: `Invalid ${name}: ${value}` };
  }
  return { ok: true, value: parsed };
}

function serializeMemory(
  memory,
  dependencies,
  { extraction, includeRelationships = false } = {},
) {
  return {
    ...memory,
    extraction:
      extraction === undefined
        ? dependencies.getLatestExtraction(memory.id)
        : extraction,
    entities: dependencies.getEntitiesForMemory(memory.id),
    relationships: includeRelationships
      ? dependencies.getRelationshipsForMemory(memory.id)
      : [],
    regions: dependencies.getRegionActivations(memory.id),
  };
}

function serializeRelationship(relationship) {
  return {
    id: relationship.id,
    predicate: relationship.predicate,
    memory_id: relationship.memory_id,
    confidence: relationship.confidence,
    evidence: relationship.evidence,
    created_at: relationship.created_at,
    source: {
      id: relationship.source_entity_id,
      canonical_name: relationship.source_name,
      kind: relationship.source_kind,
    },
    target: {
      id: relationship.target_entity_id,
      canonical_name: relationship.target_name,
      kind: relationship.target_kind,
    },
  };
}

function comparisonResponse({
  left,
  right,
  structuralDiff,
  analysis,
  cache,
  cached,
  inputHash,
  model,
}) {
  return {
    left,
    right,
    structuralDiff,
    analysis,
    generation: {
      cached,
      saved: true,
      model,
      schemaVersion: MEMORY_COMPARISON_SCHEMA_VERSION,
      inputHash,
      generatedAt: cache.generated_at,
    },
  };
}

export function startNeurogramServer(port = PORT) {
  const app = createNeurogramApp();
  return app.listen(port, () => {
    log.info("server started", { port, url: `http://localhost:${port}` });
  });
}

const isMainModule =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMainModule) startNeurogramServer();
