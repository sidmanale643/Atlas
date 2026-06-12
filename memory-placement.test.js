import assert from "node:assert/strict";
import test from "node:test";

import { REGION_ANCHORS } from "./region-anchors.js";
import {
  calculateMemoryPosition,
  calculateRegionPosition,
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

test("keeps nodes inside the dominant region anchor", () => {
  const anchor = REGION_ANCHORS.prefrontal.position;
  const position = calculateMemoryPosition("mem_inside", regions);
  const distance = (point) => Math.hypot(...point);

  assert.ok(distance(position) < distance(anchor));
});

test("keeps every region's memory positions inside its anchor", () => {
  const distance = (point) => Math.hypot(...point);

  for (const [region, anchor] of Object.entries(REGION_ANCHORS)) {
    for (let index = 0; index < 100; index += 1) {
      const position = calculateRegionPosition(`${region}-${index}`, region);

      assert.ok(
        distance(position) < distance(anchor.position),
        `${region} memory ${index} escaped its anchor`,
      );
    }
  }
});

test("stores one ordered node per activated region", () => {
  const state = createMemoryNodeState([{ id: "mem_state", regions }]);

  assert.deepEqual(state.get("mem_state"), {
    dominantRegion: "prefrontal",
    position: calculateMemoryPosition("mem_state", regions),
    nodes: [
      {
        region: "prefrontal",
        weight: 0.65,
        isPrimary: true,
        position: calculateRegionPosition("mem_state", "prefrontal"),
      },
      {
        region: "hippocampus",
        weight: 0.35,
        isPrimary: false,
        position: calculateRegionPosition("mem_state", "hippocampus"),
      },
    ],
  });
});

test("keeps every constellation node near its own region", () => {
  const state = createMemoryNodeState([
    {
      id: "mem_constellation",
      regions: [
        { region: "hippocampus", weight: 0.5 },
        { region: "amygdala", weight: 0.2 },
        { region: "temporalCortex", weight: 0.2 },
        { region: "prefrontal", weight: 0.1 },
      ],
    },
  ]).get("mem_constellation");

  assert.equal(state.nodes.length, 4);
  for (const node of state.nodes) {
    assert.deepEqual(
      node.position,
      calculateRegionPosition("mem_constellation", node.region),
    );
  }
});

test("constellation ordering is stable when activations arrive reordered", () => {
  const memory = { id: "mem_ordered", regions };
  const first = createMemoryNodeState([memory]).get(memory.id);
  const second = createMemoryNodeState([
    { ...memory, regions: [...regions].reverse() },
  ]).get(memory.id);

  assert.deepEqual(first, second);
});

test("omits memories without a known region anchor", () => {
  const state = createMemoryNodeState([
    { id: "mem_unknown", regions: [{ region: "unknown", weight: 1 }] },
  ]);

  assert.equal(state.size, 0);
});
