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
  const dominantActivation = (regions || []).find(
    ({ region }) => region === dominantRegion,
  );
  return calculateRegionPosition(
    memoryId,
    dominantRegion,
    getActivationAnchorPosition(dominantActivation),
  );
}

export function calculateRegionPosition(memoryId, region, positionOverride) {
  const anchor = getRegionAnchor(region);
  if (!anchor) return null;
  const anchorPosition = positionOverride || anchor.position;

  const outward = normalize(anchorPosition);
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

  const position = anchorPosition.map(
    (coordinate, index) =>
      coordinate +
      outward[index] * -inset +
      tangentA[index] * tangentX +
      tangentB[index] * tangentY,
  );

  return clampToBrainBoundary(position);
}

function getActivationAnchorPosition(activation) {
  if (activation?.region !== "hippocampus") return null;

  const anchor = getRegionAnchor("hippocampus");
  const { left, right } = activation.hemispheres || {};
  const total = left + right;
  if (
    !anchor?.hemispherePositions
    || !Number.isFinite(left)
    || !Number.isFinite(right)
    || total <= 0
  ) {
    return anchor?.position || null;
  }

  const leftShare = left / total;
  const rightShare = right / total;
  return anchor.hemispherePositions.left.map(
    (coordinate, index) =>
      coordinate * leftShare
      + anchor.hemispherePositions.right[index] * rightShare,
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

    const normalizedActivations = activations.map(
      ({ region, weight, hemispheres }, index) => ({
        region,
        weight,
        ...(hemispheres ? { hemispheres } : {}),
        isDominant: index === 0,
      }),
    );

    state.set(memory.id, {
      core: {
        region: dominantRegion,
        weight: normalizedActivations[0].weight,
        ...(normalizedActivations[0].hemispheres
          ? { hemispheres: normalizedActivations[0].hemispheres }
          : {}),
        position: calculateMemoryPosition(memory.id, activations),
      },
      activations: normalizedActivations,
    });
  }

  return state;
}

const BRAIN_RADIUS = 1.95;

function clampToBrainBoundary(position) {
  const length = Math.hypot(...position);
  if (length <= BRAIN_RADIUS) return position;
  const scale = BRAIN_RADIUS / length;
  return position.map((v) => v * scale);
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
