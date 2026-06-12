import assert from "node:assert/strict";
import test from "node:test";

import {
  REGION_MAPPING_VERSION,
  mapExtractionToRegions,
} from "./region-mapper.js";

function extraction(overrides = {}) {
  return {
    types: [],
    emotions: [],
    actions: [],
    ...overrides,
  };
}

function weightFor(activations, region) {
  return activations.find((activation) => activation.region === region)?.weight || 0;
}

function assertNormalized(activations) {
  const sum = activations.reduce((total, activation) => total + activation.weight, 0);
  assert.ok(Math.abs(sum - 1) < 1e-12);
  assert.ok(activations.every(({ weight }) => weight >= 0 && weight <= 1));
}

test("exports mapping version 1", () => {
  assert.equal(REGION_MAPPING_VERSION, 1);
});

test("semantic memory activates temporal and association cortex", () => {
  const activations = mapExtractionToRegions(
    extraction({ types: [{ type: "semantic", weight: 0.8 }] })
  );

  assert.equal(activations[0].region, "temporalCortex");
  assert.ok(weightFor(activations, "associationCortex") > 0);
  assertNormalized(activations);
});

test("episodic memory activates hippocampus and prefrontal cortex", () => {
  const activations = mapExtractionToRegions(
    extraction({ types: [{ type: "episodic", weight: 1 }] })
  );

  assert.equal(activations[0].region, "hippocampus");
  assert.ok(weightFor(activations, "prefrontal") > 0);
  assertNormalized(activations);
});

test("emotion intensity and arousal add amygdala and insula activation", () => {
  const base = extraction({
    types: [{ type: "episodic", weight: 0.7 }],
  });
  const emotional = extraction({
    ...base,
    emotions: [{ intensity: 0.8, arousal: 0.75 }],
  });

  const baseActivations = mapExtractionToRegions(base);
  const emotionalActivations = mapExtractionToRegions(emotional);

  assert.equal(weightFor(baseActivations, "amygdala"), 0);
  assert.ok(weightFor(emotionalActivations, "amygdala") > 0);
  assert.ok(weightFor(emotionalActivations, "insula") > 0);
  assert.ok(emotionalActivations.length > 1);
  assertNormalized(emotionalActivations);
});

test("a clear physical action adds motor cortex activation", () => {
  const activations = mapExtractionToRegions(
    extraction({
      types: [{ type: "episodic", weight: 0.5 }],
      actions: ["ran through the park"],
    })
  );

  assert.ok(weightFor(activations, "motorCortex") > 0);
  assertNormalized(activations);
});

test("mapping is repeatable and sorted by descending weight", () => {
  const input = extraction({
    types: [
      { type: "episodic", weight: 0.5 },
      { type: "emotional", weight: 0.3 },
      { type: "spatial", weight: 0.2 },
    ],
    emotions: [{ intensity: 0.6, arousal: 0.4 }],
    actions: ["walked home"],
  });

  const first = mapExtractionToRegions(input);
  const second = mapExtractionToRegions(input);

  assert.deepEqual(first, second);
  assert.ok(first.every((item, index) => index === 0 || first[index - 1].weight >= item.weight));
  assertNormalized(first);
});

test("zero-signal extraction returns no activations", () => {
  assert.deepEqual(mapExtractionToRegions(extraction()), []);
});

test("removes contributions below the documented threshold", () => {
  const activations = mapExtractionToRegions(
    extraction({ types: [{ type: "semantic", weight: 0.02 }] })
  );

  assert.deepEqual(activations, [{ region: "temporalCortex", weight: 1 }]);
});
