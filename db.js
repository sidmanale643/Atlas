import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  REGION_MAPPING_VERSION,
  mapExtractionToRegions,
} from "./region-mapper.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.ENGRAM_DB_PATH || join(__dirname, "engram.db");

let db;

export function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      raw_text TEXT NOT NULL,
      ingestion_date TEXT NOT NULL,
      summary TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS memory_extractions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id TEXT NOT NULL,
      extraction_json TEXT NOT NULL,
      model TEXT NOT NULL,
      schema_version INTEGER NOT NULL DEFAULT 1,
      authoritative INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      canonical_name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('person', 'place', 'object', 'concept', 'organization')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(canonical_name, kind)
    );

    CREATE TABLE IF NOT EXISTS memory_entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      mention TEXT NOT NULL,
      role TEXT,
      confidence REAL NOT NULL DEFAULT 1.0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
      FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE,
      UNIQUE(memory_id, entity_id, mention)
    );

    CREATE TABLE IF NOT EXISTS relationships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_entity_id INTEGER NOT NULL,
      target_entity_id INTEGER NOT NULL,
      predicate TEXT NOT NULL,
      memory_id TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1.0,
      evidence TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (source_entity_id) REFERENCES entities(id) ON DELETE CASCADE,
      FOREIGN KEY (target_entity_id) REFERENCES entities(id) ON DELETE CASCADE,
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
      UNIQUE(source_entity_id, target_entity_id, predicate, memory_id)
    );

    CREATE TABLE IF NOT EXISTS region_activations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id TEXT NOT NULL,
      region TEXT NOT NULL,
      weight REAL NOT NULL,
      mapping_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
      UNIQUE(memory_id, region, mapping_version)
    );

    CREATE INDEX IF NOT EXISTS idx_extractions_memory ON memory_extractions(memory_id);
    CREATE INDEX IF NOT EXISTS idx_entities_kind ON entities(kind);
    CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(canonical_name);
    CREATE INDEX IF NOT EXISTS idx_memory_entities_memory ON memory_entities(memory_id);
    CREATE INDEX IF NOT EXISTS idx_memory_entities_entity ON memory_entities(entity_id);
    CREATE INDEX IF NOT EXISTS idx_relationships_source ON relationships(source_entity_id);
    CREATE INDEX IF NOT EXISTS idx_relationships_target ON relationships(target_entity_id);
    CREATE INDEX IF NOT EXISTS idx_relationships_memory ON relationships(memory_id);
    CREATE INDEX IF NOT EXISTS idx_region_activations_memory ON region_activations(memory_id);
  `);
}

// --- Memory CRUD ---

export function createMemory(id, rawText, ingestionDate, summary = null) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO memories (id, raw_text, ingestion_date, summary)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(id, rawText, ingestionDate, summary);
  return getMemory(id);
}

export function getMemory(id) {
  const db = getDb();
  return db.prepare("SELECT * FROM memories WHERE id = ?").get(id);
}

export function getMemories({ limit = 100, offset = 0 } = {}) {
  const db = getDb();
  return db
    .prepare("SELECT * FROM memories ORDER BY created_at DESC LIMIT ? OFFSET ?")
    .all(limit, offset);
}

export function updateMemorySummary(id, summary) {
  const db = getDb();
  db.prepare(`
    UPDATE memories SET summary = ?, updated_at = datetime('now') WHERE id = ?
  `).run(summary, id);
}

// --- Extraction CRUD ---

export function saveExtraction(memoryId, extractionJson, model) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO memory_extractions (memory_id, extraction_json, model)
    VALUES (?, ?, ?)
  `);
  const result = stmt.run(memoryId, JSON.stringify(extractionJson), model);
  return result.lastInsertRowid;
}

export function getExtractions(memoryId) {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT * FROM memory_extractions WHERE memory_id = ? ORDER BY created_at DESC"
    )
    .all(memoryId);
  return rows.map((r) => ({ ...r, extraction_json: JSON.parse(r.extraction_json) }));
}

export function getLatestExtraction(memoryId) {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT * FROM memory_extractions WHERE memory_id = ? ORDER BY created_at DESC LIMIT 1"
    )
    .get(memoryId);
  if (!row) return null;
  return { ...row, extraction_json: JSON.parse(row.extraction_json) };
}

export function setExtractionAuthoritative(id) {
  const db = getDb();
  db.prepare("UPDATE memory_extractions SET authoritative = 1 WHERE id = ?").run(id);
}

// --- Entity CRUD ---

export function upsertEntity(canonicalName, kind) {
  const db = getDb();
  const existing = db
    .prepare("SELECT id FROM entities WHERE canonical_name = ? AND kind = ?")
    .get(canonicalName, kind);
  if (existing) return existing.id;

  const result = db
    .prepare("INSERT INTO entities (canonical_name, kind) VALUES (?, ?)")
    .run(canonicalName, kind);
  return result.lastInsertRowid;
}

export function getEntity(id) {
  const db = getDb();
  return db.prepare("SELECT * FROM entities WHERE id = ?").get(id);
}

export function findEntities(query) {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM entities WHERE canonical_name LIKE ? ORDER BY canonical_name"
    )
    .all(`%${query}%`);
}

// --- Memory-Entity Links ---

export function linkMemoryToEntity(memoryId, entityId, mention, role = null, confidence = 1.0) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO memory_entities (memory_id, entity_id, mention, role, confidence)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(memoryId, entityId, mention, role, confidence);
}

