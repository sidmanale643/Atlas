import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMemoryStructuralDiff,
  createMemoryComparisonInput,
  hashMemoryComparisonInput,
} from "../src/memory-comparison.js";

function memory(id, overrides = {}) {
  return {
    id,
    raw_text: `${id} text`,
    summary: `${id} summary`,
    source: "ui",
    ingestion_date: "2026-06-13T00:00:00.000Z",
    created_at: "2026-06-13T00:00:00.000Z",
    updated_at: "2026-06-13T00:00:00.000Z",
    extraction: {
      occurredAt: { text: "today", normalized: "2026-06-13" },
      types: [{ type: "episodic", weight: 0.8 }],
      entities: [],
      relationships: [],
      actions: [],
      topics: [],
      emotions: [{ label: "happy" }],
      salience: 0.9,
    },
    entities: [],
    relationships: [],
    regions: [],
    ...overrides,
  };
}

test("comparison input contains semantic fields but excludes neural metadata", () => {
  const input = createMemoryComparisonInput(memory("left", {
    regions: [{ region: "hippocampus", weight: 1 }],
  }));

  assert.equal(input.text, "left text");
  assert.deepEqual(input.types, [{ type: "episodic", weight: 0.8 }]);
  assert.equal("regions" in input, false);
  assert.equal("emotions" in input, false);
  assert.equal("salience" in input, false);
});

test("comparison hashes are stable and change with semantic inputs", () => {
  const left = memory("left");
  const right = memory("right");
  const first = hashMemoryComparisonInput(left, right);
  const reordered = hashMemoryComparisonInput(
    {
      ...left,
      extraction: {
        ...left.extraction,
        topics: ["zebra", "alpha"],
        actions: ["walk", "call"],
      },
    },
    right,
  );
  const sameReordered = hashMemoryComparisonInput(
    {
      ...left,
      extraction: {
        ...left.extraction,
        topics: ["alpha", "zebra"],
        actions: ["call", "walk"],
      },
    },
    right,
  );

  assert.equal(reordered, sameReordered);
  assert.notEqual(first, reordered);
  assert.notEqual(
    first,
    hashMemoryComparisonInput({ ...left, summary: "Changed summary" }, right),
  );
  assert.equal(
    first,
    hashMemoryComparisonInput(
      { ...left, regions: [{ region: "insula", weight: 1 }] },
      right,
    ),
  );
});

test("structural diff separates sets and computes region deltas", () => {
  const left = memory("left", {
    extraction: {
      ...memory("left").extraction,
      actions: ["called Maya"],
      topics: ["museum", "Maya"],
    },
    entities: [{ canonical_name: "Maya", kind: "person" }],
    regions: [{
      region: "hippocampus",
      weight: 0.6,
      hemispheres: { left: 0.35, right: 0.25 },
    }],
  });
  const right = memory("right", {
    extraction: {
      ...memory("right").extraction,
      actions: ["visited Maya"],
      topics: ["Maya", "travel"],
    },
    entities: [
      { canonical_name: "Maya", kind: "person" },
      { canonical_name: "Paris", kind: "place" },
    ],
    regions: [{
      region: "hippocampus",
      weight: 0.8,
      hemispheres: { left: 0.3, right: 0.5 },
    }],
  });

  const diff = buildMemoryStructuralDiff(left, right);
  assert.deepEqual(diff.topics, {
    shared: ["Maya"],
    leftOnly: ["museum"],
    rightOnly: ["travel"],
  });
  assert.equal(diff.entities.shared[0].name, "Maya");
  assert.equal(diff.entities.rightOnly[0].name, "Paris");
  assert.ok(Math.abs(diff.regions[0].delta.weight - 0.2) < 1e-12);
  assert.ok(
    Math.abs(diff.regions[0].delta.rightHemisphere - 0.25) < 1e-12,
  );
  assert.match(diff.activationAnalysis.summary, /left memory is weighted most/i);
  assert.ok(diff.activationAnalysis.findings.length > 0);
  assert.ok(diff.activationAnalysis.notes.some((note) => /not measured/.test(note)));
});

test("activation analysis explains type and emotion driven region shifts", () => {
  const left = memory("left", {
    extraction: {
      ...memory("left").extraction,
      types: [
        { type: "semantic", weight: 0.65 },
        { type: "emotional", weight: 0.35 },
      ],
      emotions: [{
        label: "love",
        intensity: 0.6,
        arousal: 0.4,
        confidence: 0.9,
      }],
    },
    regions: [
      { region: "temporalCortex", weight: 0.29 },
      { region: "amygdala", weight: 0.27 },
    ],
  });
  const right = memory("right", {
    extraction: {
      ...memory("right").extraction,
      types: [
        { type: "emotional", weight: 0.7 },
        { type: "semantic", weight: 0.3 },
      ],
      emotions: [{
        label: "hate",
        intensity: 0.7,
        arousal: 0.5,
        confidence: 0.9,
      }],
    },
    regions: [
      { region: "amygdala", weight: 0.43 },
      { region: "temporalCortex", weight: 0.12 },
    ],
  });

  const analysis = buildMemoryStructuralDiff(left, right).activationAnalysis;
  assert.match(analysis.summary, /semantic \(65%\)/i);
  assert.match(analysis.summary, /emotional \(70%\)/i);
  const amygdala = analysis.findings.find(
    ({ region }) => region === "amygdala",
  );
  assert.match(amygdala.explanation, /higher in the right memory/i);
  assert.ok(amygdala.rightReasons.some((reason) => /"hate"/.test(reason)));
});

test("structural diff tolerates missing extraction data", () => {
  const diff = buildMemoryStructuralDiff(
    memory("left", { extraction: null }),
    memory("right", { extraction: null }),
  );

  assert.deepEqual(diff.types, []);
  assert.deepEqual(diff.actions, {
    shared: [],
    leftOnly: [],
    rightOnly: [],
  });
});
