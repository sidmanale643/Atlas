import assert from "node:assert/strict";
import test from "node:test";

import {
  getHippocampalLaterality,
  getRegionContributions,
  REGION_MAPPING_VERSION,
  mapExtractionToRegions,
} from "../src/shared/region-mapper.js";

function extraction(overrides = {}) {
  return {
    types: [],
    emotions: [],
    actions: [],
    contentCues: [],
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

test("exports mapping version 2", () => {
  assert.equal(REGION_MAPPING_VERSION, 2);
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
  assert.equal(
    activations[0].hemispheres.left,
    activations[0].hemispheres.right,
  );
  assertNormalized(activations);
});

test("balances old extractions without content cues", () => {
  const input = extraction({ types: [{ type: "episodic", weight: 1 }] });
  delete input.contentCues;

  assert.deepEqual(getHippocampalLaterality(input), {
    leftShare: 0.5,
    rightShare: 0.5,
    verbalSignal: 0,
    spatialSignal: 0,
    cues: [],
  });
});

test("verbal evidence modestly biases hippocampal activation left", () => {
  const activations = mapExtractionToRegions(
    extraction({
      types: [{ type: "episodic", weight: 1 }],
      contentCues: [{
        kind: "verbal",
        weight: 1,
        confidence: 1,
        evidence: "what Maya said",
      }],
    }),
  );
  const hippocampus = activations.find(({ region }) => region === "hippocampus");

  assert.ok(hippocampus.hemispheres.left > hippocampus.hemispheres.right);
  assert.ok(
    Math.abs(
      hippocampus.hemispheres.left + hippocampus.hemispheres.right
        - hippocampus.weight,
    ) < 1e-12,
  );
});

test("spatial evidence modestly biases hippocampal activation right", () => {
  const laterality = getHippocampalLaterality(
    extraction({
      types: [{ type: "spatial", weight: 1 }],
      contentCues: [{
        kind: "spatial",
        weight: 1,
        confidence: 1,
        evidence: "turn left at the station",
      }],
    }),
  );

  assert.deepEqual(
    { left: laterality.leftShare, right: laterality.rightShare },
    { left: 0.35, right: 0.65 },
  );
});

test("competing verbal and spatial evidence moves laterality toward bilateral", () => {
  const laterality = getHippocampalLaterality(
    extraction({
      types: [{ type: "spatial", weight: 0.8 }],
      contentCues: [
        {
          kind: "verbal",
          weight: 0.8,
          confidence: 1,
          evidence: "the exact directions",
        },
        {
          kind: "spatial",
          weight: 0.8,
          confidence: 1,
          evidence: "the route through town",
        },
      ],
    }),
  );

  assert.equal(laterality.leftShare, 0.5);
  assert.equal(laterality.rightShare, 0.5);
});

test("hippocampal laterality never exceeds the 35/65 bounds", () => {
  for (const kind of ["verbal", "spatial"]) {
    const laterality = getHippocampalLaterality(
      extraction({
        contentCues: [{
          kind,
          weight: 1,
          confidence: 1,
          evidence: "strong evidence",
        }],
      }),
    );

    assert.ok(laterality.leftShare >= 0.35 && laterality.leftShare <= 0.65);
    assert.ok(laterality.rightShare >= 0.35 && laterality.rightShare <= 0.65);
  }
});

test("zero-strength cues do not appear as laterality evidence", () => {
  const laterality = getHippocampalLaterality(
    extraction({
      contentCues: [{
        kind: "verbal",
        weight: 1,
        confidence: 0,
        evidence: "unsupported words",
      }],
    }),
  );

  assert.deepEqual(laterality.cues, []);
  assert.equal(laterality.leftShare, 0.5);
  assert.equal(laterality.rightShare, 0.5);
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

test("reports the inputs that contributed to each region", () => {
  const contributions = getRegionContributions(
    extraction({
      types: [{ type: "episodic", weight: 0.7 }],
      emotions: [{
        label: "joy",
        intensity: 0.8,
        arousal: 0.5,
        confidence: 0.9,
      }],
      actions: ["ran through the park"],
    })
  );

  const hippocampus = contributions.find(
    ({ region, source }) => region === "hippocampus" && source === "type"
  );
  assert.equal(hippocampus.type, "episodic");
  assert.equal(hippocampus.typeWeight, 0.7);
  assert.equal(hippocampus.ruleWeight, 0.65);
  assert.ok(Math.abs(hippocampus.amount - 0.455) < 1e-12);
  assert.equal(
    contributions.find(
      ({ region, source }) => region === "amygdala" && source === "emotion"
    ).confidence,
    0.9
  );
  assert.equal(
    contributions.find(({ source }) => source === "action").action,
    "ran through the park"
  );
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
