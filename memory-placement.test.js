import assert from "node:assert/strict";
import test from "node:test";

import { REGION_ANCHORS } from "./region-anchors.js";
import {
  calculateMemoryPosition,
  createMemoryNodeState,
  getDominantRegion,
} from "./memory-placement.js";

const regions = [
  { region: "hippocampus", weight: 0.35 },
  { region: "prefrontal", weight: 0.65 },
];

test("uses the highest-weight region as the dominant anchor", () => {
  assert.equal(getDominantRegion(regions), "prefrontal");
});

test("returns the same position for the same memory after reload", () => {
  const first = calculateMemoryPosition("mem_stable", regions);
  const second = calculateMemoryPosition("mem_stable", [...regions].reverse());

  assert.deepEqual(first, second);
});

test("separates memories that share a dominant anchor without insertion order", () => {
  const first = calculateMemoryPosition("mem_first", regions);
  const second = calculateMemoryPosition("mem_second", regions);

  assert.notDeepEqual(first, second);

  const before = createMemoryNodeState([
    { id: "mem_first", regions },
    { id: "mem_second", regions },
  ]);
  const after = createMemoryNodeState([
    { id: "mem_new", regions },
    { id: "mem_second", regions },
    { id: "mem_first", regions },
  ]);

  assert.deepEqual(
    after.get("mem_first").position,
    before.get("mem_first").position,
  );
  assert.deepEqual(
    after.get("mem_second").position,
    before.get("mem_second").position,
  );
});

test("places nodes farther from the brain origin than the dominant anchor", () => {
  const anchor = REGION_ANCHORS.prefrontal.position;
  const position = calculateMemoryPosition("mem_outside", regions);
  const distance = (point) => Math.hypot(...point);

  assert.ok(distance(position) > distance(anchor));
});

test("stores dominant region and calculated position in memory-node state", () => {
  const state = createMemoryNodeState([{ id: "mem_state", regions }]);

  assert.deepEqual(state.get("mem_state"), {
    dominantRegion: "prefrontal",
    position: calculateMemoryPosition("mem_state", regions),
  });
});

test("omits memories without a known region anchor", () => {
  const state = createMemoryNodeState([
    { id: "mem_unknown", regions: [{ region: "unknown", weight: 1 }] },
  ]);

  assert.equal(state.size, 0);
});
