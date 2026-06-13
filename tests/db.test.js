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
  findEntities,
  getDb,
  getEntityAliases,
  getEntityCatalog,
  getEntityResolutionSuggestions,
  getEntitiesForMemory,
  getLatestExtraction,
  getMemory,
  getMemoryCatalog,
  getMemoryComparison,
  getMemoryRevisions,
  getMemoriesForEntity,
  getRegionActivations,
  getRelationshipsForMemory,
  getStructuralMemoryLinks,
  resolveEntityResolutionSuggestion,
  saveExtraction,
  saveMemoryComparison,
  saveRegionActivations,
  storeMemory,
  updateMemoryGraph,
} = await import("../src/db.js");

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
  assert.equal(regions[0].mapping_version, 2);
  assert.equal(regions[0].hemispheres.left, regions[0].hemispheres.right);
  assert.ok(
    Math.abs(
      regions[0].hemispheres.left
        + regions[0].hemispheres.right
        - regions[0].weight,
    ) < 1e-12,
  );
  assert.ok(Math.abs(regions.reduce((sum, item) => sum + item.weight, 0) - 1) < 1e-12);
  assert.equal(getLatestExtraction("mem_store").schema_version, 2);
});

test("storeMemory persists indexed memory metadata", () => {
  storeMemory(
    "mem_metadata",
    "Use SQLite for the local prototype.",
    "2026-06-13T00:00:00.000Z",
    extraction({ summary: "Use SQLite locally." }),
    "test-model",
    "mcp",
    {
      type: "decision",
      title: "Use SQLite for the local prototype.",
      confidence: 0.9,
      tags: ["database", "prototype"],
    },
  );

  const memory = getMemory("mem_metadata");
  assert.equal(memory.type, "decision");
  assert.equal(memory.title, "Use SQLite for the local prototype.");
  assert.equal(memory.confidence, 0.9);
  assert.deepEqual(memory.tags, ["database", "prototype"]);
  assert.equal(memory.scope, "agent");
  assert.match(memory.created_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(memory.updated_at, memory.created_at);
});

test("memory catalog searches, filters, sorts, paginates, and aggregates entities", () => {
  const firstPage = getMemoryCatalog({
    source: "mcp",
    sort: "confidence",
    order: "desc",
    limit: 1,
  });
  assert.equal(firstPage.total, 1);
  assert.equal(firstPage.items[0].id, "mem_metadata");
  assert.deepEqual(firstPage.items[0].tags, ["database", "prototype"]);

  const entitySearch = getMemoryCatalog({
    q: "museum",
    sort: "title",
    order: "asc",
    limit: 10,
  });
  assert.equal(entitySearch.total, 1);
  assert.equal(entitySearch.items[0].id, "mem_store");
  assert.deepEqual(entitySearch.items[0].entities, []);

  const emptyPage = getMemoryCatalog({ limit: 1, offset: 99 });
  assert.equal(emptyPage.items.length, 0);
  assert.ok(emptyPage.total >= 2);
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
    1
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
    { mapping_version: 1, count: 1 },
    { mapping_version: 2, count: 3 },
  ]);
});

test("backfill gives legacy spatial extractions a modest right bias", () => {
  const db = getDb();
  db.prepare(
    `INSERT INTO memories (id, raw_text, ingestion_date, summary)
     VALUES (?, ?, ?, ?)`
  ).run(
    "mem_spatial_backfill",
    "I remember the route through town.",
    "2026-06-12T00:00:00.000Z",
    "A route through town.",
  );
  saveExtraction(
    "mem_spatial_backfill",
    extraction({
      types: [{ type: "spatial", weight: 1 }],
      summary: "A route through town.",
    }),
    "legacy-model",
    1,
  );

  assert.equal(backfillRegionActivations(), 1);
  const hippocampus = getRegionActivations("mem_spatial_backfill").find(
    ({ region }) => region === "hippocampus",
  );
  assert.ok(hippocampus.hemispheres.right > hippocampus.hemispheres.left);
});

