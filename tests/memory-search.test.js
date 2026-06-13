import test from "node:test";
import assert from "node:assert/strict";
import {
  filterMemoriesForSearch,
  matchesMemorySearch,
} from "../src/shared/memory-search.js";

const memory = {
  text: "Met a friend at the station",
  summary: "An evening train journey",
  entities: [
    { canonical_name: "Maya Patel", mention: "Maya" },
  ],
  extraction: {
    entities: [
      { canonicalName: "Central Railway Station", mention: "the station" },
    ],
  },
};

test("search matches raw memory text and summaries case-insensitively", () => {
  assert.equal(matchesMemorySearch(memory, "FRIEND"), true);
  assert.equal(matchesMemorySearch(memory, "evening journey"), true);
});

test("search matches canonical entity names from stored and extracted entities", () => {
  assert.equal(matchesMemorySearch(memory, "maya patel"), true);
  assert.equal(matchesMemorySearch(memory, "central railway"), true);
});

test("all search terms must match and blank searches include every memory", () => {
  assert.equal(matchesMemorySearch(memory, "maya train"), true);
  assert.equal(matchesMemorySearch(memory, "maya airport"), false);
  assert.equal(matchesMemorySearch(memory, "   "), true);
  assert.equal(matchesMemorySearch({ text: "Standalone memory" }, "standalone"), true);
});

test("semantic results preserve Qdrant order and compose with source filters", () => {
  const memories = [
    { id: "one", text: "First", source: "ui" },
    { id: "two", text: "Second", source: "mcp" },
    { id: "three", text: "Third", source: "ui" },
  ];

  assert.deepEqual(
    filterMemoriesForSearch(memories, {
      query: "conceptual query",
      semanticIds: ["three", "two", "missing", "one"],
    }).map((item) => item.id),
    ["three", "two", "one"],
  );
  assert.deepEqual(
    filterMemoriesForSearch(memories, {
      query: "conceptual query",
      source: "mcp",
      semanticIds: ["three", "two", "one"],
    }).map((item) => item.id),
    ["two"],
  );
});

test("search uses local text matching until semantic results are available", () => {
  const memories = [
    { id: "one", text: "Visited a museum", source: "ui" },
    { id: "two", text: "Cooked dinner", source: "ui" },
  ];

  assert.deepEqual(
    filterMemoriesForSearch(memories, {
      query: "museum",
      semanticIds: null,
    }).map((item) => item.id),
    ["one"],
  );
});
