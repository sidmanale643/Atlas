import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEntitySpokes,
  calculateEntityHubPosition,
  calculateRelationshipPreviewPosition,
  filterEntityGraphMemories,
  getRelationshipCounterpart,
  getRelationshipDirection,
  pushNavigation,
  restoreNavigation,
} from "./entity-lens.js";

test("entity hub and relationship preview positions are deterministic", () => {
  const origin = [0.8, 0.4, 1.2];
  const first = calculateEntityHubPosition(origin, 42);
  const second = calculateEntityHubPosition(origin, 42);
  const other = calculateEntityHubPosition(origin, 43);

  assert.deepEqual(first, second);
  assert.notDeepEqual(first, other);
  assert.ok(Math.hypot(...first) > Math.hypot(...origin));

  assert.deepEqual(
    calculateRelationshipPreviewPosition(first, 7, "outgoing"),
    calculateRelationshipPreviewPosition(first, 7, "outgoing"),
  );
  assert.notDeepEqual(
    calculateRelationshipPreviewPosition(first, 7, "outgoing"),
    calculateRelationshipPreviewPosition(first, 7, "incoming"),
  );
});

test("entity graph visibility and spokes deduplicate memories", () => {
  const graph = {
    entity: { id: 2 },
    memories: [
      { id: "mem_a" },
      { id: "mem_a" },
      { id: "mem_b" },
      { id: "mem_c" },
    ],
  };
  const visibleIds = new Set(["mem_a", "mem_c"]);

  assert.deepEqual(filterEntityGraphMemories(graph, visibleIds), {
    visible: [{ id: "mem_a" }, { id: "mem_c" }],
    hidden: 1,
    total: 3,
  });
  assert.deepEqual(buildEntitySpokes(graph, visibleIds), {
    spokes: [
      { id: "2:mem_a", entityId: 2, memoryId: "mem_a" },
      { id: "2:mem_c", entityId: 2, memoryId: "mem_c" },
    ],
    hidden: 1,
    total: 3,
  });
});

test("relationship direction and counterpart follow the active entity", () => {
  const relationship = {
    source: { id: 4, canonical_name: "Maya" },
    target: { id: 9, canonical_name: "Museum" },
  };

  assert.equal(getRelationshipDirection(relationship, 4), "outgoing");
  assert.equal(getRelationshipDirection(relationship, 9), "incoming");
  assert.equal(getRelationshipDirection(relationship, 3), null);
  assert.equal(
    getRelationshipCounterpart(relationship, 4).canonical_name,
    "Museum",
  );
  assert.equal(
    getRelationshipCounterpart(relationship, 9).canonical_name,
    "Maya",
  );
});

test("breadcrumb restoration truncates future navigation", () => {
  let history = [];
  history = pushNavigation(history, {
    type: "memory",
    id: "mem_a",
    label: "First memory",
  });
  history = pushNavigation(history, {
    type: "entity",
    id: 4,
    label: "Maya",
    originMemoryId: "mem_a",
  });
  history = pushNavigation(history, {
    type: "memory",
    id: "mem_b",
    label: "Second memory",
  });
  history = pushNavigation(history, {
    type: "memory",
    id: "mem_b",
    label: "Second memory",
  });

  assert.equal(history.length, 3);
  assert.deepEqual(restoreNavigation(history, 1), {
    history: history.slice(0, 2),
    current: history[1],
  });
  assert.deepEqual(restoreNavigation(history, 99), {
    history,
    current: null,
  });
});
