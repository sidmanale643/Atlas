import { getRegionAnchor } from "./region-anchors.js";

const MIN_REGION_INSET = 0.34;
const REGION_INSET_RANGE = 0.14;
const MIN_TANGENT_OFFSET = 0.04;
const TANGENT_OFFSET_RANGE = 0.14;

export function getDominantRegion(regions) {
  let dominant = null;

  for (const activation of regions || []) {
    if (
      !getRegionAnchor(activation.region) ||
      !Number.isFinite(activation.weight)
    ) {
      continue;
    }

    if (
      !dominant ||
      activation.weight > dominant.weight ||
      (activation.weight === dominant.weight &&
        activation.region.localeCompare(dominant.region) < 0)
    ) {
      dominant = activation;
    }
  }

  return dominant?.region || null;
}

export function calculateMemoryPosition(memoryId, regions) {
  const dominantRegion = getDominantRegion(regions);
  return calculateRegionPosition(memoryId, dominantRegion);
}

export function calculateRegionPosition(memoryId, region) {
  const anchor = getRegionAnchor(region);
  if (!anchor) return null;

  const outward = normalize(anchor.position);
  const reference =
    Math.abs(outward[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const tangentA = normalize(cross(outward, reference));
  const tangentB = cross(outward, tangentA);

  const angle = hashUnit(`${memoryId}:${region}:angle`) * Math.PI * 2;
  const tangentDistance =
    MIN_TANGENT_OFFSET +
    hashUnit(`${memoryId}:${region}:distance`) * TANGENT_OFFSET_RANGE;
  const inset =
    MIN_REGION_INSET +
    hashUnit(`${memoryId}:${region}:inset`) * REGION_INSET_RANGE;
  const tangentX = Math.cos(angle) * tangentDistance;
  const tangentY = Math.sin(angle) * tangentDistance;

  return anchor.position.map(
    (coordinate, index) =>
      coordinate +
      outward[index] * -inset +
      tangentA[index] * tangentX +
      tangentB[index] * tangentY,
  );
}

export function createMemoryNodeState(memories) {
  const state = new Map();

  for (const memory of memories) {
    const activations = (memory.regions || [])
      .filter(
        ({ region, weight }) =>
          getRegionAnchor(region) && Number.isFinite(weight) && weight > 0,
      )
      .sort(
        (a, b) => b.weight - a.weight || a.region.localeCompare(b.region),
      );
    const dominantRegion = activations[0]?.region;
    if (!dominantRegion) continue;

    const normalizedActivations = activations.map(({ region, weight }, index) => ({
      region,
      weight,
      isDominant: index === 0,
    }));

    state.set(memory.id, {
      core: {
        region: dominantRegion,
        weight: normalizedActivations[0].weight,
        position: calculateMemoryPosition(memory.id, activations),
      },
      activations: normalizedActivations,
    });
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
