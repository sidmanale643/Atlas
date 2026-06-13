import assert from "node:assert/strict";
import test from "node:test";
import {
  combineSignals,
  getRelatedMemories,
} from "../src/related-memories.js";

const memories = new Map([
  ["origin", {
    id: "origin",
    raw_text: "I met Maya at the museum.",
    summary: "Met Maya at a museum.",
    created_at: "2026-06-13T00:00:00.000Z",
  }],
  ["structural", {
    id: "structural",
    raw_text: "Maya returned to the museum.",
    created_at: "2026-06-12T00:00:00.000Z",
  }],
  ["semantic", {
    id: "semantic",
    raw_text: "I visited an art exhibition.",
    created_at: "2026-06-14T00:00:00.000Z",
  }],
]);

function dependencies(overrides = {}) {
  return {
    getMemory: (id) => memories.get(id),
    getStructuralMemoryLinks: () => [{
      memory_id: "structural",
      shared_entities: [
        { id: 1, canonical_name: "Maya Patel", kind: "person" },
        { id: 1, canonical_name: "Maya Patel", kind: "person" },
      ],
      shared_relationships: [{
        subject: "Maya Patel",
        predicate: "visited",
        object: "City Museum",
      }],
    }],
    searchMemoryVectors: async () => [
      { id: "origin", score: 1 },
      { id: "semantic", score: 0.82 },
      { id: "below", score: 0.4 },
    ],
    serializeMemory: (memory) => ({ ...memory, serialized: true }),
    ...overrides,
  };
}

test("combines independent relation signals", () => {
  assert.equal(combineSignals([0.5, 0.5]), 0.75);
  assert.equal(combineSignals([]), 0);
});

test("ranks structural and semantic links with reasons", async () => {
  const result = await getRelatedMemories(
    "origin",
    dependencies(),
    { limit: 5, scoreThreshold: 0.65 },
  );

  assert.equal(result.semanticAvailable, true);
  assert.deepEqual(
    result.links.map((link) => link.memory.id),
    ["semantic", "structural"],
  );
  assert.equal(result.links[1].sharedEntities.length, 1);
  assert.match(result.links[1].reasons[0], /Shared person: Maya Patel/);
  assert.equal(result.links[0].semanticSimilarity, 0.82);
  assert.equal(result.links[0].memory.serialized, true);
});

test("returns structural links when vector search is unavailable", async () => {
  const result = await getRelatedMemories(
    "origin",
    dependencies({
      searchMemoryVectors: async () => {
        throw new Error("Qdrant unavailable");
      },
    }),
  );

  assert.equal(result.semanticAvailable, false);
  assert.deepEqual(
    result.links.map((link) => link.memory.id),
    ["structural"],
  );
});

test("applies limits after deterministic score and date ordering", async () => {
  const result = await getRelatedMemories(
    "origin",
    dependencies({
      getStructuralMemoryLinks: () => [],
      searchMemoryVectors: async () => [
        { id: "structural", score: 0.7 },
        { id: "semantic", score: 0.7 },
      ],
    }),
    { limit: 1, scoreThreshold: 0.65 },
  );

  assert.deepEqual(
    result.links.map((link) => link.memory.id),
    ["semantic"],
  );
});

test("returns null for an unknown origin memory", async () => {
  assert.equal(
    await getRelatedMemories("missing", dependencies()),
    null,
  );
});
