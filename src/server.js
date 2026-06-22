import "dotenv/config";
import express from "express";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import { pathToFileURL } from "url";
import { existsSync } from "fs";
import { createHash, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import { compareMemories, decideMemoryWrite, extractAtomicMemories, extractMemory } from "./llm.js";
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
import { retrieveExtractionContext } from "./extraction-context.js";
import createLogger from "./logger.js";
import { createIngestionService } from "./ingestion-service.js";
import { verifyAccessToken } from "./supabase-auth.js";
import {
  assertAtlasModeSupported,
  deleteAllMemoryVectors,
  deleteMemoryVector,
  hybridSearchMemories,
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
  searchMemoriesFts,
  deleteAllMemories,
  deleteAllEntities,
  deleteMemory,
  deleteMemoriesByOwner,
  claimAnnotationJob,
  completeAnnotationJob,
  createMemorySource,
  createSourceRevision,
  enqueueAnnotationJob,
  enqueueVectorIndexJob,
  failAnnotationJob,
  getAnnotationStatus,
  getMemorySource,
  getSourceMemoryLinks,
  getVectorIndexStatus,
  linkSourceMemory,
  recoverAnnotationJobs,
  retryAnnotationJob,
  saveCognitiveAnnotation,
  updateMemoryGraph,
  updateMemorySourceStatus,
  withTransaction,
  claimIpMemoryQuota,
  getIpMemoryQuota,
  claimAccountMemoryQuota,
  claimGuestMemoryQuotaForAccount,
  getAccountMemoryQuota,
} from "./db.js";

const log = createLogger("server");
const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");
const PORT = process.env.PORT || 3001;
const MEMORY_QUOTA_LIMIT = 10;
const ACCOUNT_MEMORY_QUOTA_LIMIT = 25;
const zSourceRevision = z.object({
  text: z.string().min(1).max(2000),
  author: z.string().trim().min(1).max(200).optional(),
  reason: z.string().trim().min(1).max(500).optional(),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
}).strict();

// The Vite-built React SPA (npm run build:web) emits here. React Router owns all
// client routes; the SPA is the only frontend (run the build before starting).
const spaDir = join(publicDir, "app");
const spaIndex = join(spaDir, "index.html");
const hasSpa = existsSync(spaIndex);

const defaultDependencies = {
  backfillRegionActivations,
  compareMemories,
  decideMemoryWrite,
  deleteAllMemoryVectors,
  deleteAllMemories,
  deleteAllEntities,
  deleteMemoryVector,
  deleteMemory,
  deleteMemoriesByOwner,
  extractAtomicMemories,
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
  updateMemoryGraph,
  createMemorySource,
  createSourceRevision,
  updateMemorySourceStatus,
  getMemorySource,
  getSourceMemoryLinks,
  linkSourceMemory,
  enqueueAnnotationJob,
  enqueueVectorIndexJob,
  getAnnotationStatus,
  getVectorIndexStatus,
  withTransaction,
  claimIpMemoryQuota,
  getIpMemoryQuota,
  claimAccountMemoryQuota,
  claimGuestMemoryQuotaForAccount,
  getAccountMemoryQuota,
  verifyAccessToken,
};

export function createAtlasApp(overrides = {}) {
  const dependencies = { ...defaultDependencies, ...overrides };
  dependencies.serializeMemory ||= (memory) => serializeMemory(memory, dependencies, {
    includeRelationships: true,
  });
  dependencies.ingestionService ||= createIngestionService(dependencies);
  const app = express();

  dependencies.getDb();
  dependencies.backfillRegionActivations();
  app.use(express.json());
  // Serve the Vite-built SPA assets first so /assets/index-<hash>.js resolves
  // from public/app/assets, then fall through to public/assets for static files
  // the SPA loads by absolute path (e.g. /assets/brain.obj, /fonts/*). Mounting
  // the app dir first keeps ordering correct (app/assets wins; misses fall
  // through to public/assets).
  app.use(express.static(spaDir, { index: false }));
  // Do not auto-serve index.html at "/"; the SPA owns that route.
  app.use(express.static(publicDir, { index: false }));
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

  app.use("/api", async (req, res, next) => {
    const authorization = req.get("authorization");
    if (!authorization) {
      req.identity = anonymousIdentity(req);
      return next();
    }
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return res.status(401).json({ error: "Invalid authorization header" });
    }
    try {
      const user = await dependencies.verifyAccessToken(match[1]);
      if (!user?.id) {
        return res.status(401).json({ error: "Invalid or expired access token" });
      }
      req.identity = authenticatedIdentity(req, user);
      return next();
    } catch (error) {
      log.error("access token verification failed", { error: error.message });
      return res.status(401).json({ error: "Invalid or expired access token" });
    }
  });

  app.get("/api/memory-quota", (req, res) => {
    const identity = requestIdentity(req);
    res.json(identity.authenticated
      ? dependencies.getAccountMemoryQuota(
        identity.ownerHash,
        ACCOUNT_MEMORY_QUOTA_LIMIT,
      )
      : dependencies.getIpMemoryQuota(identity.ipHash, MEMORY_QUOTA_LIMIT));
  });

  app.post("/api/auth/claim", (req, res) => {
    const identity = requestIdentity(req);
    if (!identity.authenticated) {
      return res.status(401).json({ error: "Authentication required" });
    }
    res.json(dependencies.claimGuestMemoryQuotaForAccount({
      ipHash: identity.ipHash,
      accountHash: identity.ownerHash,
      accountLimit: ACCOUNT_MEMORY_QUOTA_LIMIT,
    }));
  });

  app.post("/api/memories", async (req, res) => {
    const parsed = MemoryRequest.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues });
    }

    const identity = requestIdentity(req);
    const ownerHash = identity.ownerHash;
    const quota = identity.authenticated
      ? dependencies.claimAccountMemoryQuota(ownerHash, ACCOUNT_MEMORY_QUOTA_LIMIT)
      : dependencies.claimIpMemoryQuota(identity.ipHash, MEMORY_QUOTA_LIMIT);
    if (!quota.allowed) {
      return res.status(429).json({
        error: identity.authenticated
          ? "You have reached the 25-memory account limit."
          : "You have reached the 10-memory limit for this network.",
        code: "MEMORY_QUOTA_REACHED",
        quota: withoutAllowed(quota),
      });
    }

    const { text, ingestionDate } = parsed.data;
    const date = ingestionDate || new Date().toISOString();

    try {
      const result = await dependencies.ingestionService.ingest({
        text,
        ingestionDate: date,
        source: "ui",
        metadata: { ownerHash },
      });
      log.info("source ingested", { sourceId: result.sourceId, count: result.memories.length });
      res.status(201).json({ ...result, quota: withoutAllowed(quota) });
    } catch (error) {
      log.error("ingestion failed", { sourceId: error.sourceId, error: error.message });
      res.status(502).json({
        error: "Ingestion failed",
        code: error.code || "INGESTION_FAILED",
        sourceId: error.sourceId,
        detail: error.message,
      });
    }
  });

  app.get("/api/memories", (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    const source = req.query.source || undefined;
    const rows = dependencies.getMemories({
      limit, offset, source, ownerHash: requestOwnerHash(req),
    });
    res.json(rows.map((row) => serializeMemory(row, dependencies)));
  });

  app.get("/api/sources/:id", (req, res) => {
    const source = dependencies.getMemorySource(req.params.id, {
      includeRevisions: true,
    });
    if (!source || source.metadata_json?.ownerHash !== requestOwnerHash(req)) {
      return res.status(404).json({ error: "Source not found" });
    }
    res.json({ ...source, links: dependencies.getSourceMemoryLinks(source.id) });
  });

  app.post("/api/sources/:id/revisions", async (req, res) => {
    const source = dependencies.getMemorySource(req.params.id);
    if (!source || source.metadata_json?.ownerHash !== requestOwnerHash(req)) {
      return res.status(404).json({ error: "Source not found" });
    }
    const parsed = zSourceRevision.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    const revision = dependencies.createSourceRevision({
      id: randomUUID(),
      sourceId: source.id,
      ...parsed.data,
    });
    try {
      const result = await dependencies.ingestionService.reprocess(source.id, {
        metadata: parsed.data.metadata,
      });
      res.status(201).json({ revision, ...result });
    } catch (error) {
      res.status(502).json({
        error: "Reprocessing failed",
        code: error.code || "INGESTION_FAILED",
        sourceId: source.id,
        revisionId: revision.id,
        detail: error.message,
      });
    }
  });

  app.get("/api/catalog/memories", (req, res) => {
    const parsed = parseCatalogQuery(req.query, {
      defaultSort: "created_at",
      defaultOrder: "desc",
      sorts: ["title", "type", "source", "confidence", "created_at", "linked"],
      filters: {
        source: ["ui", "mcp"],
        type: null,
      },
    });
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    res.json(dependencies.getMemoryCatalog({
      ...parsed.value,
      ownerHash: requestOwnerHash(req),
    }));
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
    res.json(dependencies.getEntityCatalog({
      ...parsed.value,
      ownerHash: requestOwnerHash(req),
    }));
  });

  app.get("/api/memories/search", async (req, res) => {
    const query = String(req.query.q || "").trim();
    if (!query) {
      return res.status(400).json({ error: "q query param required" });
    }

    const limit = clampInteger(req.query.limit, 10, 1, 100);
    const scoreThreshold = parseOptionalNumber(req.query.scoreThreshold);
    const strategy = String(req.query.strategy || "hybrid");
    const validStrategies = ["hybrid", "vector", "bm25"];
    if (!validStrategies.includes(strategy)) {
      return res.status(400).json({
        error: `strategy must be one of: ${validStrategies.join(", ")}`,
      });
    }

    try {
      const ownerHash = requestOwnerHash(req);
      const hits = await hybridSearchMemories(query, {
        limit: Math.max(limit * 10, 100),
        scoreThreshold,
        strategy,
        searchMemoriesFts: (value, options) => searchMemoriesFts(value, {
          ...options,
          ownerHash,
        }),
      });
      const hitIds = hits.map(({ id }) => id);
      const memoriesById = new Map(
        dependencies.getMemoriesByIds(hitIds, { ownerHash }).map((m) => [m.id, m]),
      );
      const memories = hits.flatMap(({ id, score }) => {
        const memory = memoriesById.get(id);
        return memory
          ? [{ ...serializeMemory(memory, dependencies), rrfScore: score }]
          : [];
      }).slice(0, limit);
      res.json({ query, strategy, memories });
    } catch (error) {
      log.error("search failed", { error: error.message });
      res.status(503).json({
        error: "Search unavailable",
        detail: error.message,
      });
    }
  });

  app.get("/api/memories/:id", (req, res) => {
    const memory = ownedMemory(req, req.params.id, dependencies);
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

    const ownerHash = requestOwnerHash(req);
    if (!dependencies.getMemory(req.params.id, { ownerHash })) {
      return res.status(404).json({ error: "Memory not found" });
    }
    const result = await deriveRelatedMemories(
      req.params.id,
      {
        getMemory: (id) => dependencies.getMemory(id, { ownerHash }),
        getStructuralMemoryLinks: dependencies.getStructuralMemoryLinks,
        searchMemoryVectors: dependencies.searchMemoryVectors,
        searchMemoriesFts: (value, options) => searchMemoriesFts(value, {
          ...options, ownerHash,
        }),
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
    const ownerHash = requestOwnerHash(req);
    const leftMemory = dependencies.getMemory(leftMemoryId, { ownerHash });
    const rightMemory = dependencies.getMemory(rightMemoryId, { ownerHash });
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

  app.delete("/api/memories", async (req, res) => {
    const ids = dependencies.deleteMemoriesByOwner(requestOwnerHash(req));
    await Promise.all(ids.map((id) => syncVectorIndex(
      () => dependencies.deleteMemoryVector(id),
      { action: "delete", id },
    )));
    log.info("user memories deleted", { count: ids.length });
    res.json({ ok: true });
  });

  app.delete("/api/memories/:id", async (req, res) => {
    const memory = ownedMemory(req, req.params.id, dependencies);
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

    const existing = ownedMemory(req, req.params.id, dependencies);
    if (!existing) return res.status(404).json({ error: "Memory not found" });
    dependencies.updateMemorySummary(req.params.id, parsed.data.summary);
    const memory = ownedMemory(req, req.params.id, dependencies);
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
    res.json(dependencies.getEntityCatalog({
      q: String(q), limit: 100, ownerHash: requestOwnerHash(req),
    }).items);
  });

  app.delete("/api/entities", async (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/graph", (req, res) => {
    try {
      const ownedIds = new Set(dependencies.getMemories({
        ownerHash: requestOwnerHash(req),
        limit: 100,
      }).map(({ id }) => id));
      res.json(scopeGraphData(dependencies.getGraphData(), ownedIds));
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

    const ownerHash = requestOwnerHash(req);
    const memories = dependencies
      .getMemoriesForEntity(entityId)
      .filter((memory) => memory.owner_hash === ownerHash)
      .map((memory) => serializeMemory(memory, dependencies));
    if (!memories.length) return res.status(404).json({ error: "Entity not found" });
    const ownedMemoryIds = new Set(memories.map(({ id }) => id));
    const relationships = dependencies
      .getRelationshipsForEntity(entityId)
      .filter((relationship) => ownedMemoryIds.has(relationship.memory_id))
      .map(serializeRelationship);
    const aliases = [];
    const suggestions = [];
    res.json({ entity, aliases, memories, relationships, suggestions });
  });

  app.get("/api/entities/:id/memories", (req, res) => {
    const ownerHash = requestOwnerHash(req);
    const memories = dependencies.getMemoriesForEntity(
      Number.parseInt(req.params.id, 10),
    ).filter((memory) => memory.owner_hash === ownerHash);
    res.json(memories);
  });

  app.get("/api/entity-resolution/suggestions", (req, res) => {
    const status = String(req.query.status || "pending");
    if (!["pending", "merged", "rejected"].includes(status)) {
      return res.status(400).json({ error: `Invalid status: ${status}` });
    }
    res.json({ suggestions: [] });
  });

  app.patch("/api/entity-resolution/suggestions/:id", (_req, res) => {
    res.status(404).json({ error: "Suggestion not found" });
  });

  app.post("/api/extract", async (req, res) => {
    const parsed = MemoryRequest.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues });
    }

    const { text, ingestionDate } = parsed.data;

    try {
      const context = await retrieveExtractionContext(text, {
        ...dependencies,
        ownerHash: requestOwnerHash(req),
      })
        .catch(() => ({ entities: [] }));
      const extraction = await dependencies.extractAtomicMemories(
        text,
        ingestionDate || new Date().toISOString(),
        context,
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

  // All client routes are owned by the React SPA: serve the built shell and let
  // React Router resolve the view. Requires `npm run build:web` (public/app/).
  if (hasSpa) {
    const spaRoutes = [
      "/",
      "/landing",
      "/atlas",
      "/memories",
      "/entities",
      "/memories/compare",
      "/graph",
    ];
    app.get(spaRoutes, (_req, res) => {
      res.sendFile(spaIndex);
    });

    // Deep-link fallback: any other non-API GET that accepts HTML gets the SPA
    // shell so client-side routes work on refresh. Excludes API/static prefixes.
    app.get("*", (req, res, next) => {
      if (
        req.method !== "GET"
        || req.path.startsWith("/api")
        || req.path.startsWith("/js")
        || req.path.startsWith("/assets")
        || req.path.startsWith("/fonts")
      ) {
        return next();
      }
      if (!req.accepts("html")) return next();
      res.sendFile(spaIndex);
    });
  }

  return app;
}

function withoutAllowed({ allowed: _allowed, ...quota }) {
  return quota;
}

function getClientIp(req) {
  const candidates = [
    req.headers["x-vercel-forwarded-for"],
    req.headers["x-forwarded-for"],
    req.headers["x-real-ip"],
    req.socket?.remoteAddress,
  ];
  for (const candidate of candidates) {
    const first = Array.isArray(candidate) ? candidate[0] : String(candidate || "").split(",")[0];
    const normalized = normalizeIp(first);
    if (normalized) return normalized;
  }
  return "unknown";
}

function normalizeIp(value) {
  let candidate = String(value || "").trim().replace(/^"|"$/g, "");
  if (candidate.startsWith("[") && candidate.includes("]")) {
    candidate = candidate.slice(1, candidate.indexOf("]"));
  }
  const ipv4WithPort = candidate.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (ipv4WithPort) candidate = ipv4WithPort[1];
  if (candidate.startsWith("::ffff:") && isIP(candidate.slice(7)) === 4) {
    candidate = candidate.slice(7);
  }
  return isIP(candidate) ? candidate.toLowerCase() : null;
}

function hashClientIp(ip) {
  const salt = process.env.MEMORY_QUOTA_SALT || "neurogram-memory-quota-v1";
  return hashIdentity(salt, "ip", ip);
}

function hashAccountId(userId) {
  const salt = process.env.MEMORY_OWNER_SALT
    || process.env.MEMORY_QUOTA_SALT
    || "neurogram-memory-owner-v1";
  return hashIdentity(salt, "account", userId);
}

function hashIdentity(salt, kind, value) {
  return createHash("sha256").update(`${salt}:${kind}:${value}`).digest("hex");
}

function anonymousIdentity(req) {
  const ipHash = hashClientIp(getClientIp(req));
  return { authenticated: false, ipHash, ownerHash: ipHash, user: null };
}

function authenticatedIdentity(req, user) {
  return {
    authenticated: true,
    ipHash: hashClientIp(getClientIp(req)),
    ownerHash: hashAccountId(user.id),
    user,
  };
}

function requestIdentity(req) {
  return req.identity || anonymousIdentity(req);
}

function requestOwnerHash(req) {
  return requestIdentity(req).ownerHash;
}

function ownedMemory(req, memoryId, dependencies) {
  return dependencies.getMemory(memoryId, { ownerHash: requestOwnerHash(req) });
}

function scopeGraphData(graph, ownedMemoryIds) {
  const edges = (graph.edges || []).filter((edge) =>
    edge.type === "memory-entity"
      ? ownedMemoryIds.has(edge.source)
      : edge.type === "relationship" && ownedMemoryIds.has(edge.memoryId));
  const ownedEntityIds = new Set(edges.flatMap((edge) => [edge.source, edge.target])
    .filter((id) => String(id).startsWith("entity_")));
  const nodes = (graph.nodes || []).filter((node) =>
    node.type === "memory"
      ? ownedMemoryIds.has(node.id)
      : ownedEntityIds.has(node.id));
  return { nodes, edges };
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

export function startAtlasServer(port = PORT) {
  assertAtlasModeSupported();
  const app = createAtlasApp();
  return app.listen(port, () => {
    log.info("server started", { port, url: `http://localhost:${port}` });
  });
}

const isMainModule =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMainModule) startAtlasServer();