test("region activation column migration is idempotent", () => {
  const columnNames = getDb()
    .prepare("PRAGMA table_info(region_activations)")
    .all()
    .map(({ name }) => name);

  assert.ok(columnNames.includes("left_weight"));
  assert.ok(columnNames.includes("right_weight"));
  assert.deepEqual(
    ["entity_aliases", "entity_resolution_suggestions"].map((name) =>
      getDb()
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(name).name),
    ["entity_aliases", "entity_resolution_suggestions"],
  );
  closeDb();
  assert.doesNotThrow(() => getDb());
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

test("entity links reuse canonical names across case and whitespace differences", () => {
  storeMemory(
    "mem_chess_topic",
    "chess",
    "2026-06-13T00:00:00.000Z",
    extraction({
      entities: [
        {
          mention: "chess",
          canonicalName: "chess",
          kind: "concept",
          confidence: 0.99,
        },
      ],
    }),
    "test-model",
  );
  storeMemory(
    "mem_chess_event",
    "I played chess today",
    "2026-06-13T00:00:00.000Z",
    extraction({
      entities: [
        {
          mention: "chess",
          canonicalName: "  Chess  ",
          kind: "concept",
          confidence: 0.99,
        },
      ],
    }),
    "test-model",
  );

  const topicEntity = getEntitiesForMemory("mem_chess_topic")[0];
  const eventEntity = getEntitiesForMemory("mem_chess_event")[0];

  assert.equal(eventEntity.id, topicEntity.id);
  assert.deepEqual(
    getMemoriesForEntity(topicEntity.id)
      .map(({ id }) => id)
      .sort(),
    ["mem_chess_event", "mem_chess_topic"],
  );
});

test("entity catalog returns aggregate memory and relationship counts", () => {
  const result = getEntityCatalog({
    q: "chess",
    kind: "concept",
    sort: "memory_count",
    order: "desc",
    limit: 10,
  });

  assert.equal(result.total, 1);
  assert.equal(result.items[0].canonical_name.toLowerCase(), "chess");
  assert.equal(result.items[0].memory_count, 2);
  assert.equal(result.items[0].relationship_count, 0);

  const relationshipResult = getEntityCatalog({
    q: "Maya",
    sort: "relationship_count",
    order: "desc",
  });
  assert.equal(relationshipResult.items[0].relationship_count, 1);
  assert.equal(relationshipResult.items[0].memory_count, 1);
});

test("entity aliases are normalized, searchable, and omit generic mentions", () => {
  storeMemory(
    "mem_alias_search",
    "IBM announced an update.",
    "2026-06-13T00:00:00.000Z",
    extraction({
      entities: [
        {
          mention: "IBM",
          canonicalName: "International Business Machines",
          kind: "organization",
          confidence: 0.99,
        },
        {
          mention: "she",
          canonicalName: "Ada Lovelace",
          kind: "person",
          confidence: 0.95,
        },
      ],
    }),
    "test-model",
  );

  const organization = getEntitiesForMemory("mem_alias_search")
    .find(({ kind }) => kind === "organization");
  const person = getEntitiesForMemory("mem_alias_search")
    .find(({ kind }) => kind === "person");
  assert.deepEqual(
    getEntityAliases(organization.id).map(({ alias }) => alias),
    ["International Business Machines", "IBM"],
  );
  assert.deepEqual(
    getEntityAliases(person.id).map(({ alias }) => alias),
    ["Ada Lovelace"],
  );
  assert.equal(findEntities("IBM")[0].id, organization.id);
  const catalogEntity = getEntityCatalog({ q: "IBM" }).items[0];
  assert.equal(catalogEntity.id, organization.id);
  assert.equal(catalogEntity.alias_count, 2);
  assert.equal(catalogEntity.pending_suggestion_count, 0);
  assert.equal(
    getMemoryCatalog({ q: "IBM" }).items.some(({ id }) => id === "mem_alias_search"),
    true,
  );
});

test("canonical entity resolution normalizes NFKC and punctuation", () => {
  storeMemory(
    "mem_acme_fullwidth",
    "ＡＣＭＥ, Inc. launched.",
    "2026-06-13T00:00:00.000Z",
    extraction({
      entities: [{
        mention: "ＡＣＭＥ, Inc.",
        canonicalName: "ＡＣＭＥ, Inc.",
        kind: "organization",
        confidence: 0.99,
      }],
    }),
    "test-model",
  );
  storeMemory(
    "mem_acme_ascii",
    "Acme Inc expanded.",
    "2026-06-13T01:00:00.000Z",
    extraction({
      entities: [{
        mention: "Acme Inc",
        canonicalName: "Acme Inc",
        kind: "organization",
        confidence: 0.99,
      }],
    }),
    "test-model",
  );

  assert.equal(
    getEntitiesForMemory("mem_acme_fullwidth")[0].id,
    getEntitiesForMemory("mem_acme_ascii")[0].id,
  );
});

test("ambiguous and fuzzy entity matches create deduplicated review suggestions", () => {
  for (const [id, name] of [
    ["mem_jordan_lee", "Jordan Lee"],
    ["mem_jordan_kim", "Jordan Kim"],
    ["mem_jordan", "Jordan"],
  ]) {
    storeMemory(
      id,
      name,
      "2026-06-13T00:00:00.000Z",
      extraction({
        entities: [{
          mention: name,
          canonicalName: name,
          kind: "person",
          confidence: 0.99,
        }],
      }),
      "test-model",
    );
  }

  const jordan = getEntitiesForMemory("mem_jordan")[0];
  const pending = getEntityResolutionSuggestions({ status: "pending" })
    .filter(({ source_entity_id: sourceId }) => sourceId === jordan.id);
  assert.equal(pending.length, 2);
  assert.equal(pending[0].alias, "Jordan");
  assert.equal(pending[0].source_kind, "person");
  assert.equal(pending[0].target_kind, "person");
  assert.deepEqual(
    pending.map(({ target_name: name }) => name).sort(),
    ["Jordan Kim", "Jordan Lee"],
  );
  assert.equal(
    getEntityCatalog({ q: "Jordan", sort: "created_at", order: "desc" })
      .items.find(({ id }) => id === jordan.id).pending_suggestion_count,
    2,
  );

  const rejected = resolveEntityResolutionSuggestion(pending[0].id, "reject");
  assert.equal(rejected.status, "rejected");
  assert.equal(resolveEntityResolutionSuggestion(pending[0].id, "reject").status, "rejected");
  assert.equal(
    getEntityResolutionSuggestions()
      .filter(({ source_entity_id: sourceId }) => sourceId === jordan.id)
      .length,
    2,
  );
  assert.equal(resolveEntityResolutionSuggestion(999999, "reject"), null);
});

test("merging a suggestion preserves history and moves graph references", () => {
  storeMemory(
    "mem_robert_smith",
    "Robert Smith leads Atlas.",
    "2026-06-13T00:00:00.000Z",
    extraction({
      entities: [
        {
          mention: "Robert Smith",
          canonicalName: "Robert Smith",
          kind: "person",
          confidence: 0.99,
        },
        {
          mention: "Atlas",
          canonicalName: "Atlas Initiative",
          kind: "organization",
          confidence: 0.95,
        },
      ],
      relationships: [{
        subject: "Robert Smith",
        predicate: "leads",
        object: "Atlas",
        confidence: 0.9,
      }],
    }),
    "test-model",
  );
  storeMemory(
    "mem_robert",
    "Robert leads Atlas.",
    "2026-06-13T01:00:00.000Z",
    extraction({
      entities: [
        {
          mention: "Robert",
          canonicalName: "Robert",
          kind: "person",
          confidence: 0.99,
        },
        {
          mention: "Atlas",
          canonicalName: "Atlas Initiative",
          kind: "organization",
          confidence: 0.95,
        },
      ],
      relationships: [{
        subject: "Robert",
        predicate: "leads",
        object: "Atlas",
        confidence: 0.9,
      }],
    }),
    "test-model",
  );

  const target = getEntitiesForMemory("mem_robert_smith")
    .find(({ kind }) => kind === "person");
  const source = getEntitiesForMemory("mem_robert")
    .find(({ kind }) => kind === "person");
  const suggestion = getEntityResolutionSuggestions({ status: "pending" })
    .find(({ source_entity_id: sourceId, target_entity_id: targetId }) =>
      sourceId === source.id && targetId === target.id);
  const resolved = resolveEntityResolutionSuggestion(suggestion.id, "merge");

  assert.equal(resolved.status, "merged");
  assert.equal(resolved.source_name, "Robert");
  assert.equal(resolved.target_name, "Robert Smith");
  assert.equal(getDb().prepare("SELECT 1 FROM entities WHERE id = ?").get(source.id), undefined);
  assert.equal(
    getEntitiesForMemory("mem_robert")
      .find(({ kind }) => kind === "person").id,
    target.id,
  );
  assert.equal(
    getRelationshipsForMemory("mem_robert")[0].source_entity_id,
    target.id,
  );
  assert.deepEqual(
    getEntityAliases(target.id).map(({ alias }) => alias).sort(),
    ["Robert", "Robert Smith"],
  );
  assert.equal(
    getEntityResolutionSuggestions().find(({ id }) => id === suggestion.id).status,
    "merged",
  );
});

test("structural memory links include shared entities and explicit triples", () => {
  const sharedExtraction = (includeRelationship) => extraction({
    entities: [
      {
        mention: "Link Alice",
        canonicalName: "Link Alice",
        kind: "person",
        confidence: 0.99,
      },
      {
        mention: "Link Project",
        canonicalName: "Link Project",
        kind: "concept",
        confidence: 0.95,
      },
    ],
    relationships: includeRelationship
      ? [{
          subject: "Link Alice",
          predicate: "supports",
          object: "Link Project",
          confidence: 0.9,
        }]
      : [],
  });
  storeMemory(
    "mem_link_a",
    "Link Alice supports Link Project.",
    "2026-06-13T00:00:00.000Z",
    sharedExtraction(true),
    "test-model",
  );
  storeMemory(
    "mem_link_b",
    "Link Alice still supports Link Project.",
    "2026-06-13T01:00:00.000Z",
    sharedExtraction(true),
    "test-model",
  );
  storeMemory(
    "mem_link_c",
    "Link Alice discussed Link Project.",
    "2026-06-13T02:00:00.000Z",
    sharedExtraction(false),
    "test-model",
  );

  const links = getStructuralMemoryLinks("mem_link_a");
  const linked = links.find(({ memory_id: id }) => id === "mem_link_b");
  const entityOnly = links.find(({ memory_id: id }) => id === "mem_link_c");
  assert.deepEqual(
    linked.shared_entities.map(({ canonical_name: name }) => name),
    ["Link Alice", "Link Project"],
  );
  assert.equal(linked.shared_relationships.length, 1);
  assert.equal(linked.shared_relationships[0].predicate, "supports");
  assert.equal(entityOnly.shared_relationships.length, 0);
});

test("database startup merges existing normalized entity duplicates", () => {
  const db = getDb();
  const lowerId = db
    .prepare("INSERT INTO entities (canonical_name, kind) VALUES (?, ?)")
    .run("board game", "concept").lastInsertRowid;
  const upperId = db
    .prepare("INSERT INTO entities (canonical_name, kind) VALUES (?, ?)")
    .run("  Board   Game  ", "concept").lastInsertRowid;
  db.prepare(
    `INSERT INTO memory_entities (memory_id, entity_id, mention)
     VALUES (?, ?, ?)`,
  ).run("mem_chess_topic", lowerId, "board game");
  db.prepare(
    `INSERT INTO memory_entities (memory_id, entity_id, mention)
     VALUES (?, ?, ?)`,
  ).run("mem_chess_event", upperId, "Board Game");

  closeDb();
  const reopened = getDb();
  const matches = reopened
    .prepare("SELECT id FROM entities WHERE kind = 'concept'")
    .all()
    .filter(({ id }) => id === lowerId || id === upperId);

  assert.equal(matches.length, 1);
  assert.deepEqual(
    getMemoriesForEntity(matches[0].id)
      .map(({ id }) => id)
      .sort(),
    ["mem_chess_event", "mem_chess_topic"],
  );
});

test("memory comparisons replace pair history and cascade on memory deletion", () => {
  storeMemory(
    "mem_compare_left",
    "Maya visited the museum.",
    "2026-06-13T00:00:00.000Z",
    extraction(),
    "test-model",
  );
  storeMemory(
    "mem_compare_right",
    "Maya called later.",
    "2026-06-13T01:00:00.000Z",
    extraction(),
    "test-model",
  );
  const base = {
    leftMemoryId: "mem_compare_left",
    rightMemoryId: "mem_compare_right",
    model: "test-model",
    schemaVersion: 1,
  };

  saveMemoryComparison({
    ...base,
    inputHash: "old-hash",
    comparison: { overview: "Old" },
  });
  saveMemoryComparison({
    ...base,
    inputHash: "new-hash",
    comparison: { overview: "New" },
  });

  assert.equal(
    getMemoryComparison({ ...base, inputHash: "old-hash" }),
    null,
  );
  assert.equal(
    getMemoryComparison({ ...base, inputHash: "new-hash" })
      .comparison_json.overview,
    "New",
  );
  assert.equal(
    getMemoryComparison({
      ...base,
      inputHash: "new-hash",
      model: "different-model",
    }),
    null,
  );
  assert.equal(
    getMemoryComparison({
      ...base,
      inputHash: "new-hash",
      schemaVersion: 2,
    }),
    null,
  );

  deleteMemory("mem_compare_left");
  assert.equal(
    getMemoryComparison({ ...base, inputHash: "new-hash" }),
    null,
  );
});

test("updateMemoryGraph snapshots and atomically replaces the full memory graph", () => {
  storeMemory(
    "mem_update",
    "Maya prefers tea.",
    "2026-06-12T00:00:00.000Z",
    extraction({
      summary: "Maya prefers tea.",
      entities: [
        {
          mention: "Maya",
          canonicalName: "Maya",
          kind: "person",
          confidence: 0.99,
        },
        {
          mention: "tea",
          canonicalName: "Tea",
          kind: "concept",
          confidence: 0.95,
        },
      ],
      relationships: [
        {
          subject: "Maya",
          predicate: "prefers",
          object: "tea",
          confidence: 0.94,
          evidence: "Maya prefers tea",
        },
      ],
    }),
    "old-model",
    "mcp",
    {
      type: "preference",
      title: "Maya prefers tea",
      confidence: 0.8,
      tags: ["drink", "old"],
    },
  );
  const before = getMemory("mem_update");
  storeMemory(
    "mem_update_peer",
    "Maya mentioned a drink.",
    "2026-06-12T01:00:00.000Z",
    extraction(),
    "test-model",
  );
  const comparison = {
    leftMemoryId: "mem_update",
    rightMemoryId: "mem_update_peer",
    inputHash: "stale-hash",
    model: "test-model",
    schemaVersion: 1,
  };
  saveMemoryComparison({
    ...comparison,
    comparison: { overview: "Stale" },
  });

  const result = updateMemoryGraph({
    memoryId: "mem_update",
    rawText: "Maya now prefers coffee.",
    ingestionDate: "2026-06-13T00:00:00.000Z",
    extraction: extraction({
      summary: "Maya prefers coffee.",
      entities: [
        {
          mention: "Maya",
          canonicalName: "Maya",
          kind: "person",
          confidence: 0.99,
        },
        {
          mention: "coffee",
          canonicalName: "Coffee",
          kind: "concept",
          confidence: 0.96,
        },
      ],
      relationships: [
        {
          subject: "Maya",
          predicate: "prefers",
          object: "coffee",
          confidence: 0.97,
          evidence: "Maya now prefers coffee",
        },
      ],
    }),
    model: "new-model",
    metadata: {
      type: "preference",
      title: "Maya prefers coffee",
      confidence: 0.97,
      tags: ["drink", "current"],
    },
  });

  assert.equal(result.revisionNumber, 1);
  assert.equal(result.memory.id, before.id);
  assert.equal(result.memory.created_at, before.created_at);
  assert.equal(result.memory.scope, before.scope);
  assert.equal(result.memory.source, before.source);
  assert.equal(result.memory.raw_text, "Maya now prefers coffee.");
  assert.equal(result.memory.summary, "Maya prefers coffee.");
  assert.equal(result.memory.type, "preference");
  assert.equal(result.memory.title, "Maya prefers coffee");
  assert.equal(result.memory.confidence, 0.97);
  assert.equal(result.memory.ingestion_date, "2026-06-13T00:00:00.000Z");
  assert.deepEqual(result.memory.tags, ["drink", "old", "current"]);

  const revisions = getMemoryRevisions("mem_update");
  assert.equal(revisions.length, 1);
  assert.equal(revisions[0].snapshot_json.memory.raw_text, "Maya prefers tea.");
  assert.equal(revisions[0].snapshot_json.extractions.length, 1);
  assert.equal(revisions[0].snapshot_json.entities.length, 2);
  assert.equal(revisions[0].snapshot_json.entityLinks.length, 2);
  assert.equal(revisions[0].snapshot_json.relationships.length, 1);
  assert.ok(revisions[0].snapshot_json.regionActivations.length > 1);

  assert.deepEqual(
    getEntitiesForMemory("mem_update")
      .map(({ canonical_name: name }) => name)
      .sort(),
    ["Coffee", "Maya Patel"],
  );
  assert.equal(getRelationshipsForMemory("mem_update")[0].target_name, "Coffee");
  assert.ok(getRegionActivations("mem_update").length > 1);
  assert.equal(getLatestExtraction("mem_update").model, "new-model");
  assert.equal(getMemoryComparison(comparison), null);
});

test("updateMemoryGraph increments revisions and deterministically selects the latest extraction", () => {
  const db = getDb();

  updateMemoryGraph({
    memoryId: "mem_update",
    rawText: "Maya strongly prefers coffee.",
    ingestionDate: "2026-06-13T01:00:00.000Z",
    extraction: extraction({ summary: "Maya strongly prefers coffee." }),
    model: "newest-model",
    metadata: {
      type: "preference",
      title: "Maya strongly prefers coffee",
      confidence: 0.99,
      tags: ["confirmed"],
    },
  });
  const latest = getLatestExtraction("mem_update");
  db.prepare(`
    UPDATE memory_extractions
    SET created_at = ?
    WHERE memory_id = ?
  `).run("2026-06-13 00:00:00", "mem_update");

  assert.equal(getLatestExtraction("mem_update").id, latest.id);
  assert.deepEqual(
    getMemoryRevisions("mem_update").map(({ revision_number: number }) => number),
    [2, 1],
  );
});

test("updateMemoryGraph rolls back the revision and every graph change on failure", () => {
  storeMemory(
    "mem_update_rollback",
    "Original memory.",
    "2026-06-12T00:00:00.000Z",
    extraction({
      summary: "Original memory.",
      entities: [
        {
          mention: "Original",
          canonicalName: "Original",
          kind: "concept",
          confidence: 1,
        },
      ],
    }),
    "old-model",
  );
  storeMemory(
    "mem_update_rollback_peer",
    "Peer memory.",
    "2026-06-12T01:00:00.000Z",
    extraction(),
    "test-model",
  );
  const comparison = {
    leftMemoryId: "mem_update_rollback",
    rightMemoryId: "mem_update_rollback_peer",
    inputHash: "rollback-hash",
    model: "test-model",
    schemaVersion: 1,
  };
  saveMemoryComparison({
    ...comparison,
    comparison: { overview: "Must survive rollback" },
  });
  const before = {
    memory: getMemory("mem_update_rollback"),
    extraction: getLatestExtraction("mem_update_rollback"),
    entities: getEntitiesForMemory("mem_update_rollback"),
    regions: getRegionActivations("mem_update_rollback"),
  };

  assert.throws(() =>
    updateMemoryGraph({
      memoryId: "mem_update_rollback",
      rawText: "Broken replacement.",
      ingestionDate: "2026-06-13T00:00:00.000Z",
      extraction: extraction({
        summary: "Broken replacement.",
        entities: [
          {
            mention: "Broken",
            canonicalName: "Broken",
            kind: "invalid-kind",
            confidence: 1,
          },
        ],
      }),
      model: "new-model",
    }),
  );

  assert.deepEqual(getMemory("mem_update_rollback"), before.memory);
  assert.deepEqual(
    getLatestExtraction("mem_update_rollback"),
    before.extraction,
  );
  assert.deepEqual(
    getEntitiesForMemory("mem_update_rollback"),
    before.entities,
  );
  assert.deepEqual(
    getRegionActivations("mem_update_rollback"),
    before.regions,
  );
  assert.equal(getMemoryRevisions("mem_update_rollback").length, 0);
  assert.equal(
    getMemoryComparison(comparison).comparison_json.overview,
    "Must survive rollback",
  );
});
