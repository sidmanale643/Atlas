import assert from "node:assert/strict";
import test from "node:test";

import { REGION_NAMES } from "./region-mapper.js";
import { REGION_ANCHORS, getRegionAnchor } from "./region-anchors.js";

test("defines one frontend anchor for every mapped region", () => {
  assert.deepEqual(Object.keys(REGION_ANCHORS).sort(), [...REGION_NAMES].sort());
});

test("anchors have labels, colors, scales, and fixed non-origin positions", () => {
  for (const region of REGION_NAMES) {
    const anchor = getRegionAnchor(region);

    assert.equal(typeof anchor.label, "string");
    assert.match(anchor.color, /^#[0-9a-f]{6}$/i);
    assert.ok(anchor.markerScale > 0);
    assert.equal(anchor.position.length, 3);
    assert.ok(anchor.position.every(Number.isFinite));
    assert.notDeepEqual(anchor.position, [0, 0, 0]);
  }
});