export function getEntitiesForMemory(memoryId) {
  const db = getDb();
  return db
    .prepare(
      `SELECT e.*, me.mention, me.role, me.confidence
       FROM memory_entities me
       JOIN entities e ON e.id = me.entity_id
       WHERE me.memory_id = ?`
    )
    .all(memoryId);
}

export function getMemoriesForEntity(entityId) {
  const db = getDb();
  return db
    .prepare(
      `SELECT m.*, me.mention, me.role, me.confidence
       FROM memory_entities me
       JOIN memories m ON m.id = me.memory_id
       WHERE me.entity_id = ?`
    )
    .all(entityId);
}

// --- Relationships ---

export function addRelationship(sourceEntityId, targetEntityId, predicate, memoryId, confidence = 1.0, evidence = null) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO relationships (source_entity_id, target_entity_id, predicate, memory_id, confidence, evidence)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(sourceEntityId, targetEntityId, predicate, memoryId, confidence, evidence);
}

export function getRelationshipsForMemory(memoryId) {
  const db = getDb();
  return db
    .prepare(
      `SELECT r.*,
              se.canonical_name AS source_name, se.kind AS source_kind,
              te.canonical_name AS target_name, te.kind AS target_kind
       FROM relationships r
       JOIN entities se ON se.id = r.source_entity_id
       JOIN entities te ON te.id = r.target_entity_id
       WHERE r.memory_id = ?`
    )
    .all(memoryId);
}

export function getRelationshipsForEntity(entityId) {
  const db = getDb();
  return db
    .prepare(
      `SELECT r.*,
              se.canonical_name AS source_name, se.kind AS source_kind,
              te.canonical_name AS target_name, te.kind AS target_kind
       FROM relationships r
       JOIN entities se ON se.id = r.source_entity_id
       JOIN entities te ON te.id = r.target_entity_id
       WHERE r.source_entity_id = ? OR r.target_entity_id = ?`
    )
    .all(entityId, entityId);
}

// --- Region Activations ---

export function saveRegionActivations(
  memoryId,
  activations,
  mappingVersion = REGION_MAPPING_VERSION
) {
  const db = getDb();
  const remove = db.prepare(
    "DELETE FROM region_activations WHERE memory_id = ? AND mapping_version = ?"
  );
  const stmt = db.prepare(`
    INSERT INTO region_activations (memory_id, region, weight, mapping_version)
    VALUES (?, ?, ?, ?)
  `);
  const insert = db.transaction((items) => {
    remove.run(memoryId, mappingVersion);
    for (const { region, weight } of items) {
      stmt.run(memoryId, region, weight, mappingVersion);
    }
  });
  insert(activations);
}

export function getRegionActivations(
  memoryId,
  mappingVersion = REGION_MAPPING_VERSION
) {
  const db = getDb();
  return db
    .prepare(
      `SELECT region, weight, mapping_version
       FROM region_activations
       WHERE memory_id = ? AND mapping_version = ?
       ORDER BY weight DESC, region ASC`
    )
    .all(memoryId, mappingVersion);
}

export function backfillRegionActivations() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT m.id, e.extraction_json
       FROM memories m
       JOIN memory_extractions e ON e.id = (
         SELECT latest.id
         FROM memory_extractions latest
         WHERE latest.memory_id = m.id
         ORDER BY latest.created_at DESC, latest.id DESC
         LIMIT 1
       )
       WHERE NOT EXISTS (
         SELECT 1
         FROM region_activations ra
         WHERE ra.memory_id = m.id AND ra.mapping_version = ?
       )`
    )
    .all(REGION_MAPPING_VERSION);

  const backfill = db.transaction(() => {
    for (const row of rows) {
      const extraction = JSON.parse(row.extraction_json);
      saveRegionActivations(
        row.id,
        mapExtractionToRegions(extraction),
        REGION_MAPPING_VERSION
      );
    }
  });
  backfill();

  return rows.length;
}

// --- Full pipeline: extract + store ---

export function storeMemory(id, rawText, ingestionDate, extraction, model) {
  const db = getDb();
  const storeAll = db.transaction(() => {
    createMemory(id, rawText, ingestionDate, extraction.summary);
    saveExtraction(id, extraction, model);
    saveRegionActivations(
      id,
      mapExtractionToRegions(extraction),
      REGION_MAPPING_VERSION
    );

    const entityIds = new Map();
    for (const ent of extraction.entities || []) {
      const name = ent.canonicalName || ent.mention;
      const entityId = upsertEntity(name, ent.kind);
      entityIds.set(name, entityId);
      linkMemoryToEntity(id, entityId, ent.mention, null, ent.confidence);
    }

    for (const rel of extraction.relationships || []) {
      const srcName = rel.subject === "self" ? rel.subject : rel.subject;
      const tgtName = rel.object;
      const srcId = entityIds.get(srcName) || upsertEntity(srcName, "concept");
      const tgtId = entityIds.get(tgtName) || upsertEntity(tgtName, "concept");
      addRelationship(srcId, tgtId, rel.predicate, id, rel.confidence, rel.evidence);
    }

    return getMemory(id);
  });

  return storeAll();
}

// --- Delete ---

export function deleteAllMemories() {
  const db = getDb();
  db.exec("DELETE FROM memories");
}

export function deleteMemory(id) {
  const db = getDb();
  db.prepare("DELETE FROM memories WHERE id = ?").run(id);
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
