import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  REGION_MAPPING_VERSION,
  mapExtractionToRegions,
} from "./shared/region-mapper.js";
import { EXTRACTION_SCHEMA_VERSION } from "./schemas.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.ENGRAM_DB_PATH || join(__dirname, "..", "engram.db");

// Canonical first-person identity. Neurogram is a single-user system, so every
// first-person reference (self/user/I/owner) collapses to one person entity.
// This gives relationship subjects a stable anchor (e.g. "User → Python:
// works with") instead of fragmenting across "self"/"user"/"I" nodes. The
// display name is configurable via NEUROGRAM_USER_NAME.
const USER_ENTITY_NAME = (process.env.NEUROGRAM_USER_NAME || "User").trim() || "User";
const FIRST_PERSON_KEYS = new Set([
  normalizeEntityKey(USER_ENTITY_NAME),
  "user",
  "self",
  "i",
  "me",
  "myself",
  "mine",
  "owner",
  "operator",
  lowercaseEnvList("NEUROGRAM_USER_ALIASES"),
].flat().filter(Boolean));

function lowercaseEnvList(name) {
  const raw = process.env[name];
  if (!raw) return [];
  return raw.split(",").map((token) => normalizeEntityKey(token)).filter(Boolean);
}

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
      type TEXT NOT NULL DEFAULT 'fact',
      title TEXT NOT NULL DEFAULT '',
      confidence REAL NOT NULL DEFAULT 0.6,
      tags TEXT NOT NULL DEFAULT '[]',
      scope TEXT NOT NULL DEFAULT 'agent',
      source TEXT NOT NULL DEFAULT 'ui',
      owner_hash TEXT,
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

    CREATE TABLE IF NOT EXISTS entity_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id INTEGER NOT NULL,
      alias TEXT NOT NULL,
      normalized_alias TEXT NOT NULL,
      canonical INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE,
      UNIQUE(entity_id, normalized_alias)
    );

    CREATE TABLE IF NOT EXISTS entity_resolution_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_entity_id INTEGER NOT NULL,
      target_entity_id INTEGER NOT NULL,
      source_name TEXT NOT NULL,
      target_name TEXT NOT NULL,
      kind TEXT NOT NULL,
      observed_alias TEXT NOT NULL,
      normalized_alias TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'merged', 'rejected')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT,
      CHECK (source_entity_id <> target_entity_id),
      UNIQUE(source_entity_id, target_entity_id)
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
      left_weight REAL,
      right_weight REAL,
      mapping_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
      UNIQUE(memory_id, region, mapping_version)
    );

    CREATE TABLE IF NOT EXISTS memory_comparisons (
      left_memory_id TEXT NOT NULL,
      right_memory_id TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      model TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      comparison_json TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      PRIMARY KEY (
        left_memory_id,
        right_memory_id,
        input_hash,
        model,
        schema_version
      ),
      FOREIGN KEY (left_memory_id) REFERENCES memories(id) ON DELETE CASCADE,
      FOREIGN KEY (right_memory_id) REFERENCES memories(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS memory_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id TEXT NOT NULL,
      revision_number INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
      UNIQUE(memory_id, revision_number)
    );

    CREATE TABLE IF NOT EXISTS memory_sources (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('ui', 'mcp', 'cli', 'import')),
      ingestion_date TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      extraction_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (extraction_status IN ('pending', 'processing', 'completed', 'failed')),
      extraction_attempts INTEGER NOT NULL DEFAULT 0,
      extraction_error TEXT,
      extraction_model TEXT,
      extraction_schema_version INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS source_revisions (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      text TEXT NOT NULL,
      author TEXT,
      reason TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (source_id) REFERENCES memory_sources(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS source_memory_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL,
      source_revision_id TEXT,
      memory_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'unchanged')),
      evidence_json TEXT NOT NULL,
      extraction_model TEXT,
      extraction_schema_version INTEGER NOT NULL,
      decision_confidence REAL NOT NULL,
      decision_reason TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (source_id) REFERENCES memory_sources(id) ON DELETE CASCADE,
      FOREIGN KEY (source_revision_id) REFERENCES source_revisions(id) ON DELETE SET NULL,
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cognitive_annotations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id TEXT NOT NULL,
      memory_version INTEGER NOT NULL,
      annotation_json TEXT NOT NULL,
      model TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
      UNIQUE(memory_id, memory_version, schema_version)
    );

    CREATE TABLE IF NOT EXISTS annotation_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id TEXT NOT NULL,
      source_id TEXT,
      memory_version INTEGER NOT NULL,
      model TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      available_at TEXT NOT NULL,
      claimed_at TEXT,
      completed_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
      FOREIGN KEY (source_id) REFERENCES memory_sources(id) ON DELETE SET NULL,
      UNIQUE(memory_id, memory_version, schema_version)
    );

    CREATE TABLE IF NOT EXISTS vector_index_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id TEXT NOT NULL,
      source_id TEXT,
      memory_version INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 8,
      available_at TEXT NOT NULL,
      claimed_at TEXT,
      completed_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
      FOREIGN KEY (source_id) REFERENCES memory_sources(id) ON DELETE SET NULL,
      UNIQUE(memory_id, memory_version)
    );

    CREATE TABLE IF NOT EXISTS ingestion_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      available_at TEXT NOT NULL,
      claimed_at TEXT,
      completed_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (source_id) REFERENCES memory_sources(id) ON DELETE CASCADE,
      UNIQUE(source_id)
    );

    CREATE TABLE IF NOT EXISTS memory_ip_quotas (
      ip_hash TEXT PRIMARY KEY,
      submission_count INTEGER NOT NULL DEFAULT 0 CHECK (submission_count >= 0),
      locked_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_extractions_memory ON memory_extractions(memory_id);
    CREATE INDEX IF NOT EXISTS idx_extractions_memory_latest
      ON memory_extractions(memory_id, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_entities_kind ON entities(kind);
    CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(canonical_name);
    CREATE INDEX IF NOT EXISTS idx_entity_aliases_entity
      ON entity_aliases(entity_id);
    CREATE INDEX IF NOT EXISTS idx_entity_aliases_normalized
      ON entity_aliases(normalized_alias);
    CREATE INDEX IF NOT EXISTS idx_entity_resolution_status
      ON entity_resolution_suggestions(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_memory_entities_memory ON memory_entities(memory_id);
    CREATE INDEX IF NOT EXISTS idx_memory_entities_entity ON memory_entities(entity_id);
    CREATE INDEX IF NOT EXISTS idx_relationships_source ON relationships(source_entity_id);
    CREATE INDEX IF NOT EXISTS idx_relationships_target ON relationships(target_entity_id);
    CREATE INDEX IF NOT EXISTS idx_relationships_memory ON relationships(memory_id);
    CREATE INDEX IF NOT EXISTS idx_region_activations_memory ON region_activations(memory_id);
    CREATE INDEX IF NOT EXISTS idx_memory_comparisons_left ON memory_comparisons(left_memory_id);
    CREATE INDEX IF NOT EXISTS idx_memory_comparisons_right ON memory_comparisons(right_memory_id);
    CREATE INDEX IF NOT EXISTS idx_memory_revisions_memory
      ON memory_revisions(memory_id, revision_number DESC);
    CREATE INDEX IF NOT EXISTS idx_sources_status
      ON memory_sources(extraction_status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_source_revisions_source
      ON source_revisions(source_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_source_links_source
      ON source_memory_links(source_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_source_links_memory
      ON source_memory_links(memory_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_annotation_jobs_claim
      ON annotation_jobs(status, available_at, id);
    CREATE INDEX IF NOT EXISTS idx_vector_jobs_claim
      ON vector_index_jobs(status, available_at, id);
    CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_claim
      ON ingestion_jobs(status, available_at, id);
  `);

  const memoryColumns = db.prepare("PRAGMA table_info(memories)").all();
  const memoryMigrations = [
    ["source", "TEXT NOT NULL DEFAULT 'ui'"],
    ["type", "TEXT NOT NULL DEFAULT 'fact'"],
    ["title", "TEXT NOT NULL DEFAULT ''"],
    ["confidence", "REAL NOT NULL DEFAULT 0.6"],
    ["tags", "TEXT NOT NULL DEFAULT '[]'"],
    ["scope", "TEXT NOT NULL DEFAULT 'agent'"],
    ["version", "INTEGER NOT NULL DEFAULT 1"],
    ["owner_hash", "TEXT"],
  ];
  for (const [name, definition] of memoryMigrations) {
    if (!memoryColumns.some((column) => column.name === name)) {
      db.exec(`ALTER TABLE memories ADD COLUMN ${name} ${definition}`);
    }
  }
  db.exec(`
    UPDATE memories
    SET title = substr(raw_text, 1, 50)
    WHERE title = ''
  `);

  const regionActivationColumns = db
    .prepare("PRAGMA table_info(region_activations)")
    .all();
  if (!regionActivationColumns.some((column) => column.name === "left_weight")) {
    db.exec("ALTER TABLE region_activations ADD COLUMN left_weight REAL");
  }
  if (!regionActivationColumns.some((column) => column.name === "right_weight")) {
    db.exec("ALTER TABLE region_activations ADD COLUMN right_weight REAL");
  }

  migrateSourceTables();

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memories_source ON memories(source);
  `);

  mergeDuplicateEntities();
  backfillCanonicalEntityAliases();
  backfillLegacySources();

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      memory_id UNINDEXED,
      title,
      summary,
      raw_text,
      tags,
      tokenize='porter unicode61'
    );
  `);
  syncMemoriesToFts();
}

function addMissingColumns(table, columns) {
  const existingColumns = db.prepare(`PRAGMA table_info(${table})`).all();
  for (const [name, definition] of columns) {
    if (!existingColumns.some((column) => column.name === name)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    }
  }
}

function hasColumn(table, columnName) {
  return db.prepare(`PRAGMA table_info(${table})`).all()
    .some((column) => column.name === columnName);
}

function migrateSourceTables() {
  addMissingColumns("memory_sources", [
    ["text", "TEXT NOT NULL DEFAULT ''"],
    ["source", "TEXT NOT NULL DEFAULT 'import'"],
    ["ingestion_date", "TEXT NOT NULL DEFAULT ''"],
    ["extraction_error", "TEXT"],
    ["extraction_model", "TEXT"],
    ["extraction_schema_version", "INTEGER"],
  ]);
  addMissingColumns("source_revisions", [
    ["text", "TEXT NOT NULL DEFAULT ''"],
    ["author", "TEXT"],
  ]);
  addMissingColumns("source_memory_links", [
    ["extraction_model", "TEXT"],
    ["extraction_schema_version", "INTEGER NOT NULL DEFAULT 1"],
    ["decision_confidence", "REAL NOT NULL DEFAULT 0"],
    ["decision_reason", "TEXT NOT NULL DEFAULT ''"],
  ]);
  migrateAnnotationJobs();
}

function migrateAnnotationJobs() {
  const columns = db.prepare("PRAGMA table_info(annotation_jobs)").all();
  const currentColumns = ["source_id", "memory_version", "available_at"];
  if (currentColumns.every((name) =>
    columns.some((column) => column.name === name))) {
    return;
  }

  db.exec(`
    DROP INDEX IF EXISTS idx_annotation_jobs_claim;
    DROP INDEX IF EXISTS idx_annotation_jobs_memory;
    ALTER TABLE annotation_jobs RENAME TO annotation_jobs_legacy;

    CREATE TABLE annotation_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id TEXT NOT NULL,
      source_id TEXT,
      memory_version INTEGER NOT NULL,
      model TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      available_at TEXT NOT NULL,
      claimed_at TEXT,
      completed_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
      FOREIGN KEY (source_id) REFERENCES memory_sources(id) ON DELETE SET NULL,
      UNIQUE(memory_id, memory_version, schema_version)
    );

    INSERT OR IGNORE INTO annotation_jobs (
      memory_id, source_id, memory_version, model, schema_version, status,
      attempts, max_attempts, available_at, claimed_at, completed_at,
      last_error, created_at, updated_at
    )
    SELECT
      legacy.memory_id,
      NULL,
      COALESCE(memory.version, 1),
      legacy.model,
      legacy.schema_version,
      CASE legacy.status WHEN 'retry' THEN 'pending' ELSE legacy.status END,
      legacy.attempts,
      legacy.max_attempts,
      COALESCE(legacy.retry_at, legacy.created_at),
      legacy.claimed_at,
      legacy.completed_at,
      legacy.last_error,
      legacy.created_at,
      legacy.updated_at
    FROM annotation_jobs_legacy AS legacy
    JOIN memories AS memory ON memory.id = legacy.memory_id
    ORDER BY legacy.created_at, legacy.id;

    DROP TABLE annotation_jobs_legacy;
    CREATE INDEX idx_annotation_jobs_claim
      ON annotation_jobs(status, available_at, id);
    CREATE INDEX idx_annotation_jobs_memory
      ON annotation_jobs(memory_id, created_at DESC);
  `);
}

export function withTransaction(callback) {
  return getDb().transaction(callback)();
}

export function getIpMemoryQuota(ipHash, limit = 10) {
  const row = getDb().prepare(`
    SELECT submission_count FROM memory_ip_quotas WHERE ip_hash = ?
  `).get(ipHash);
  return formatIpMemoryQuota(row?.submission_count || 0, limit);
}

export function claimIpMemoryQuota(ipHash, limit = 10) {
  const database = getDb();
  return database.transaction(() => {
    const now = new Date().toISOString();
    database.prepare(`
      INSERT OR IGNORE INTO memory_ip_quotas (
        ip_hash, submission_count, created_at, updated_at
      ) VALUES (?, 0, ?, ?)
    `).run(ipHash, now, now);
    const result = database.prepare(`
      UPDATE memory_ip_quotas
      SET submission_count = submission_count + 1,
          locked_at = CASE
            WHEN submission_count + 1 >= ? THEN COALESCE(locked_at, ?)
            ELSE locked_at
          END,
          updated_at = ?
      WHERE ip_hash = ? AND submission_count < ?
    `).run(limit, now, now, ipHash, limit);
    const quota = getIpMemoryQuota(ipHash, limit);
    return { allowed: result.changes === 1, ...quota };
  })();
}

function formatIpMemoryQuota(used, limit) {
  const normalizedUsed = Math.max(0, Number(used) || 0);
  return {
    limit,
    used: normalizedUsed,
    remaining: Math.max(0, limit - normalizedUsed),
    reached: normalizedUsed >= limit,
  };
}

// --- Immutable sources and durable work queues ---

export function createMemorySource({ id, text, source = "ui", ingestionDate, metadata = {} }) {
  const now = new Date().toISOString();
  const database = getDb();
  if (hasColumn("memory_sources", "content")) {
    database.prepare(`
      INSERT INTO memory_sources (
        id, text, content, source, ingestion_date, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, text, text, source, ingestionDate, JSON.stringify(metadata), now, now);
  } else {
    database.prepare(`
      INSERT INTO memory_sources (
        id, text, source, ingestion_date, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, text, source, ingestionDate, JSON.stringify(metadata), now, now);
  }
  return getMemorySource(id);
}

export function getMemorySource(id, { includeRevisions = false } = {}) {
  const database = getDb();
  const row = database.prepare("SELECT * FROM memory_sources WHERE id = ?").get(id);
  if (!row) return null;
  const result = { ...row, metadata_json: parseJson(row.metadata_json, {}) };
  if (includeRevisions) {
    result.revisions = database.prepare(`
      SELECT * FROM source_revisions
      WHERE source_id = ? ORDER BY created_at DESC, id DESC
    `).all(id).map((revision) => ({
      ...revision,
      metadata_json: parseJson(revision.metadata_json, {}),
    }));
  }
  return result;
}

export function createSourceRevision({
  id, sourceId, text, author = null, reason = null, metadata = {},
}) {
  const createdAt = new Date().toISOString();
  const database = getDb();
  if (hasColumn("source_revisions", "content")) {
    const revisionNumber = database.prepare(`
      SELECT COALESCE(MAX(revision_number), 0) + 1 AS value
      FROM source_revisions WHERE source_id = ?
    `).get(sourceId).value;
    database.prepare(`
      INSERT INTO source_revisions (
        id, source_id, text, content, revision_number, author, reason,
        metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, sourceId, text, text, revisionNumber, author, reason,
      JSON.stringify(metadata), createdAt);
  } else {
    database.prepare(`
      INSERT INTO source_revisions (
        id, source_id, text, author, reason, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, sourceId, text, author, reason, JSON.stringify(metadata), createdAt);
  }
  return database.prepare("SELECT * FROM source_revisions WHERE id = ?").get(id);
}

export function updateMemorySourceStatus(id, status, {
  incrementAttempts = false,
  error = null,
  model = null,
  schemaVersion = null,
} = {}) {
  const normalizedStatus = normalizeSourceStatus(status);
  const updatedAt = new Date().toISOString();
  getDb().prepare(`
    UPDATE memory_sources
    SET extraction_status = ?, extraction_attempts = extraction_attempts + ?,
        extraction_error = ?, extraction_model = COALESCE(?, extraction_model),
        extraction_schema_version = COALESCE(?, extraction_schema_version),
        updated_at = ?
    WHERE id = ?
  `).run(normalizedStatus, incrementAttempts ? 1 : 0, error, model,
    schemaVersion, updatedAt, id);
  return getMemorySource(id);
}

function normalizeSourceStatus(status) {
  if (status !== "failed" && status !== "extraction_failed") return status;
  const tableSql = getDb().prepare(`
    SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'memory_sources'
  `).get()?.sql || "";
  return tableSql.includes("'extraction_failed'") ? "extraction_failed" : "failed";
}

export function linkSourceMemory({
  sourceId, sourceRevisionId = null, memoryId, action, evidence,
  model = null, schemaVersion = EXTRACTION_SCHEMA_VERSION,
  confidence = 0, reason = "",
}) {
  const result = getDb().prepare(`
    INSERT INTO source_memory_links (
      source_id, source_revision_id, memory_id, action, evidence_json,
      extraction_model, extraction_schema_version, decision_confidence,
      decision_reason, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(sourceId, sourceRevisionId, memoryId, action,
    JSON.stringify(evidence || []), model, schemaVersion, confidence, reason,
    new Date().toISOString());
  return result.lastInsertRowid;
}

export function getSourceMemoryLinks(sourceId) {
  return getDb().prepare(`
    SELECT * FROM source_memory_links WHERE source_id = ? ORDER BY id ASC
  `).all(sourceId).map((row) => ({
    ...row,
    evidence_json: parseJson(row.evidence_json, []),
  }));
}

function memoryVersion(memoryId) {
  const memory = getDb().prepare("SELECT version FROM memories WHERE id = ?").get(memoryId);
  if (!memory) throw new Error(`Memory not found: ${memoryId}`);
  return memory.version;
}

export function enqueueAnnotationJob({ memoryId, sourceId = null, model, schemaVersion }) {
  const now = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO annotation_jobs (
      memory_id, source_id, memory_version, model, schema_version,
      available_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(memory_id, memory_version, schema_version) DO NOTHING
  `).run(memoryId, sourceId, memoryVersion(memoryId), model, schemaVersion,
    now, now, now);
}

export function enqueueVectorIndexJob({ memoryId, sourceId = null }) {
  const now = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO vector_index_jobs (
      memory_id, source_id, memory_version, available_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(memory_id, memory_version) DO NOTHING
  `).run(memoryId, sourceId, memoryVersion(memoryId), now, now, now);
}

export function enqueueIngestionJob({ sourceId }) {
  const now = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO ingestion_jobs (
      source_id, available_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?)
    ON CONFLICT(source_id) DO NOTHING
  `).run(sourceId, now, now, now);
}

export function getIngestionStatus(sourceId) {
  return getDb().prepare(`
    SELECT status FROM ingestion_jobs WHERE source_id = ?
    ORDER BY id DESC LIMIT 1
  `).get(sourceId)?.status ?? null;
}

export function getAnnotationStatus(memoryId) {
  return getDb().prepare(`
    SELECT status FROM annotation_jobs WHERE memory_id = ?
    ORDER BY memory_version DESC, id DESC LIMIT 1
  `).get(memoryId)?.status ?? null;
}

export function getVectorIndexStatus(memoryId) {
  return getDb().prepare(`
    SELECT status FROM vector_index_jobs WHERE memory_id = ?
    ORDER BY memory_version DESC, id DESC LIMIT 1
  `).get(memoryId)?.status ?? null;
}

function claimJob(table, now) {
  const database = getDb();
  return database.transaction(() => {
    const job = database.prepare(`
      SELECT * FROM ${table} WHERE status = 'pending' AND available_at <= ?
      ORDER BY available_at ASC, id ASC LIMIT 1
    `).get(now);
    if (!job) return null;
    database.prepare(`
      UPDATE ${table} SET status = 'processing', attempts = attempts + 1,
        claimed_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'
    `).run(now, now, job.id);
    return database.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(job.id);
  })();
}

export function claimAnnotationJob({ now = new Date().toISOString() } = {}) {
  return claimJob("annotation_jobs", now);
}

export function claimVectorIndexJob({ now = new Date().toISOString() } = {}) {
  return claimJob("vector_index_jobs", now);
}

export function claimIngestionJob({ now = new Date().toISOString() } = {}) {
  return claimJob("ingestion_jobs", now);
}

function recoverJobs(table, { now, retryAt = now, staleBefore }) {
  return getDb().prepare(`
    UPDATE ${table} SET status = 'pending', available_at = ?, claimed_at = NULL,
      updated_at = ? WHERE status = 'processing' AND claimed_at < ?
  `).run(retryAt, now, staleBefore).changes;
}

export function recoverAnnotationJobs(options) {
  return recoverJobs("annotation_jobs", options);
}

export function recoverVectorIndexJobs(options) {
  return recoverJobs("vector_index_jobs", options);
}

export function recoverIngestionJobs(options) {
  return recoverJobs("ingestion_jobs", options);
}

function retryJob(table, { jobId, error, retryAt, terminal = false, updatedAt }) {
  getDb().prepare(`
    UPDATE ${table} SET status = ?, available_at = ?, claimed_at = NULL,
      last_error = ?, updated_at = ? WHERE id = ?
  `).run(terminal ? "failed" : "pending", retryAt, error, updatedAt, jobId);
}

export function retryAnnotationJob(options) {
  return retryJob("annotation_jobs", options);
}

export function retryVectorIndexJob(options) {
  return retryJob("vector_index_jobs", options);
}

export function retryIngestionJob(options) {
  return retryJob("ingestion_jobs", options);
}

function completeJob(table, jobId, completedAt) {
  getDb().prepare(`
    UPDATE ${table} SET status = 'completed', completed_at = ?, claimed_at = NULL,
      last_error = NULL, updated_at = ? WHERE id = ?
  `).run(completedAt, completedAt, jobId);
}

export function completeAnnotationJob({ jobId, completedAt }) {
  return completeJob("annotation_jobs", jobId, completedAt);
}

export function completeVectorIndexJob({ jobId, completedAt }) {
  return completeJob("vector_index_jobs", jobId, completedAt);
}

export function completeIngestionJob({ jobId, completedAt }) {
  return completeJob("ingestion_jobs", jobId, completedAt);
}

function failJob(table, jobId, { error, failedAt }) {
  getDb().prepare(`
    UPDATE ${table} SET status = 'failed', last_error = ?, claimed_at = NULL,
      updated_at = ? WHERE id = ?
  `).run(error, failedAt, jobId);
}

export function failAnnotationJob(jobId, options) {
  return failJob("annotation_jobs", jobId, options);
}

export function failVectorIndexJob(jobId, options) {
  return failJob("vector_index_jobs", jobId, options);
}

export function failIngestionJob(jobId, options) {
  return failJob("ingestion_jobs", jobId, options);
}

export function saveCognitiveAnnotation({ memoryId, annotation, model, schemaVersion }) {
  const database = getDb();
  database.prepare(`
    INSERT INTO cognitive_annotations (
      memory_id, memory_version, annotation_json, model, schema_version, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(memory_id, memory_version, schema_version) DO UPDATE SET
      annotation_json = excluded.annotation_json, model = excluded.model,
      created_at = excluded.created_at
  `).run(memoryId, memoryVersion(memoryId), JSON.stringify(annotation), model,
    schemaVersion, new Date().toISOString());
}

export function completeCognitiveAnnotation({
  memoryId,
  annotation,
  activations,
  mappingVersion,
  model,
  schemaVersion,
  jobId,
  completedAt,
}) {
  return getDb().transaction(() => {
    saveCognitiveAnnotation({ memoryId, annotation, model, schemaVersion });
    saveRegionActivations(memoryId, activations, mappingVersion);
    completeAnnotationJob({ jobId, completedAt });
  })();
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function backfillLegacySources() {
  const database = getDb();
  const rows = database.prepare(`
    SELECT m.id, m.raw_text, m.source, m.ingestion_date, m.created_at,
      e.model, e.schema_version
    FROM memories m
    LEFT JOIN memory_extractions e ON e.id = (
      SELECT latest.id FROM memory_extractions latest
      WHERE latest.memory_id = m.id ORDER BY latest.id DESC LIMIT 1
    )
    WHERE NOT EXISTS (
      SELECT 1 FROM source_memory_links link WHERE link.memory_id = m.id
    )
  `).all();
  const migrate = database.transaction(() => {
    for (const row of rows) {
      const sourceId = `legacy:${row.id}`;
      if (hasColumn("memory_sources", "content")) {
        database.prepare(`
          INSERT OR IGNORE INTO memory_sources (
            id, text, content, source, ingestion_date, extraction_status,
            extraction_attempts, extraction_model, extraction_schema_version,
            created_at, updated_at
          ) VALUES (?, ?, ?, 'import', ?, 'completed', 0, ?, ?, ?, ?)
        `).run(sourceId, row.raw_text, row.raw_text, row.ingestion_date,
          row.model || "legacy", row.schema_version || 1, row.created_at, row.created_at);
      } else {
        database.prepare(`
          INSERT OR IGNORE INTO memory_sources (
            id, text, source, ingestion_date, extraction_status,
            extraction_attempts, extraction_model, extraction_schema_version,
            created_at, updated_at
          ) VALUES (?, ?, 'import', ?, 'completed', 0, ?, ?, ?, ?)
        `).run(sourceId, row.raw_text, row.ingestion_date, row.model || "legacy",
          row.schema_version || 1, row.created_at, row.created_at);
      }
      database.prepare(`
        INSERT INTO source_memory_links (
          source_id, memory_id, action, evidence_json, extraction_model,
          extraction_schema_version, decision_confidence, decision_reason, created_at
        ) VALUES (?, ?, 'created', ?, ?, ?, 1, 'Synthetic legacy provenance', ?)
      `).run(sourceId, row.id, JSON.stringify([{
        start: 0,
        end: row.raw_text.length,
        text: row.raw_text,
      }]), row.model || "legacy", row.schema_version || 1, row.created_at);
    }
  });
  migrate();
  return rows.length;
}

// --- Memory CRUD ---

export function createMemory(
  id,
  rawText,
  ingestionDate,
  summary = null,
  source = "ui",
  metadata = {},
) {
  const db = getDb();
  const now = new Date().toISOString();
  const title = metadata.title || String(rawText).slice(0, 50);
  const tags = Array.isArray(metadata.tags) ? metadata.tags : [];
  const stmt = db.prepare(`
    INSERT INTO memories (
      id,
      raw_text,
      ingestion_date,
      summary,
      type,
      title,
      confidence,
      tags,
      scope,
      source,
      owner_hash,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'agent', ?, ?, ?, ?)
  `);
  stmt.run(
    id,
    rawText,
    ingestionDate,
    summary,
    metadata.type || "fact",
    title,
    metadata.confidence ?? 0.6,
    JSON.stringify(tags),
    source,
    metadata.ownerHash || null,
    now,
    now,
  );
  syncFtsForMemory(id);
  return getMemory(id);
}

export function getMemory(id, { ownerHash } = {}) {
  const db = getDb();
  if (ownerHash) {
    return deserializeMemory(
      db.prepare("SELECT * FROM memories WHERE id = ? AND owner_hash = ?").get(id, ownerHash),
    );
  }
  return deserializeMemory(
    db.prepare("SELECT * FROM memories WHERE id = ?").get(id),
  );
}

export function getMemoriesByIds(ids, { ownerHash } = {}) {
  if (!ids.length) return [];
  const db = getDb();
  const placeholders = ids.map(() => "?").join(",");
  const ownerClause = ownerHash ? " AND owner_hash = ?" : "";
  return db
    .prepare(`SELECT * FROM memories WHERE id IN (${placeholders})${ownerClause}`)
    .all(...ids, ...(ownerHash ? [ownerHash] : []))
    .map(deserializeMemory);
}

export function getMemories({ limit = 100, offset = 0, source, ownerHash } = {}) {
  const db = getDb();
  if (ownerHash) {
    const sourceClause = source ? " AND source = ?" : "";
    return db
      .prepare(`SELECT * FROM memories WHERE owner_hash = ?${sourceClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(ownerHash, ...(source ? [source] : []), limit, offset)
      .map(deserializeMemory);
  }
  if (source) {
    return db
      .prepare("SELECT * FROM memories WHERE source = ? ORDER BY created_at DESC LIMIT ? OFFSET ?")
      .all(source, limit, offset)
      .map(deserializeMemory);
  }
  return db
    .prepare("SELECT * FROM memories ORDER BY created_at DESC LIMIT ? OFFSET ?")
    .all(limit, offset)
    .map(deserializeMemory);
}

const MEMORY_CATALOG_SORTS = Object.freeze({
  title: "m.title",
  type: "m.type",
  source: "m.source",
  confidence: "m.confidence",
  created_at: "m.created_at",
  linked: "linked_count",
});

export function getMemoryCatalog({
  q = "",
  limit = 25,
  offset = 0,
  sort = "created_at",
  order = "desc",
  source,
  type,
  ownerHash,
} = {}) {
  const db = getDb();
  const conditions = [];
  const params = {};
  const normalizedQuery = String(q).trim();

  if (ownerHash) {
    conditions.push("m.owner_hash = @ownerHash");
    params.ownerHash = ownerHash;
  }

  if (normalizedQuery) {
    conditions.push(`
      (
        m.title LIKE @query
        OR m.summary LIKE @query
        OR m.raw_text LIKE @query
        OR EXISTS (
          SELECT 1
          FROM memory_entities search_me
          JOIN entities search_e ON search_e.id = search_me.entity_id
          WHERE search_me.memory_id = m.id
            AND (
              search_e.canonical_name LIKE @query
              OR EXISTS (
                SELECT 1
                FROM entity_aliases search_ea
                WHERE search_ea.entity_id = search_e.id
                  AND search_ea.alias LIKE @query
              )
            )
        )
      )
    `);
    params.query = `%${normalizedQuery}%`;
  }
  if (source) {
    conditions.push("m.source = @source");
    params.source = source;
  }
  if (type) {
    conditions.push("m.type = @type");
    params.type = type;
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const sortColumn = MEMORY_CATALOG_SORTS[sort] || MEMORY_CATALOG_SORTS.created_at;
  const sortOrder = order === "asc" ? "ASC" : "DESC";
  const count = db
    .prepare(`SELECT COUNT(*) AS total FROM memories m ${where}`)
    .get(params).total;
  const rows = db
    .prepare(`
      SELECT
        m.*,
        COALESCE(
          json_group_array(
            CASE
              WHEN e.id IS NULL THEN NULL
              ELSE json_object(
                'id', e.id,
                'canonical_name', e.canonical_name,
                'kind', e.kind,
                'mention', me.mention,
                'role', me.role,
                'confidence', me.confidence
              )
            END
          ) FILTER (WHERE e.id IS NOT NULL),
          json('[]')
        ) AS entities_json,
        (
          SELECT COUNT(DISTINCT cand.memory_id)
          FROM memory_entities cur
          JOIN memory_entities cand ON cand.entity_id = cur.entity_id AND cand.memory_id <> cur.memory_id
          WHERE cur.memory_id = m.id
        ) AS linked_count
      FROM memories m
      LEFT JOIN memory_entities me ON me.memory_id = m.id
      LEFT JOIN entities e ON e.id = me.entity_id
      ${where}
      GROUP BY m.id
      ORDER BY ${sortColumn} ${sortOrder}, m.id ASC
      LIMIT @limit OFFSET @offset
    `)
    .all({ ...params, limit, offset })
    .map(({ entities_json: entitiesJson, linked_count: linkedCount, ...memory }) => ({
      ...deserializeMemory(memory),
      entities: JSON.parse(entitiesJson),
      linked_count: linkedCount || 0,
    }));

  return { items: rows, total: count, limit, offset };
}

export function searchMemories(query, { limit = 20 } = {}) {
  const db = getDb();
  const pattern = `%${query}%`;
  return db
    .prepare(
      `SELECT *
       FROM memories
       WHERE raw_text LIKE ? OR summary LIKE ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(pattern, pattern, limit)
    .map(deserializeMemory);
}

// --- FTS5 / BM25 ---

export function syncMemoriesToFts() {
  const database = getDb();
  database.exec("DELETE FROM memories_fts");
  database.prepare(`
    INSERT INTO memories_fts (memory_id, title, summary, raw_text, tags)
    SELECT id, title, summary, raw_text, tags FROM memories
  `).run();
  database.exec("INSERT INTO memories_fts(memories_fts) VALUES('optimize')");
}

export function indexMemoryFts(id) {
  const database = getDb();
  const memory = database.prepare("SELECT * FROM memories WHERE id = ?").get(id);
  if (!memory) return;
  database.prepare("DELETE FROM memories_fts WHERE memory_id = ?").run(id);
  database.exec("INSERT INTO memories_fts(memories_fts) VALUES('optimize')");
  database.prepare(`
    INSERT INTO memories_fts (memory_id, title, summary, raw_text, tags)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, memory.title || "", memory.summary || "", memory.raw_text || "", memory.tags || "[]");
}

export function removeMemoryFts(id) {
  const database = getDb();
  database.prepare("DELETE FROM memories_fts WHERE memory_id = ?").run(id);
  database.exec("INSERT INTO memories_fts(memories_fts) VALUES('optimize')");
}

export function searchMemoriesFts(query, { limit = 20, ownerHash } = {}) {
  const database = getDb();
  const ftsQuery = buildFtsQuery(query);
  if (!ftsQuery) return [];
  try {
    const rows = database.prepare(`
      SELECT memories_fts.memory_id, memories_fts.rank
      FROM memories_fts
      JOIN memories m ON m.id = memories_fts.memory_id
      WHERE memories_fts MATCH ?
        ${ownerHash ? "AND m.owner_hash = ?" : ""}
      ORDER BY rank
      LIMIT ?
    `).all(ftsQuery, ...(ownerHash ? [ownerHash] : []), limit);
    return rows.map((row) => ({ id: row.memory_id, score: row.rank }));
  } catch {
    return [];
  }
}

function buildFtsQuery(query) {
  const terms = String(query).trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return "";
  return terms.map((t) => `"${t.replace(/"/g, '""')}"`).join(" OR ");
}

function syncFtsForMemory(id) {
  try {
    indexMemoryFts(id);
  } catch {
    // FTS sync is best-effort; don't break the main operation
  }
}

function removeFtsForMemory(id) {
  try {
    removeMemoryFts(id);
  } catch {
    // FTS sync is best-effort
  }
}

export function updateMemorySummary(id, summary) {
  const db = getDb();
  const updatedAt = new Date().toISOString();
  db.prepare(`
    UPDATE memories SET summary = ?, updated_at = ? WHERE id = ?
  `).run(summary, updatedAt, id);
  syncFtsForMemory(id);
}

// --- Memory Comparisons ---

export function getMemoryComparison({
  leftMemoryId,
  rightMemoryId,
  inputHash,
  model,
  schemaVersion,
}) {
  const row = getDb()
    .prepare(`
      SELECT *
      FROM memory_comparisons
      WHERE left_memory_id = ?
        AND right_memory_id = ?
        AND input_hash = ?
        AND model = ?
        AND schema_version = ?
    `)
    .get(
      leftMemoryId,
      rightMemoryId,
      inputHash,
      model,
      schemaVersion,
    );
  if (!row) return null;
  return {
    ...row,
    comparison_json: JSON.parse(row.comparison_json),
  };
}

export function saveMemoryComparison({
  leftMemoryId,
  rightMemoryId,
  inputHash,
  model,
  schemaVersion,
  comparison,
  generatedAt = new Date().toISOString(),
}) {
  const db = getDb();
  const save = db.transaction(() => {
    db.prepare(`
      DELETE FROM memory_comparisons
      WHERE left_memory_id = ?
        AND right_memory_id = ?
        AND model = ?
        AND schema_version = ?
    `).run(leftMemoryId, rightMemoryId, model, schemaVersion);
    db.prepare(`
      INSERT INTO memory_comparisons (
        left_memory_id,
        right_memory_id,
        input_hash,
        model,
        schema_version,
        comparison_json,
        generated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      leftMemoryId,
      rightMemoryId,
      inputHash,
      model,
      schemaVersion,
      JSON.stringify(comparison),
      generatedAt,
    );
  });
  save();
  return getMemoryComparison({
    leftMemoryId,
    rightMemoryId,
    inputHash,
    model,
    schemaVersion,
  });
}

// --- Extraction CRUD ---

export function saveExtraction(
  memoryId,
  extractionJson,
  model,
  schemaVersion = EXTRACTION_SCHEMA_VERSION,
) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO memory_extractions (
      memory_id,
      extraction_json,
      model,
      schema_version
    )
    VALUES (?, ?, ?, ?)
  `);
  const result = stmt.run(
    memoryId,
    JSON.stringify(extractionJson),
    model,
    schemaVersion,
  );
  return result.lastInsertRowid;
}

export function getExtractions(memoryId) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT *
       FROM memory_extractions
       WHERE memory_id = ?
       ORDER BY created_at DESC, id DESC`
    )
    .all(memoryId);
  return rows.map((r) => ({ ...r, extraction_json: JSON.parse(r.extraction_json) }));
}

export function getLatestExtraction(memoryId) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT *
       FROM memory_extractions
       WHERE memory_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 1`
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
  const normalizedName = normalizeEntityName(canonicalName);
  const matches = findExactEntityMatches(normalizedName, kind);
  if (matches.length === 1) {
    addEntityAlias(matches[0].id, normalizedName, true);
    return matches[0].id;
  }

  const result = db
    .prepare("INSERT INTO entities (canonical_name, kind) VALUES (?, ?)")
    .run(normalizedName, kind);
  addEntityAlias(result.lastInsertRowid, normalizedName, true);
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
      `SELECT e.*
       FROM entities e
       WHERE e.canonical_name LIKE ?
          OR EXISTS (
            SELECT 1
            FROM entity_aliases ea
            WHERE ea.entity_id = e.id AND ea.alias LIKE ?
          )
       ORDER BY e.canonical_name`
    )
    .all(`%${query}%`, `%${query}%`);
}

export function getEntityAliases(entityId) {
  return getDb()
    .prepare(`
      SELECT id, entity_id, alias, normalized_alias, canonical, created_at
      FROM entity_aliases
      WHERE entity_id = ?
      ORDER BY canonical DESC, alias COLLATE NOCASE ASC, id ASC
    `)
    .all(entityId);
}

export function getEntityResolutionSuggestions({ status } = {}) {
  const db = getDb();
  const where = status ? "WHERE s.status = ?" : "";
  const params = status ? [status] : [];
  return db
    .prepare(`
      SELECT
        s.*,
        s.observed_alias AS alias,
        s.kind AS source_kind,
        s.kind AS target_kind,
        COALESCE(source.canonical_name, s.source_name) AS source_name,
        COALESCE(target.canonical_name, s.target_name) AS target_name
      FROM entity_resolution_suggestions s
      LEFT JOIN entities source ON source.id = s.source_entity_id
      LEFT JOIN entities target ON target.id = s.target_entity_id
      ${where}
      ORDER BY s.created_at DESC, s.id DESC
    `)
    .all(...params);
}

export function resolveEntityResolutionSuggestion(id, decision) {
  if (decision !== "merge" && decision !== "reject") {
    throw new Error(`Invalid entity resolution decision: ${decision}`);
  }

  const db = getDb();
  const resolve = db.transaction(() => {
    const suggestion = db
      .prepare("SELECT * FROM entity_resolution_suggestions WHERE id = ?")
      .get(id);
    if (!suggestion) return null;
    const desiredStatus = decision === "merge" ? "merged" : "rejected";
    if (suggestion.status !== "pending") {
      if (suggestion.status === desiredStatus) {
        return getEntityResolutionSuggestions().find((item) => item.id === id);
      }
      throw new Error(
        `Entity resolution suggestion ${id} is already ${suggestion.status}`,
      );
    }

    const resolvedAt = new Date().toISOString();
    if (decision === "reject") {
      db.prepare(`
        UPDATE entity_resolution_suggestions
        SET status = 'rejected', resolved_at = ?
        WHERE id = ?
      `).run(resolvedAt, id);
      return getEntityResolutionSuggestions().find((item) => item.id === id);
    }

    mergeEntityIntoTarget(
      suggestion.source_entity_id,
      suggestion.target_entity_id,
      id,
      resolvedAt,
    );
    return getEntityResolutionSuggestions().find((item) => item.id === id);
  });

  return resolve();
}

const ENTITY_CATALOG_SORTS = Object.freeze({
  canonical_name: "e.canonical_name",
  kind: "e.kind",
  memory_count: "memory_count",
  relationship_count: "relationship_count",
  created_at: "e.created_at",
});

export function getEntityCatalog({
  q = "",
  limit = 25,
  offset = 0,
  sort = "canonical_name",
  order = "asc",
  kind,
  ownerHash,
} = {}) {
  const db = getDb();
  const conditions = [];
  const params = {};
  const normalizedQuery = String(q).trim();

  if (ownerHash) {
    conditions.push(`EXISTS (
      SELECT 1 FROM memory_entities owner_me
      JOIN memories owner_m ON owner_m.id = owner_me.memory_id
      WHERE owner_me.entity_id = e.id AND owner_m.owner_hash = @ownerHash
    )`);
    params.ownerHash = ownerHash;
  }

  if (normalizedQuery) {
    conditions.push(`
      (
        e.canonical_name LIKE @query
        OR EXISTS (
          SELECT 1
          FROM entity_aliases search_ea
          WHERE search_ea.entity_id = e.id
            AND search_ea.alias LIKE @query
        )
      )
    `);
    params.query = `%${normalizedQuery}%`;
  }
  if (kind) {
    conditions.push("e.kind = @kind");
    params.kind = kind;
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const sortColumn = ENTITY_CATALOG_SORTS[sort]
    || ENTITY_CATALOG_SORTS.canonical_name;
  const sortOrder = order === "desc" ? "DESC" : "ASC";
  const total = db
    .prepare(`SELECT COUNT(*) AS total FROM entities e ${where}`)
    .get(params).total;
  const items = db
    .prepare(`
      SELECT
        e.*,
        COUNT(DISTINCT me.memory_id) AS memory_count,
        COUNT(DISTINCT r.id) AS relationship_count,
        (
          SELECT COUNT(*)
          FROM entity_aliases ea
          WHERE ea.entity_id = e.id
        ) AS alias_count,
        (
          SELECT COUNT(*)
          FROM entity_resolution_suggestions ers
          WHERE ers.status = 'pending'
            AND (
              ers.source_entity_id = e.id
              OR ers.target_entity_id = e.id
            )
        ) AS pending_suggestion_count
      FROM entities e
      LEFT JOIN memory_entities me ON me.entity_id = e.id
        ${ownerHash ? "AND EXISTS (SELECT 1 FROM memories owner_m WHERE owner_m.id = me.memory_id AND owner_m.owner_hash = @ownerHash)" : ""}
      LEFT JOIN relationships r
        ON (r.source_entity_id = e.id OR r.target_entity_id = e.id)
        ${ownerHash ? "AND EXISTS (SELECT 1 FROM memories owner_rm WHERE owner_rm.id = r.memory_id AND owner_rm.owner_hash = @ownerHash)" : ""}
      ${where}
      GROUP BY e.id
      ORDER BY ${sortColumn} ${sortOrder}, e.id ASC
      LIMIT @limit OFFSET @offset
    `)
    .all({ ...params, limit, offset });

  return { items, total, limit, offset };
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
      `SELECT m.*, me.mention, me.role, me.confidence AS entity_confidence
       FROM memory_entities me
       JOIN memories m ON m.id = me.memory_id
       WHERE me.entity_id = ?`
    )
    .all(entityId)
    .map(deserializeMemory);
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
       WHERE r.source_entity_id = ? OR r.target_entity_id = ?
       ORDER BY r.created_at DESC, r.id DESC`
    )
    .all(entityId, entityId);
}

export function getStructuralMemoryLinks(memoryId) {
  const db = getDb();
  const sharedEntityRows = db
    .prepare(`
      SELECT DISTINCT
        candidate.memory_id,
        e.id,
        e.canonical_name,
        e.kind
      FROM memory_entities current
      JOIN memory_entities candidate
        ON candidate.entity_id = current.entity_id
       AND candidate.memory_id <> current.memory_id
      JOIN entities e ON e.id = current.entity_id
      WHERE current.memory_id = ?
      ORDER BY candidate.memory_id ASC, e.canonical_name ASC, e.id ASC
    `)
    .all(memoryId);
  const sharedRelationshipRows = db
    .prepare(`
      SELECT DISTINCT
        candidate.memory_id,
        current.source_entity_id,
        source.canonical_name AS source_name,
        source.kind AS source_kind,
        current.predicate,
        current.target_entity_id,
        target.canonical_name AS target_name,
        target.kind AS target_kind
      FROM relationships current
      JOIN relationships candidate
        ON candidate.source_entity_id = current.source_entity_id
       AND candidate.target_entity_id = current.target_entity_id
       AND candidate.predicate = current.predicate
       AND candidate.memory_id <> current.memory_id
      JOIN entities source ON source.id = current.source_entity_id
      JOIN entities target ON target.id = current.target_entity_id
      WHERE current.memory_id = ?
      ORDER BY candidate.memory_id ASC, current.predicate ASC
    `)
    .all(memoryId);
  const candidates = new Map();
  const ensureCandidate = (candidateMemoryId) => {
    if (!candidates.has(candidateMemoryId)) {
      candidates.set(candidateMemoryId, {
        memory_id: candidateMemoryId,
        shared_entities: [],
        shared_relationships: [],
      });
    }
    return candidates.get(candidateMemoryId);
  };

  for (const { memory_id: candidateMemoryId, ...entity } of sharedEntityRows) {
    ensureCandidate(candidateMemoryId).shared_entities.push(entity);
  }
  for (const {
    memory_id: candidateMemoryId,
    ...relationship
  } of sharedRelationshipRows) {
    ensureCandidate(candidateMemoryId).shared_relationships.push(relationship);
  }

  return [...candidates.values()];
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
    INSERT INTO region_activations (
      memory_id,
      region,
      weight,
      left_weight,
      right_weight,
      mapping_version
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insert = db.transaction((items) => {
    remove.run(memoryId, mappingVersion);
    for (const { region, weight, hemispheres } of items) {
      stmt.run(
        memoryId,
        region,
        weight,
        hemispheres?.left ?? null,
        hemispheres?.right ?? null,
        mappingVersion,
      );
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
      `SELECT region, weight, left_weight, right_weight, mapping_version
       FROM region_activations
       WHERE memory_id = ? AND mapping_version = ?
       ORDER BY weight DESC, region ASC`
    )
    .all(memoryId, mappingVersion)
    .map(({ left_weight: left, right_weight: right, ...activation }) => ({
      ...activation,
      ...(Number.isFinite(left) && Number.isFinite(right)
        ? { hemispheres: { left, right } }
        : {}),
    }));
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

export function storeMemory(
  id,
  rawText,
  ingestionDate,
  extraction,
  model,
  source = "ui",
  metadata = {},
) {
  const db = getDb();
  const storeAll = db.transaction(() => {
    createMemory(
      id,
      rawText,
      ingestionDate,
      extraction.summary,
      source,
      metadata,
    );
    saveExtraction(id, extraction, model);
    persistDerivedMemoryGraph(id, extraction);

    return getMemory(id);
  });

  return storeAll();
}

export function updateMemoryGraph({
  memoryId,
  rawText,
  ingestionDate,
  extraction,
  model,
  metadata = {},
  schemaVersion = EXTRACTION_SCHEMA_VERSION,
}) {
  const db = getDb();
  const updateAll = db.transaction(() => {
    const current = db
      .prepare("SELECT * FROM memories WHERE id = ?")
      .get(memoryId);
    if (!current) {
      throw new Error(`Memory not found: ${memoryId}`);
    }

    const revisionNumber = db
      .prepare(`
        SELECT COALESCE(MAX(revision_number), 0) + 1 AS revision_number
        FROM memory_revisions
        WHERE memory_id = ?
      `)
      .get(memoryId).revision_number;
    const now = new Date().toISOString();
    const snapshot = getMemoryGraphSnapshot(memoryId);
    db.prepare(`
      INSERT INTO memory_revisions (
        memory_id,
        revision_number,
        snapshot_json,
        created_at
      )
      VALUES (?, ?, ?, ?)
    `).run(memoryId, revisionNumber, JSON.stringify(snapshot), now);

    const tags = mergeTags(current.tags, metadata.tags);
    db.prepare(`
      UPDATE memories
      SET raw_text = ?,
          ingestion_date = ?,
          summary = ?,
          type = ?,
          title = ?,
          confidence = ?,
          tags = ?,
          version = version + 1,
          updated_at = ?
      WHERE id = ?
    `).run(
      rawText,
      ingestionDate,
      extraction.summary ?? null,
      metadata.type || "fact",
      metadata.title || String(rawText).slice(0, 50),
      metadata.confidence ?? 0.6,
      JSON.stringify(tags),
      now,
      memoryId,
    );

    db.prepare("DELETE FROM relationships WHERE memory_id = ?").run(memoryId);
    db.prepare("DELETE FROM memory_entities WHERE memory_id = ?").run(memoryId);
    db.prepare("DELETE FROM region_activations WHERE memory_id = ?").run(memoryId);
    db.prepare(`
      DELETE FROM memory_comparisons
      WHERE left_memory_id = ? OR right_memory_id = ?
    `).run(memoryId, memoryId);

    saveExtraction(memoryId, extraction, model, schemaVersion);
    persistDerivedMemoryGraph(memoryId, extraction);
    syncFtsForMemory(memoryId);

    return {
      memory: getMemory(memoryId),
      revisionNumber,
    };
  });

  return updateAll();
}

export function getMemoryRevisions(memoryId) {
  return getDb()
    .prepare(`
      SELECT *
      FROM memory_revisions
      WHERE memory_id = ?
      ORDER BY revision_number DESC, id DESC
    `)
    .all(memoryId)
    .map((revision) => ({
      ...revision,
      snapshot_json: JSON.parse(revision.snapshot_json),
    }));
}

function getMemoryGraphSnapshot(memoryId) {
  const db = getDb();
  return {
    memory: deserializeMemory(
      db.prepare("SELECT * FROM memories WHERE id = ?").get(memoryId),
    ),
    extractions: getExtractions(memoryId),
    entities: db
      .prepare(`
        SELECT e.*
        FROM entities e
        WHERE e.id IN (
          SELECT me.entity_id
          FROM memory_entities me
          WHERE me.memory_id = ?
          UNION
          SELECT r.source_entity_id
          FROM relationships r
          WHERE r.memory_id = ?
          UNION
          SELECT r.target_entity_id
          FROM relationships r
          WHERE r.memory_id = ?
        )
        ORDER BY e.id ASC
      `)
      .all(memoryId, memoryId, memoryId),
    entityLinks: db
      .prepare(`
        SELECT *
        FROM memory_entities
        WHERE memory_id = ?
        ORDER BY id ASC
      `)
      .all(memoryId),
    relationships: db
      .prepare(`
        SELECT *
        FROM relationships
        WHERE memory_id = ?
        ORDER BY id ASC
      `)
      .all(memoryId),
    regionActivations: db
      .prepare(`
        SELECT *
        FROM region_activations
        WHERE memory_id = ?
        ORDER BY mapping_version ASC, id ASC
      `)
      .all(memoryId),
  };
}

function persistDerivedMemoryGraph(memoryId, extraction) {
  saveRegionActivations(
    memoryId,
    mapExtractionToRegions(extraction),
    REGION_MAPPING_VERSION,
  );

  const entityIds = new Map();
  for (const ent of extraction.entities || []) {
    const name = ent.canonicalName || ent.mention;
    const entityId = resolveEntityForExtraction({
      canonicalName: name,
      mention: ent.mention,
      kind: ent.kind,
    });
    if (entityId === null) continue;
    for (const alias of [name, ent.mention, ent.canonicalName]) {
      const key = normalizeEntityKey(alias);
      if (key) entityIds.set(key, entityId);
    }
    linkMemoryToEntity(
      memoryId,
      entityId,
      ent.mention,
      null,
      ent.confidence,
    );
  }

  for (const rel of extraction.relationships || []) {
    const srcName = String(rel.subject || "").trim();
    const tgtName = String(rel.object || "").trim();
    const srcId =
      entityIds.get(normalizeEntityKey(srcName)) ||
      resolveEntityForExtraction({
        canonicalName: srcName,
        mention: srcName,
        kind: "concept",
      });
    const tgtId =
      entityIds.get(normalizeEntityKey(tgtName)) ||
      resolveEntityForExtraction({
        canonicalName: tgtName,
        mention: tgtName,
        kind: "concept",
      });
    // Skip edges where either endpoint was a generic mention; a relationship
    // between two real nodes is meaningless if one side never materialized.
    if (srcId === null || tgtId === null) continue;
    addRelationship(
      srcId,
      tgtId,
      rel.predicate,
      memoryId,
      rel.confidence,
      rel.evidence || (rel.evidenceSpanIndexes || [])
        .map((index) => extraction.evidenceSpans?.[index]?.text)
        .filter(Boolean)
        .join(" … "),
    );
  }

  // Re-persisting this memory's graph may have orphaned entities that were
  // only referenced by the previous revision (update path deletes links first)
  // and may have introduced case-variant duplicates. Prune then merge so the
  // entity set stays clean and deduped within the same session.
  pruneOrphanEntities();
  mergeDuplicateEntities();
}

function mergeTags(existingJson, incomingTags) {
  let existingTags = [];
  try {
    existingTags = JSON.parse(existingJson);
  } catch {
    existingTags = [];
  }
  return [
    ...new Set([
      ...(Array.isArray(existingTags) ? existingTags : []),
      ...(Array.isArray(incomingTags) ? incomingTags : []),
    ]),
  ];
}

function normalizeEntityKey(value) {
  return normalizeEntityName(value)
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function deserializeMemory(memory) {
  if (!memory) return memory;
  try {
    return { ...memory, tags: JSON.parse(memory.tags) };
  } catch {
    return { ...memory, tags: [] };
  }
}

function normalizeEntityName(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ");
}

function mergeDuplicateEntities() {
  const entities = db
    .prepare("SELECT id, canonical_name, kind FROM entities ORDER BY id")
    .all();
  const canonicalIds = new Map();
  const canonicalUserKey = `person:${normalizeEntityKey(USER_ENTITY_NAME)}`;
  const merge = db.transaction(() => {
    const copyMemoryLinks = db.prepare(`
      INSERT OR IGNORE INTO memory_entities (
        memory_id,
        entity_id,
        mention,
        role,
        confidence,
        created_at
      )
      SELECT memory_id, ?, mention, role, confidence, created_at
      FROM memory_entities
      WHERE entity_id = ?
    `);
    const copyRelationships = db.prepare(`
      INSERT OR IGNORE INTO relationships (
        source_entity_id,
        target_entity_id,
        predicate,
        memory_id,
        confidence,
        evidence,
        created_at
      )
      SELECT
        CASE WHEN source_entity_id = ? THEN ? ELSE source_entity_id END,
        CASE WHEN target_entity_id = ? THEN ? ELSE target_entity_id END,
        predicate,
        memory_id,
        confidence,
        evidence,
        created_at
      FROM relationships
      WHERE source_entity_id = ? OR target_entity_id = ?
    `);
    const copyAliases = db.prepare(`
      INSERT OR IGNORE INTO entity_aliases (
        entity_id,
        alias,
        normalized_alias,
        canonical,
        created_at
      )
      SELECT ?, alias, normalized_alias, 0, created_at
      FROM entity_aliases
      WHERE entity_id = ?
    `);
    const deleteMemoryLinks = db.prepare(
      "DELETE FROM memory_entities WHERE entity_id = ?",
    );
    const deleteRelationships = db.prepare(
      "DELETE FROM relationships WHERE source_entity_id = ? OR target_entity_id = ?",
    );
    const closeSuggestions = db.prepare(`
      UPDATE entity_resolution_suggestions
      SET status = 'rejected', resolved_at = ?
      WHERE status = 'pending'
        AND (
          source_entity_id = ?
          OR target_entity_id = ?
        )
    `);
    const deleteEntity = db.prepare("DELETE FROM entities WHERE id = ?");

    for (const entity of entities) {
      const normalizedName = normalizeEntityKey(entity.canonical_name);
      const key = FIRST_PERSON_KEYS.has(normalizedName)
        ? canonicalUserKey
        : `${entity.kind}:${normalizedName}`;
      const canonicalId = canonicalIds.get(key);
      if (!canonicalId) {
        canonicalIds.set(key, entity.id);
        continue;
      }

      copyMemoryLinks.run(canonicalId, entity.id);
      copyAliases.run(canonicalId, entity.id);
      copyRelationships.run(
        entity.id,
        canonicalId,
        entity.id,
        canonicalId,
        entity.id,
        entity.id,
      );
      deleteMemoryLinks.run(entity.id);
      deleteRelationships.run(entity.id, entity.id);
      closeSuggestions.run(new Date().toISOString(), entity.id, entity.id);
      deleteEntity.run(entity.id);
    }
  });

  merge();

  const canonicalUserId = canonicalIds.get(canonicalUserKey);
  if (canonicalUserId) {
    db.prepare(`
      UPDATE entities
      SET canonical_name = ?, kind = 'person'
      WHERE id = ?
    `).run(USER_ENTITY_NAME, canonicalUserId);
    addEntityAlias(canonicalUserId, USER_ENTITY_NAME, true);
  }
}

/**
 * Delete entities that no longer participate in the graph — neither linked to
 * any memory nor referenced by any relationship. Called after memory delete
 * and after derived-graph persistence so the entity set stays closed over
 * "currently referenced". Returns the count of entities removed.
 */
export function pruneOrphanEntities() {
  const db = getDb();
  return db
    .prepare(`
      DELETE FROM entities
      WHERE id NOT IN (
        SELECT entity_id FROM memory_entities
        UNION
        SELECT source_entity_id FROM relationships
        UNION
        SELECT target_entity_id FROM relationships
      )
    `)
    .run().changes;
}

const GENERIC_ENTITY_ALIASES = new Set([
  "agent",
  "he",
  "her",
  "hers",
  "herself",
  "him",
  "himself",
  "i",
  "it",
  "itself",
  "colleague",
  "company",
  "concept",
  "coworker",
  "friend",
  "girl",
  "guy",
  "man",
  "main agent",
  "me",
  "myself",
  "object",
  "organization",
  "person",
  "place",
  "someone",
  "somebody",
  "something",
  "she",
  "them",
  "themselves",
  "they",
  "this person",
  "we",
  "who",
  "whom",
  "woman",
  "you",
  "yourself",
]);

function isUsefulEntityAlias(value) {
  const key = normalizeEntityKey(value);
  return Boolean(key) && !GENERIC_ENTITY_ALIASES.has(key);
}

function addEntityAlias(entityId, alias, canonical = false) {
  const displayAlias = normalizeEntityName(alias);
  const normalizedAlias = normalizeEntityKey(displayAlias);
  if (!normalizedAlias) return;
  getDb().prepare(`
    INSERT INTO entity_aliases (
      entity_id,
      alias,
      normalized_alias,
      canonical
    )
    VALUES (?, ?, ?, ?)
    ON CONFLICT(entity_id, normalized_alias) DO UPDATE SET
      canonical = MAX(entity_aliases.canonical, excluded.canonical)
  `).run(entityId, displayAlias, normalizedAlias, canonical ? 1 : 0);
}

function backfillCanonicalEntityAliases() {
  const entities = db
    .prepare("SELECT id, canonical_name FROM entities ORDER BY id")
    .all();
  const backfill = db.transaction(() => {
    for (const entity of entities) {
      addEntityAlias(entity.id, entity.canonical_name, true);
    }
  });
  backfill();
}

function findExactEntityMatches(value, kind) {
  const key = normalizeEntityKey(value);
  if (!key) return [];
  return getDb()
    .prepare(`
      SELECT DISTINCT e.id, e.canonical_name, e.kind
      FROM entities e
      LEFT JOIN entity_aliases ea ON ea.entity_id = e.id
      WHERE e.kind = ?
        AND (
          ea.normalized_alias = ?
          OR lower(trim(e.canonical_name)) = ?
        )
      ORDER BY e.id ASC
    `)
    .all(kind, key, key);
}

function resolveUserEntity() {
  const db = getDb();
  const existing = findExactEntityMatches(USER_ENTITY_NAME, "person");
  if (existing.length > 0) {
    const entityId = existing[0].id;
    addEntityAlias(entityId, USER_ENTITY_NAME, true);
    return entityId;
  }
  const result = db
    .prepare("INSERT INTO entities (canonical_name, kind) VALUES (?, ?)")
    .run(USER_ENTITY_NAME, "person");
  const entityId = result.lastInsertRowid;
  addEntityAlias(entityId, USER_ENTITY_NAME, true);
  return entityId;
}

function resolveEntityForExtraction({ canonicalName, mention, kind }) {
  const db = getDb();
  const canonical = normalizeEntityName(canonicalName || mention);

  // First-person references collapse to the canonical User identity. This is
  // the single-user system's anchor: "self"/"user"/"I" all resolve to one
  // person entity regardless of how the LLM phrased or classified the mention.
  if (
    FIRST_PERSON_KEYS.has(normalizeEntityKey(canonical))
    || (mention && FIRST_PERSON_KEYS.has(normalizeEntityKey(mention)))
  ) {
    const entityId = resolveUserEntity();
    if (isUsefulEntityAlias(canonical) && !FIRST_PERSON_KEYS.has(normalizeEntityKey(canonical))) {
      addEntityAlias(entityId, canonical, false);
    }
    if (isUsefulEntityAlias(mention) && !FIRST_PERSON_KEYS.has(normalizeEntityKey(mention))) {
      addEntityAlias(entityId, mention, false);
    }
    return entityId;
  }

  // Generic mentions (pronouns, role nouns like "person"/"agent") carry no
  // identity. Rather than creating floating nodes, skip linking entirely.
  if (!isUsefulEntityAlias(canonical) && !isUsefulEntityAlias(mention)) {
    return null;
  }

  const canonicalMatches = findExactEntityMatches(canonical, kind);
  if (canonicalMatches.length === 1) {
    const entityId = canonicalMatches[0].id;
    addEntityAlias(entityId, canonical, true);
    recordMentionAliasOrSuggestions(entityId, mention, kind);
    return entityId;
  }

  const mentionMatches = isUsefulEntityAlias(mention)
    ? findExactEntityMatches(mention, kind)
    : [];
  if (canonicalMatches.length === 0 && mentionMatches.length === 1) {
    const entityId = mentionMatches[0].id;
    addEntityAlias(entityId, canonical, false);
    addEntityAlias(entityId, mention, false);
    return entityId;
  }

  const result = db
    .prepare("INSERT INTO entities (canonical_name, kind) VALUES (?, ?)")
    .run(canonical, kind);
  const entityId = result.lastInsertRowid;
  addEntityAlias(entityId, canonical, true);
  if (isUsefulEntityAlias(mention)) {
    addEntityAlias(entityId, mention, false);
  }

  const exactCandidates = new Map(
    [...canonicalMatches, ...mentionMatches].map((candidate) => [
      candidate.id,
      candidate,
    ]),
  );
  for (const candidate of findFuzzyEntityCandidates(
    [canonical, mention],
    kind,
    entityId,
  )) {
    exactCandidates.set(candidate.id, candidate);
  }
  for (const candidate of exactCandidates.values()) {
    createEntityResolutionSuggestion(
      entityId,
      candidate.id,
      isUsefulEntityAlias(mention) ? mention : canonical,
    );
  }
  return entityId;
}

function recordMentionAliasOrSuggestions(entityId, mention, kind) {
  if (!isUsefulEntityAlias(mention)) return;
  const conflictingMatches = findExactEntityMatches(mention, kind)
    .filter((candidate) => candidate.id !== entityId);
  if (conflictingMatches.length === 0) {
    addEntityAlias(entityId, mention, false);
    return;
  }
  for (const candidate of conflictingMatches) {
    createEntityResolutionSuggestion(entityId, candidate.id, mention);
  }
}

function findFuzzyEntityCandidates(values, kind, excludedEntityId) {
  const keys = [...new Set(values.map(normalizeEntityKey).filter(Boolean))];
  if (keys.length === 0) return [];
  const rows = getDb()
    .prepare(`
      SELECT DISTINCT
        e.id,
        e.canonical_name,
        e.kind,
        ea.normalized_alias
      FROM entities e
      JOIN entity_aliases ea ON ea.entity_id = e.id
      WHERE e.kind = ? AND e.id <> ?
      ORDER BY e.id ASC
    `)
    .all(kind, excludedEntityId);
  const matches = new Map();
  for (const row of rows) {
    if (keys.some((key) => areFuzzyEntityKeys(key, row.normalized_alias))) {
      matches.set(row.id, {
        id: row.id,
        canonical_name: row.canonical_name,
        kind: row.kind,
      });
    }
  }
  return [...matches.values()];
}

function areFuzzyEntityKeys(left, right) {
  if (!left || !right || left === right) return false;
  const leftTokens = left.split(" ");
  const rightTokens = right.split(" ");
  const shorter = leftTokens.length <= rightTokens.length
    ? leftTokens
    : rightTokens;
  const longer = new Set(
    leftTokens.length <= rightTokens.length ? rightTokens : leftTokens,
  );
  return shorter.length > 0 && shorter.every((token) => longer.has(token));
}

function createEntityResolutionSuggestion(
  sourceEntityId,
  targetEntityId,
  observedAlias,
) {
  if (sourceEntityId === targetEntityId) return;
  const db = getDb();
  const source = db
    .prepare("SELECT canonical_name, kind FROM entities WHERE id = ?")
    .get(sourceEntityId);
  const target = db
    .prepare("SELECT canonical_name, kind FROM entities WHERE id = ?")
    .get(targetEntityId);
  if (!source || !target || source.kind !== target.kind) return;
  db.prepare(`
    INSERT OR IGNORE INTO entity_resolution_suggestions (
      source_entity_id,
      target_entity_id,
      source_name,
      target_name,
      kind,
      observed_alias,
      normalized_alias
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    sourceEntityId,
    targetEntityId,
    source.canonical_name,
    target.canonical_name,
    source.kind,
    normalizeEntityName(observedAlias),
    normalizeEntityKey(observedAlias),
  );
}

function mergeEntityIntoTarget(
  sourceEntityId,
  targetEntityId,
  suggestionId,
  resolvedAt,
) {
  const db = getDb();
  const source = db
    .prepare("SELECT * FROM entities WHERE id = ?")
    .get(sourceEntityId);
  const target = db
    .prepare("SELECT * FROM entities WHERE id = ?")
    .get(targetEntityId);
  if (!source || !target) {
    throw new Error("Entity resolution merge endpoint no longer exists");
  }
  if (source.kind !== target.kind) {
    throw new Error("Cannot merge entities of different kinds");
  }

  db.prepare(`
    INSERT OR IGNORE INTO entity_aliases (
      entity_id,
      alias,
      normalized_alias,
      canonical,
      created_at
    )
    SELECT ?, alias, normalized_alias, 0, created_at
    FROM entity_aliases
    WHERE entity_id = ?
  `).run(targetEntityId, sourceEntityId);
  db.prepare(`
    INSERT OR IGNORE INTO memory_entities (
      memory_id,
      entity_id,
      mention,
      role,
      confidence,
      created_at
    )
    SELECT memory_id, ?, mention, role, confidence, created_at
    FROM memory_entities
    WHERE entity_id = ?
  `).run(targetEntityId, sourceEntityId);
  db.prepare(`
    INSERT OR IGNORE INTO relationships (
      source_entity_id,
      target_entity_id,
      predicate,
      memory_id,
      confidence,
      evidence,
      created_at
    )
    SELECT
      CASE WHEN source_entity_id = ? THEN ? ELSE source_entity_id END,
      CASE WHEN target_entity_id = ? THEN ? ELSE target_entity_id END,
      predicate,
      memory_id,
      confidence,
      evidence,
      created_at
    FROM relationships
    WHERE source_entity_id = ? OR target_entity_id = ?
  `).run(
    sourceEntityId,
    targetEntityId,
    sourceEntityId,
    targetEntityId,
    sourceEntityId,
    sourceEntityId,
  );

  db.prepare("DELETE FROM memory_entities WHERE entity_id = ?")
    .run(sourceEntityId);
  db.prepare(`
    DELETE FROM relationships
    WHERE source_entity_id = ? OR target_entity_id = ?
  `).run(sourceEntityId, sourceEntityId);
  db.prepare(`
    UPDATE entity_resolution_suggestions
    SET status = 'rejected', resolved_at = ?
    WHERE status = 'pending'
      AND id <> ?
      AND (
        source_entity_id = ?
        OR target_entity_id = ?
      )
  `).run(resolvedAt, suggestionId, sourceEntityId, sourceEntityId);
  db.prepare("DELETE FROM entities WHERE id = ?").run(sourceEntityId);
  db.prepare(`
    UPDATE entity_resolution_suggestions
    SET status = 'merged', resolved_at = ?
    WHERE id = ?
  `).run(resolvedAt, suggestionId);
}

// --- Delete ---

export function deleteAllMemories() {
  const db = getDb();
  db.exec("DELETE FROM memories");
  db.exec("DELETE FROM memories_fts");
  db.exec("INSERT INTO memories_fts(memories_fts) VALUES('optimize')");
}

export function deleteAllEntities() {
  const db = getDb();
  const cleanup = db.transaction(() => {
    db.exec("DELETE FROM memory_entities");
    db.exec("DELETE FROM relationships");
    db.exec("DELETE FROM entity_resolution_suggestions");
    db.exec("DELETE FROM entity_aliases");
    db.exec("DELETE FROM entities");
  });
  cleanup();
}

export function deleteMemory(id) {
  const db = getDb();
  db.prepare("DELETE FROM memories WHERE id = ?").run(id);
  removeFtsForMemory(id);
  // Cascade removes memory_entities/relationships, but the FK does not prune
  // the entities themselves — remove anything now left unreferenced.
  pruneOrphanEntities();
}

export function deleteMemoriesByOwner(ownerHash) {
  const database = getDb();
  const ids = database.prepare("SELECT id FROM memories WHERE owner_hash = ?")
    .all(ownerHash).map(({ id }) => id);
  const remove = database.transaction(() => {
    database.prepare("DELETE FROM memories WHERE owner_hash = ?").run(ownerHash);
    for (const id of ids) removeFtsForMemory(id);
    pruneOrphanEntities();
  });
  remove();
  return ids;
}

// --- Graph Data ---

export function getGraphData() {
  const db = getDb();

  const memoryRows = db
    .prepare(
      `SELECT m.id, m.raw_text, m.summary, m.source, m.type AS category, m.created_at,
              e.extraction_json
       FROM memories m
       LEFT JOIN memory_extractions e ON e.id = (
         SELECT latest.id
         FROM memory_extractions latest
         WHERE latest.memory_id = m.id
         ORDER BY latest.created_at DESC, latest.id DESC
         LIMIT 1
       )
       ORDER BY m.created_at DESC`
    )
    .all();

  const memoryNodes = memoryRows.map((row) => {
    const extraction = row.extraction_json ? JSON.parse(row.extraction_json) : null;
    return {
      id: row.id,
      type: "memory",
      label: row.summary || row.raw_text || row.id,
      text: row.raw_text,
      source: row.source,
      category: row.category || extraction?.category || null,
      salience: extraction?.salience ?? 0.5,
      types: extraction?.types ?? [],
      createdAt: row.created_at,
    };
  });

  const entityRows = db
    .prepare(
      `SELECT e.id, e.canonical_name, e.kind,
              COUNT(DISTINCT me.memory_id) AS memory_count
       FROM entities e
       LEFT JOIN memory_entities me ON me.entity_id = e.id
       GROUP BY e.id
       HAVING memory_count > 0
       ORDER BY memory_count DESC, e.canonical_name ASC`
    )
    .all();

  const entityNodes = entityRows.map((row) => ({
    id: `entity_${row.id}`,
    entityId: row.id,
    type: "entity",
    label: row.canonical_name,
    kind: row.kind,
    memoryCount: row.memory_count,
  }));

  const memoryEntityEdges = db
    .prepare(
      `SELECT me.memory_id, me.entity_id, me.mention, me.confidence
       FROM memory_entities me`
    )
    .all()
    .map((row) => ({
      source: row.memory_id,
      target: `entity_${row.entity_id}`,
      type: "memory-entity",
      label: row.mention,
      confidence: row.confidence,
    }));

  const relationshipEdges = db
    .prepare(
      `SELECT r.id, r.source_entity_id, r.target_entity_id,
              r.predicate, r.confidence, r.memory_id, r.evidence,
              se.canonical_name AS source_name, se.kind AS source_kind,
              te.canonical_name AS target_name, te.kind AS target_kind
       FROM relationships r
       JOIN entities se ON se.id = r.source_entity_id
       JOIN entities te ON te.id = r.target_entity_id`
    )
    .all()
    .map((row) => ({
      source: `entity_${row.source_entity_id}`,
      target: `entity_${row.target_entity_id}`,
      type: "relationship",
      label: row.predicate,
      confidence: row.confidence,
      memoryId: row.memory_id,
      evidence: row.evidence,
      sourceName: row.source_name,
      targetName: row.target_name,
    }));

  const entityNodeIds = new Set(entityNodes.map((node) => node.id));
  const renderableRelationshipEdges = relationshipEdges.filter(
    (edge) => entityNodeIds.has(edge.source) && entityNodeIds.has(edge.target)
  );

  return {
    nodes: [...memoryNodes, ...entityNodes],
    edges: [...memoryEntityEdges, ...renderableRelationshipEdges],
  };
}

export function auditMemoryIntegrity() {
  const database = getDb();
  const findings = [];
  const memories = database.prepare(`
    SELECT m.*, e.id AS extraction_id, e.extraction_json, e.schema_version
    FROM memories m
    LEFT JOIN memory_extractions e ON e.id = (
      SELECT latest.id FROM memory_extractions latest
      WHERE latest.memory_id = m.id ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1
    )
    ORDER BY m.id
  `).all();

  const shapesByVersion = new Map();
  for (const memory of memories) {
    const extraction = parseJson(memory.extraction_json, null);
    if (!extraction) {
      findings.push({ code: "missing_extraction", memoryId: memory.id });
      continue;
    }
    const shape = extraction.evidenceSpans && extraction.durability
      ? "semantic_v3_atom"
      : extraction.memories ? "semantic_collection" : "legacy_atom";
    const shapes = shapesByVersion.get(memory.schema_version) || new Set();
    shapes.add(shape);
    shapesByVersion.set(memory.schema_version, shapes);
    if (extraction.text && extraction.text !== memory.raw_text) {
      findings.push({
        code: "extraction_text_mismatch",
        memoryId: memory.id,
        extractionId: memory.extraction_id,
      });
    }
    if (likelyMultiFact(memory.raw_text, extraction)) {
      findings.push({ code: "likely_multi_fact_atom", memoryId: memory.id });
    }
    if (memory.summary && hasNegationMismatch(memory.raw_text, memory.summary)) {
      findings.push({ code: "possible_summary_contradiction", memoryId: memory.id });
    }
  }

  for (const [schemaVersion, shapes] of shapesByVersion) {
    if (shapes.size > 1) {
      findings.push({
        code: "incompatible_schema_shapes",
        schemaVersion,
        shapes: [...shapes].sort(),
      });
    }
  }

  const unsupportedRelationships = database.prepare(`
    SELECT r.id, r.memory_id, r.evidence, m.raw_text,
      GROUP_CONCAT(s.text, char(0)) AS source_texts
    FROM relationships r
    JOIN memories m ON m.id = r.memory_id
    LEFT JOIN source_memory_links l ON l.memory_id = m.id
    LEFT JOIN memory_sources s ON s.id = l.source_id
    GROUP BY r.id
  `).all().filter((row) => row.evidence
    && !row.raw_text.includes(row.evidence)
    && !String(row.source_texts || "").split("\u0000").some(
      (sourceText) => sourceText.includes(row.evidence),
    ));
  for (const relationship of unsupportedRelationships) {
    findings.push({
      code: "relationship_evidence_missing",
      memoryId: relationship.memory_id,
      relationshipId: relationship.id,
    });
  }

  for (const row of database.prepare(`
    SELECT s.id FROM memory_sources s
    LEFT JOIN source_memory_links l ON l.source_id = s.id
    WHERE s.extraction_status = 'completed'
    GROUP BY s.id HAVING COUNT(l.id) = 0
  `).all()) {
    findings.push({ code: "orphaned_source", sourceId: row.id });
  }
  for (const row of database.prepare(`
    SELECT a.id, a.memory_id FROM cognitive_annotations a
    LEFT JOIN memories m ON m.id = a.memory_id WHERE m.id IS NULL
  `).all()) {
    findings.push({
      code: "orphaned_annotation",
      annotationId: row.id,
      memoryId: row.memory_id,
    });
  }
  for (const row of database.prepare(`
    SELECT e.id, e.canonical_name, e.kind
    FROM entities e
    WHERE NOT EXISTS (SELECT 1 FROM memory_entities me WHERE me.entity_id = e.id)
      AND NOT EXISTS (SELECT 1 FROM relationships r
                      WHERE r.source_entity_id = e.id OR r.target_entity_id = e.id)
  `).all()) {
    findings.push({
      code: "orphaned_entity",
      entityId: row.id,
      name: row.canonical_name,
      kind: row.kind,
    });
  }
  for (const row of database.prepare(`
    SELECT m.id, m.version,
      MAX(CASE WHEN v.status = 'completed' THEN v.memory_version END) AS indexed_version
    FROM memories m LEFT JOIN vector_index_jobs v ON v.memory_id = m.id
    GROUP BY m.id
    HAVING indexed_version IS NULL OR indexed_version < m.version
  `).all()) {
    findings.push({
      code: "missing_or_stale_vector_index",
      memoryId: row.id,
      memoryVersion: row.version,
      indexedVersion: row.indexed_version,
    });
  }

  const counts = findings.reduce((result, finding) => {
    result[finding.code] = (result[finding.code] || 0) + 1;
    return result;
  }, {});
  return {
    generatedAt: new Date().toISOString(),
    memoryCount: memories.length,
    findingCount: findings.length,
    counts,
    findings,
  };
}

function likelyMultiFact(text, extraction) {
  if ((String(text).match(/[.!?]+(?:\s+|$)/g) || []).length > 1) return true;
  const subjects = new Set((extraction.relationships || [])
    .map((relationship) => String(relationship.subject).toLocaleLowerCase()));
  return subjects.size > 1 || (/\band\b/i.test(text)
    && (extraction.relationships || []).length > 1);
}

function hasNegationMismatch(text, summary) {
  const negation = (value) => /\b(?:not|never|no longer|doesn't|don't|isn't|wasn't)\b/i.test(value);
  return negation(text) !== negation(summary);
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
