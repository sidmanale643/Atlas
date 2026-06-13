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
    after.get("mem_first").core.position,
    before.get("mem_first").core.position,
  );
  assert.deepEqual(
    after.get("mem_second").core.position,
    before.get("mem_second").core.position,
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

test("stores one canonical core and ordered region activations", () => {
  const state = createMemoryNodeState([{ id: "mem_state", regions }]);

  assert.deepEqual(state.get("mem_state"), {
    core: {
      region: "prefrontal",
      weight: 0.65,
      position: calculateMemoryPosition("mem_state", regions),
    },
    activations: [
      {
        region: "prefrontal",
        weight: 0.65,
        isDominant: true,
      },
      {
        region: "hippocampus",
        weight: 0.35,
        isDominant: false,
      },
    ],
  });
});

test("keeps one core regardless of how many regions participate", () => {
  const state = createMemoryNodeState([
    {
      id: "mem_multi_region",
      regions: [
        { region: "hippocampus", weight: 0.5 },
        { region: "amygdala", weight: 0.2 },
        { region: "temporalCortex", weight: 0.2 },
        { region: "prefrontal", weight: 0.1 },
      ],
    },
  ]).get("mem_multi_region");

  assert.equal(Object.hasOwn(state, "core"), true);
  assert.equal(state.activations.length, 4);
  assert.deepEqual(
    state.core.position,
    calculateMemoryPosition("mem_multi_region", [
      { region: "hippocampus", weight: 0.5 },
      { region: "amygdala", weight: 0.2 },
      { region: "temporalCortex", weight: 0.2 },
      { region: "prefrontal", weight: 0.1 },
    ]),
  );
});

test("activation ordering is stable when regions arrive reordered", () => {
  const memory = { id: "mem_ordered", regions };
  const first = createMemoryNodeState([memory]).get(memory.id);
  const second = createMemoryNodeState([
    { ...memory, regions: [...regions].reverse() },
  ]).get(memory.id);

  assert.deepEqual(first, second);
});

test("represents swimming as one core with three weighted footprints", () => {
  const swimmingRegions = [
    { region: "basalGanglia", weight: 0.45 },
    { region: "cerebellum", weight: 0.35 },
    { region: "motorCortex", weight: 0.2 },
  ];
  const state = createMemoryNodeState([
    { id: "mem_swimming", regions: swimmingRegions },
  ]).get("mem_swimming");

  assert.equal(state.core.region, "basalGanglia");
  assert.equal(state.core.weight, 0.45);
  assert.deepEqual(state.activations, [
    { region: "basalGanglia", weight: 0.45, isDominant: true },
    { region: "cerebellum", weight: 0.35, isDominant: false },
    { region: "motorCortex", weight: 0.2, isDominant: false },
  ]);
});

test("omits memories without a known region anchor", () => {
  const state = createMemoryNodeState([
    { id: "mem_unknown", regions: [{ region: "unknown", weight: 1 }] },
  ]);

  assert.equal(state.size, 0);
});
