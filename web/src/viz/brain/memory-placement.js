import { getRegionAnchor } from "./region-anchors.js";

// Scatter is expressed as a fraction of each region's measured radius so the
// cluster fits *inside* the region volume regardless of how the brain model
// was scaled. These were back-derived from the previous fixed offsets
// (MIN_REGION_INSET 0.34, range 0.14; tangent 0.04, range 0.14) assuming a
// ~1.0 unit region radius, then tuned to sit comfortably within the volume.
const INSET_FRACTION_MIN = 0.18;
const INSET_FRACTION_RANGE = 0.22;
const TANGENT_FRACTION_MIN = 0.08;
const TANGENT_FRACTION_RANGE = 0.32;

// Fallback radius used before the anatomical model has loaded (or for regions
// we could not measure). Keeps the pre-load layout roughly consistent with the
// hardcoded anchor coordinate space.
const FALLBACK_REGION_RADIUS = 1.0;
// Soft outer safety clamp so a mis-measured (huge) radius can never fling a
// memory far outside the brain. Generous, only catches bad data.
const MAX_SCATTER_RADIUS = 2.2;

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

/**
 * Resolves the anchor position to use for a region.
 *
 * When `regionPositions` is supplied (the measured centers from the loaded
 * anatomical model), the real center is preferred so memories land inside the
 * actual mesh. The hardcoded REGION_ANCHORS positions are only a fallback for
 * the pre-load window or for regions that could not be measured.
 */
function resolveAnchorPosition(region, regionPositions) {
  const measured = regionPositions?.get(region);
  if (measured?.center) return { position: measured.center, radius: measured.radius };
  const anchor = getRegionAnchor(region);
  if (!anchor) return null;
  return { position: anchor.position, radius: FALLBACK_REGION_RADIUS };
}

function resolveHippocampusPosition(activation, regionPositions) {
  if (activation?.region !== "hippocampus") return null;

  const anchor = getRegionAnchor("hippocampus");
  const measured = regionPositions?.get("hippocampus");
  const { left, right } = activation.hemispheres || {};

  // Prefer the measured hemisphere centers from the loaded model.
  if (measured?.left && measured?.right && Number.isFinite(left) && Number.isFinite(right)) {
    const total = left + right;
    if (total > 0) {
      const leftShare = left / total;
      const rightShare = right / total;
      return {
        position: measured.left.map(
          (coordinate, index) =>
            coordinate * leftShare + measured.right[index] * rightShare,
        ),
        radius: measured.radius,
      };
    }
  }

  // Fallback to the hardcoded hemisphere anchors.
  if (
    anchor?.hemispherePositions &&
    Number.isFinite(left) &&
    Number.isFinite(right)
  ) {
    const total = left + right;
    if (total > 0) {
      const leftShare = left / total;
      const rightShare = right / total;
      return {
        position: anchor.hemispherePositions.left.map(
          (coordinate, index) =>
            coordinate * leftShare
            + anchor.hemispherePositions.right[index] * rightShare,
        ),
        radius: FALLBACK_REGION_RADIUS,
      };
    }
  }

  return null;
}

export function calculateMemoryPosition(memoryId, regions, regionPositions) {
  const dominantRegion = getDominantRegion(regions);
  const dominantActivation = (regions || []).find(
    ({ region }) => region === dominantRegion,
  );

  const override = resolveHippocampusPosition(dominantActivation, regionPositions);
  return calculateRegionPosition(
    memoryId,
    dominantRegion,
    override,
    regionPositions,
  );
}

export function calculateRegionPosition(
  memoryId,
  region,
  positionOverride,
  regionPositions,
) {
  const resolved =
    positionOverride || resolveAnchorPosition(region, regionPositions);
  if (!resolved) return null;

  const anchorPosition = resolved.position;
  // Cap the radius so a bad measurement can't scatter memories far outside.
  const regionRadius = Math.min(
    Number.isFinite(resolved.radius) ? resolved.radius : FALLBACK_REGION_RADIUS,
    MAX_SCATTER_RADIUS,
  );

  const outward = normalize(anchorPosition);
  const reference =
    Math.abs(outward[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const tangentA = normalize(cross(outward, reference));
  const tangentB = cross(outward, tangentA);

  const angle = hashUnit(`${memoryId}:${region}:angle`) * Math.PI * 2;
  // Scatter offsets scale with the region's real extent so the cluster stays
  // inside the region volume rather than spilling past the brain surface.
  const tangentDistance =
    (TANGENT_FRACTION_MIN
      + hashUnit(`${memoryId}:${region}:distance`) * TANGENT_FRACTION_RANGE)
    * regionRadius;
  const inset =
    (INSET_FRACTION_MIN
      + hashUnit(`${memoryId}:${region}:inset`) * INSET_FRACTION_RANGE)
    * regionRadius;
  const tangentX = Math.cos(angle) * tangentDistance;
  const tangentY = Math.sin(angle) * tangentDistance;

  return anchorPosition.map(
    (coordinate, index) =>
      coordinate +
      outward[index] * -inset +
      tangentA[index] * tangentX +
      tangentB[index] * tangentY,
  );
}

export function createMemoryNodeState(memories, regionPositions) {
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
        position: calculateMemoryPosition(memory.id, activations, regionPositions),
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
