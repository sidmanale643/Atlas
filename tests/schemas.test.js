import assert from "node:assert/strict";
import test from "node:test";

import {
  AddMemorySchema,
  EXTRACTION_SCHEMA_VERSION,
  ExtractionSchema,
  MEMORY_COMPARISON_SCHEMA_VERSION,
  MemoryComparisonRequest,
  MemoryComparisonSchema,
  MemoryWriteDecisionJsonSchema,
  MemoryWriteDecisionSchema,
} from "../src/schemas.js";

function extraction(overrides = {}) {
  return {
    occurredAt: { text: "", normalized: null, confidence: 0 },
    types: [{ type: "episodic", weight: 1 }],
    emotions: [],
    entities: [],
    relationships: [],
    actions: [],
    topics: [],
    contentCues: [],
    salience: 0.5,
    summary: "A test memory.",
    ...overrides,
  };
}

test("exports extraction schema version 2", () => {
  assert.equal(EXTRACTION_SCHEMA_VERSION, 2);
  assert.equal(MEMORY_COMPARISON_SCHEMA_VERSION, 1);
});

test("validates comparison requests and structured findings", () => {
  assert.deepEqual(
    MemoryComparisonRequest.parse({
      leftMemoryId: "left",
      rightMemoryId: "right",
    }),
    {
      leftMemoryId: "left",
      rightMemoryId: "right",
      regenerate: false,
    },
  );
  assert.equal(
    MemoryComparisonRequest.safeParse({
      leftMemoryId: "same",
      rightMemoryId: "same",
    }).success,
    false,
  );
  assert.equal(
    MemoryComparisonSchema.safeParse({
      relationship: "overlapping",
      confidence: 0.8,
      overview: "Both memories involve Maya.",
      sharedFacts: [{
        statement: "Maya appears in both.",
        leftEvidence: "Maya",
        rightEvidence: "Maya",
        confidence: 1,
      }],
      differences: [],
      contradictions: [],
      caveats: [],
    }).success,
    true,
  );
});

test("validates the MCP add-memory metadata and applies defaults", () => {
  const result = AddMemorySchema.parse({
    text: "Use SQLite for the local prototype.",
    type: "decision",
    title: "Use SQLite for the local prototype.",
  });

  assert.equal(result.confidence, 0.6);
  assert.deepEqual(result.tags, []);
  assert.equal(
    AddMemorySchema.safeParse({
      text: "A memory",
      type: "unsupported",
      title: "A memory",
    }).success,
    false,
  );
  assert.equal(
    AddMemorySchema.safeParse({
      text: "A memory",
      type: "fact",
      title: "x".repeat(51),
    }).success,
    false,
  );
});

test("accepts every supported MCP memory type", () => {
  for (const type of [
    "relationship",
    "preference",
    "fact",
    "decision",
    "learning",
    "event",
    "instruction",
    "observation",
    "error",
  ]) {
    assert.equal(
      AddMemorySchema.safeParse({
        text: "A memory",
        type,
        title: "A memory",
      }).success,
      true,
    );
  }
});

test("accepts evidence-backed verbal and spatial content cues", () => {
  const result = ExtractionSchema.safeParse(
    extraction({
      contentCues: [
        {
          kind: "verbal",
          weight: 0.8,
          confidence: 0.9,
          evidence: "what Maya told me",
        },
        {
          kind: "spatial",
          weight: 0.7,
          confidence: 1,
          evidence: "left at the station",
        },
      ],
    }),
  );

  assert.equal(result.success, true);
});

test("rejects unsupported cue kinds, empty evidence, and out-of-range values", () => {
  for (const cue of [
    { kind: "visual", weight: 0.5, confidence: 1, evidence: "the red sign" },
    { kind: "verbal", weight: 1.1, confidence: 1, evidence: "the words" },
    { kind: "spatial", weight: 0.5, confidence: -0.1, evidence: "the route" },
    { kind: "verbal", weight: 0.5, confidence: 1, evidence: "" },
  ]) {
    assert.equal(
      ExtractionSchema.safeParse(extraction({ contentCues: [cue] })).success,
      false,
    );
  }
});

test("validates strict memory write decisions", () => {
  assert.deepEqual(
    MemoryWriteDecisionSchema.parse({
      action: "update",
      matchedMemoryId: "mem_1",
      confidence: 0.9,
      reason: "The preference changed.",
      replacementText: "I prefer tea.",
    }),
    {
      action: "update",
      matchedMemoryId: "mem_1",
      confidence: 0.9,
      reason: "The preference changed.",
      replacementText: "I prefer tea.",
    },
  );
  assert.equal(
    MemoryWriteDecisionSchema.safeParse({
      action: "create",
      matchedMemoryId: null,
      confidence: 0.7,
      reason: "This is a separate event.",
      replacementText: "I visited Paris again.",
      unexpected: true,
    }).success,
    false,
  );
  assert.equal(MemoryWriteDecisionJsonSchema.additionalProperties, false);
});

test("enforces conservative memory write action invariants", () => {
  const base = {
    confidence: 0.9,
    reason: "Same memory.",
    replacementText: "I prefer tea.",
  };
  for (const decision of [
    { ...base, action: "create", matchedMemoryId: "mem_1" },
    { ...base, action: "update", matchedMemoryId: null },
    { ...base, action: "unchanged", matchedMemoryId: null },
    {
      ...base,
      action: "update",
      matchedMemoryId: "mem_1",
      confidence: 0.84,
    },
    {
      ...base,
      action: "unchanged",
      matchedMemoryId: "mem_1",
      confidence: 0.84,
    },
  ]) {
    assert.equal(MemoryWriteDecisionSchema.safeParse(decision).success, false);
  }

  assert.equal(
    MemoryWriteDecisionSchema.safeParse({
      ...base,
      action: "create",
      matchedMemoryId: null,
      confidence: 0.2,
    }).success,
    true,
  );
});
