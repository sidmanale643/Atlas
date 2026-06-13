import assert from "node:assert/strict";
import test from "node:test";

import {
  CORE_BRAIN_REGIONS,
  getSurfaceBrainRegion,
} from "../src/shared/brain-regions.js";

test("defines the requested core brain regions", () => {
  assert.deepEqual(CORE_BRAIN_REGIONS, [
    "hippocampus",
    "prefrontal",
    "temporalCortex",
    "parietalCortex",
    "amygdala",
    "basalGanglia",
    "cerebellum",
    "motorCortex",
    "insula",
  ]);
});

test("maps representative surface points to their anatomical zones", () => {
  assert.equal(getSurfaceBrainRegion([0, 0.3, 2]), "prefrontal");
  assert.equal(getSurfaceBrainRegion([1.8, -0.6, 0.3]), "temporalCortex");
  assert.equal(getSurfaceBrainRegion([0, 1.5, -1.2]), "parietalCortex");
  assert.equal(getSurfaceBrainRegion([0, -1.8, -1.7]), "cerebellum");
  assert.equal(getSurfaceBrainRegion([0, 1.4, 0.2]), "motorCortex");
});
