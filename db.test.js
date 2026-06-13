import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const testDir = mkdtempSync(join(tmpdir(), "engram-db-"));
process.env.ENGRAM_DB_PATH = join(testDir, "test.db");

const {
  backfillRegionActivations,
  closeDb,
  deleteMemory,
  getDb,
  getEntitiesForMemory,
  getRegionActivations,
  getRelationshipsForMemory,
  saveExtraction,
  saveRegionActivations,
  storeMemory,
} = await import("./db.js");

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

test.after(() => {
  closeDb();
  rmSync(testDir, { recursive: true, force: true });
});

test("storeMemory persists current region activations in the same transaction", () => {
  storeMemory(
    "mem_store",
    "I visited the museum.",
    "2026-06-12T00:00:00.000Z",
    extraction(),
    "test-model"
  );

  const regions = getRegionActivations("mem_store");
  assert.ok(regions.length > 1);
  assert.equal(regions[0].region, "hippocampus");
  assert.ok(Math.abs(regions.reduce((sum, item) => sum + item.weight, 0) - 1) < 1e-12);
});

test("storeMemory rolls back region activations when later storage fails", () => {
  assert.throws(() => {
    storeMemory(
      "mem_rollback",
      "This should roll back.",
      "2026-06-12T00:00:00.000Z",
      extraction({
        entities: [
          {
            mention: "invalid",
            canonicalName: "invalid",
            kind: "invalid-kind",
            confidence: 1,
          },
        ],
      }),
      "test-model"
    );
  });

  const db = getDb();
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM memories WHERE id = ?").get("mem_rollback")
      .count,
    0
  );
  assert.equal(
    db
      .prepare("SELECT COUNT(*) AS count FROM region_activations WHERE memory_id = ?")
      .get("mem_rollback").count,
    0
  );
});

test("backfill creates only a missing current mapping version and is idempotent", () => {
  const db = getDb();
  db.prepare(
    `INSERT INTO memories (id, raw_text, ingestion_date, summary)
     VALUES (?, ?, ?, ?)`
  ).run("mem_backfill", "Paris is in France.", "2026-06-12T00:00:00.000Z", "Paris");
  saveExtraction(
    "mem_backfill",
    extraction({
      types: [{ type: "semantic", weight: 0.9 }],
      summary: "Paris is in France.",
    }),
    "test-model"
  );
  saveRegionActivations(
    "mem_backfill",
    [{ region: "hippocampus", weight: 1 }],
    0
  );

  assert.equal(backfillRegionActivations(), 1);
  assert.equal(backfillRegionActivations(), 0);
  assert.equal(getRegionActivations("mem_backfill")[0].region, "temporalCortex");

  const counts = db
    .prepare(
      `SELECT mapping_version, COUNT(*) AS count
       FROM region_activations
       WHERE memory_id = ?
       GROUP BY mapping_version
       ORDER BY mapping_version`
    )
    .all("mem_backfill");
  assert.deepEqual(counts, [
    { mapping_version: 0, count: 1 },
    { mapping_version: 1, count: 3 },
  ]);
});

test("deleting a memory cascades to its region activations", () => {
  deleteMemory("mem_store");

  const count = getDb()
    .prepare("SELECT COUNT(*) AS count FROM region_activations WHERE memory_id = ?")
    .get("mem_store").count;
  assert.equal(count, 0);
});

test("relationship endpoints reuse entities by normalized mention and canonical name", () => {
  storeMemory(
    "mem_entity_aliases",
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
          subject: "  MAYA  ",
          predicate: "visited",
          object: "city museum",
          confidence: 0.94,
          evidence: "Maya visited the museum",
        },
      ],
    }),
    "test-model",
  );

  const entities = getEntitiesForMemory("mem_entity_aliases");
  const relationship = getRelationshipsForMemory("mem_entity_aliases")[0];
  const maya = entities.find((entity) => entity.canonical_name === "Maya Patel");
  const museum = entities.find(
    (entity) => entity.canonical_name === "City Museum",
  );

  assert.equal(relationship.source_entity_id, maya.id);
  assert.equal(relationship.target_entity_id, museum.id);
  assert.equal(
    getDb()
      .prepare(
        `SELECT COUNT(*) AS count
         FROM entities
         WHERE kind = 'concept'
           AND lower(trim(canonical_name)) IN ('maya', 'city museum')`,
      )
      .get().count,
    0,
  );
});
