import "dotenv/config";
import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { randomUUID } from "crypto";
import { extractMemory } from "./llm.js";
import { model } from "./llm-config.js";
import { MemoryRequest, SummaryRequest } from "./schemas.js";
import createLogger from "./logger.js";
import {
  getDb,
  getMemory,
  getMemories,
  updateMemorySummary,
  storeMemory,
  getLatestExtraction,
  getEntitiesForMemory,
  getMemoriesForEntity,
  getRelationshipsForMemory,
  getRegionActivations,
  backfillRegionActivations,
  findEntities,
  deleteAllMemories,
  deleteMemory,
} from "./db.js";

const log = createLogger("server");

const db = getDb();
backfillRegionActivations();

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

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

// --- Extract + Store ---

app.post("/api/memories", async (req, res) => {
  const parsed = MemoryRequest.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues });
  }

  const { text, ingestionDate } = parsed.data;
  const id = `mem_${randomUUID().slice(0, 8)}`;
  const date = ingestionDate || new Date().toISOString();

  try {
    const extraction = await extractMemory(text, date);
    const memory = storeMemory(id, text, date, extraction, model);
    const entities = getEntitiesForMemory(id);
    const relationships = getRelationshipsForMemory(id);
    const regions = getRegionActivations(id);

    log.info("memory stored", { id, types: extraction.types.map(t => t.type) });
    res.status(201).json({ ...memory, entities, relationships, regions, extraction });
  } catch (error) {
    log.error("extraction failed", { id, error: error.message });
    res.status(502).json({ error: "Extraction failed", detail: error.message });
  }
});

// --- Memory Queries ---

app.get("/api/memories", (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const offset = parseInt(req.query.offset) || 0;
  const rows = getMemories({ limit, offset });
  const memories = rows.map((row) => {
    const extraction = db
      .prepare(
        "SELECT extraction_json FROM memory_extractions WHERE memory_id = ? ORDER BY created_at DESC LIMIT 1"
      )
      .get(row.id);
    return {
      ...row,
      extraction: extraction
        ? { extraction_json: JSON.parse(extraction.extraction_json) }
        : null,
      regions: getRegionActivations(row.id),
    };
  });
  res.json(memories);
});

app.get("/api/memories/:id", (req, res) => {
  const memory = getMemory(req.params.id);
  if (!memory) return res.status(404).json({ error: "Memory not found" });

  const extraction = getLatestExtraction(req.params.id);
  const entities = getEntitiesForMemory(req.params.id);
  const relationships = getRelationshipsForMemory(req.params.id);
  const regions = getRegionActivations(req.params.id);

  res.json({ ...memory, extraction, entities, relationships, regions });
});

app.delete("/api/memories", (req, res) => {
  deleteAllMemories();
  log.info("all memories deleted");
  res.json({ ok: true });
});

app.delete("/api/memories/:id", (req, res) => {
  const memory = getMemory(req.params.id);
  if (!memory) return res.status(404).json({ error: "Memory not found" });
  deleteMemory(req.params.id);
  log.info("memory deleted", { id: req.params.id });
  res.json({ ok: true });
});

app.patch("/api/memories/:id/summary", (req, res) => {
  const parsed = SummaryRequest.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues });
  }

  updateMemorySummary(req.params.id, parsed.data.summary);
  log.info("summary updated", { id: req.params.id });
  res.json({ ok: true });
});

// --- Entity Queries ---

app.get("/api/entities", (req, res) => {
  const q = req.query.q;
  if (!q) return res.status(400).json({ error: "q query param required" });
  res.json(findEntities(q));
});

app.get("/api/entities/:id/memories", (req, res) => {
  const memories = getMemoriesForEntity(parseInt(req.params.id));
  res.json(memories);
});

// --- Legacy extract endpoint ---

app.post("/api/extract", async (req, res) => {
  const parsed = MemoryRequest.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues });
  }

  const { text, ingestionDate } = parsed.data;

  try {
    const extraction = await extractMemory(text, ingestionDate || new Date().toISOString());
    res.json(extraction);
  } catch (error) {
    log.error("extraction failed (legacy)", { error: error.message });
    res.status(502).json({ error: "Extraction failed", detail: error.message });
  }
});

app.listen(PORT, () => {
  log.info("server started", { port: PORT, url: `http://localhost:${PORT}` });
});
