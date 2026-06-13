import assert from "node:assert/strict";
import test from "node:test";

import { REGION_NAMES } from "../src/shared/region-mapper.js";
import {
  REGION_ANCHORS,
  REGION_COLORS,
  getRegionAnchor,
} from "../src/shared/region-anchors.js";

test("defines one frontend anchor for every mapped region", () => {
  assert.deepEqual(Object.keys(REGION_ANCHORS).sort(), [...REGION_NAMES].sort());
});

test("anchors have labels, roles, colors, scales, and fixed positions", () => {
  for (const region of REGION_NAMES) {
    const anchor = getRegionAnchor(region);

    assert.equal(typeof anchor.label, "string");
    assert.equal(typeof anchor.role, "string");
    assert.ok(anchor.role.length > 0);
    assert.match(anchor.color, /^#[0-9a-f]{6}$/i);
    assert.ok(anchor.markerScale > 0);
    assert.equal(anchor.position.length, 3);
    assert.ok(anchor.position.every(Number.isFinite));
    assert.notDeepEqual(anchor.position, [0, 0, 0]);
  }
});

test("uses the fixed anatomical region palette", () => {
  assert.deepEqual(REGION_COLORS, {
    hippocampus: "#ffd38a",
    prefrontal: "#8edfff",
    amygdala: "#ff8fa8",
    temporalCortex: "#b9a7ff",
    parietalCortex: "#7ee8d3",
    basalGanglia: "#978cff",
    cerebellum: "#9ce4ba",
    motorCortex: "#ffad8a",
    insula: "#e99fd1",
    associationCortex: "#d9e4e8",
    entorhinal: "#80d8d0",
  });
});

test("defines the hippocampus as one bilateral region", () => {
  const hippocampus = getRegionAnchor("hippocampus");

  assert.deepEqual(hippocampus.position, [0, -0.85, 0.8]);
  assert.deepEqual(hippocampus.hemispherePositions, {
    left: [-0.93, -0.85, 0.8],
    right: [0.93, -0.85, 0.8],
  });
});
