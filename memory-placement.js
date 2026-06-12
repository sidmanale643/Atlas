import { getRegionAnchor } from "./region-anchors.js";

const MIN_SURFACE_CLEARANCE = 0.34;
const SURFACE_CLEARANCE_RANGE = 0.12;
const MIN_TANGENT_OFFSET = 0.12;
const TANGENT_OFFSET_RANGE = 0.3;

export function getDominantRegion(regions) {
  let dominant = null;

  for (const activation of regions || []) {
    if (
      !getRegionAnchor(activation.region) ||
      !Number.isFinite(activation.weight)
    ) {
      continue;
    }

    if (!dominant || activation.weight > dominant.weight) {
      dominant = activation;
    }
  }

  return dominant?.region || null;
}

export function calculateMemoryPosition(memoryId, regions) {
  const dominantRegion = getDominantRegion(regions);
  const anchor = getRegionAnchor(dominantRegion);
  if (!anchor) return null;

  const outward = normalize(anchor.position);
  const reference =
    Math.abs(outward[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const tangentA = normalize(cross(outward, reference));
  const tangentB = cross(outward, tangentA);

  const angle = hashUnit(`${memoryId}:angle`) * Math.PI * 2;
  const tangentDistance =
    MIN_TANGENT_OFFSET + hashUnit(`${memoryId}:distance`) * TANGENT_OFFSET_RANGE;
  const clearance =
    MIN_SURFACE_CLEARANCE +
    hashUnit(`${memoryId}:clearance`) * SURFACE_CLEARANCE_RANGE;
  const tangentX = Math.cos(angle) * tangentDistance;
  const tangentY = Math.sin(angle) * tangentDistance;

  return anchor.position.map(
    (coordinate, index) =>
      coordinate +
      outward[index] * clearance +
      tangentA[index] * tangentX +
      tangentB[index] * tangentY,
  );
}

export function createMemoryNodeState(memories) {
  const state = new Map();

  for (const memory of memories) {
    const dominantRegion = getDominantRegion(memory.regions);
    const position = calculateMemoryPosition(memory.id, memory.regions);
    if (!dominantRegion || !position) continue;

    state.set(memory.id, { dominantRegion, position });
  }

  return state;
}

function hashUnit(value) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) / 4294967296;
}

function normalize(vector) {
  const length = Math.hypot(...vector);
  return vector.map((value) => value / length);
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
