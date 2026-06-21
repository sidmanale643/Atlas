export const CORE_BRAIN_REGIONS = Object.freeze([
  "hippocampus",
  "prefrontal",
  "associationCortex",
  "temporalCortex",
  "parietalCortex",
  "amygdala",
  "basalGanglia",
  "cerebellum",
  "motorCortex",
  "insula",
  "entorhinal",
]);

// The legacy OBJ has no anatomical groups. This is therefore the single
// calibrated coordinate source for its surface masks, memory placement,
// connection targets, region hit areas, and deep-region proxies.
export const LEGACY_REGION_GEOMETRY = Object.freeze({
  hippocampus: Object.freeze({
    kind: "deep",
    center: Object.freeze([0, -0.85, 0.8]),
    radius: Object.freeze([0.65, 0.6, 0.9]),
    hemispheres: Object.freeze({
      left: Object.freeze([-0.93, -0.85, 0.8]),
      right: Object.freeze([0.93, -0.85, 0.8]),
    }),
  }),
  prefrontal: Object.freeze({
    kind: "surface",
    center: Object.freeze([0, 0.35, 1.8]),
    radius: Object.freeze([1.8, 1.45, 1.15]),
  }),
  associationCortex: Object.freeze({
    kind: "surface",
    center: Object.freeze([-1.25, 0.75, 0.85]),
    radius: Object.freeze([1.2, 1, 1]),
    bilateral: true,
  }),
  temporalCortex: Object.freeze({
    kind: "surface",
    center: Object.freeze([1.45, -0.5, 0.35]),
    radius: Object.freeze([0.85, 1.1, 1.45]),
    bilateral: true,
  }),
  parietalCortex: Object.freeze({
    kind: "surface",
    center: Object.freeze([0, 1.2, -0.9]),
    radius: Object.freeze([1.9, 1.05, 1.35]),
  }),
  amygdala: Object.freeze({
    kind: "deep",
    // Paired nuclei sit just anterior to the hippocampal heads.
    center: Object.freeze([0.82, -0.78, 1.02]),
    radius: Object.freeze([0.5, 0.45, 0.6]),
    bilateral: true,
  }),
  basalGanglia: Object.freeze({
    kind: "deep",
    center: Object.freeze([0.62, -0.12, 0.25]),
    radius: Object.freeze([0.6, 0.5, 0.55]),
    bilateral: true,
  }),
  cerebellum: Object.freeze({
    // The legacy OBJ is one undivided cerebral mesh. Render the cerebellum as
    // its own posterior-inferior volume instead of painting it onto that shell.
    kind: "proxy",
    // Tuck the upper lobe behind the occipital cortex. Keeping this too low
    // exposes a strip of background between the proxy and the cerebral shell.
    center: Object.freeze([0, -0.72, -1.4]),
    radius: Object.freeze([1.45, 0.7, 1.1]),
  }),
  motorCortex: Object.freeze({
    kind: "surface",
    // The precentral gyrus is a narrow coronal ribbon crossing both
    // hemispheres from the medial crown down each lateral wall. Treating it as
    // an ellipsoid paints a broad cap instead of this anterior/posterior band.
    center: Object.freeze([0, 1.1, 0.18]),
    radius: Object.freeze([2.05, 1.0, 0.23]),
    shape: "motorRibbon",
  }),
  insula: Object.freeze({
    kind: "deep",
    center: Object.freeze([1.25, -0.05, 0.45]),
    radius: Object.freeze([0.7, 0.8, 0.8]),
    bilateral: true,
  }),
  entorhinal: Object.freeze({
    kind: "deep",
    center: Object.freeze([1.08, -0.92, 0.18]),
    radius: Object.freeze([0.55, 0.45, 0.5]),
    bilateral: true,
  }),
});

export const SURFACE_REGION_ORDER = Object.freeze(
  CORE_BRAIN_REGIONS.filter(
    (region) => LEGACY_REGION_GEOMETRY[region].kind === "surface",
  ),
);

const SURFACE_CLASSIFICATION_ORDER = Object.freeze(
  CORE_BRAIN_REGIONS.filter(
    (region) => LEGACY_REGION_GEOMETRY[region].kind !== "deep",
  ),
);

export function getLegacyRegionPositions() {
  return new Map(
    CORE_BRAIN_REGIONS.map((region) => {
      const definition = LEGACY_REGION_GEOMETRY[region];
      return [
        region,
        {
          center: [...definition.center],
          radius: Math.min(...definition.radius),
          ...(definition.hemispheres
            ? {
                left: [...definition.hemispheres.left],
                right: [...definition.hemispheres.right],
              }
            : {}),
        },
      ];
    }),
  );
}

export function measureLegacyRegionPositions(model) {
  const positions = getLegacyRegionPositions();
  const candidates = new Map(
    SURFACE_REGION_ORDER.map((region) => [
      region,
      { distance: Infinity, point: null, surfacePoints: [] },
    ]),
  );

  model.updateMatrixWorld(true);
  model.traverse((child) => {
    const attribute = child.geometry?.getAttribute("position");
    if (!attribute) return;

    for (let index = 0; index < attribute.count; index += 1) {
      const point = child.localToWorld(
        child.position.clone().fromBufferAttribute(attribute, index),
      );
      const coordinates = point.toArray();
      const region = getSurfaceBrainRegion(coordinates);
      const profile = LEGACY_REGION_GEOMETRY[region];
      const candidate = candidates.get(region);
      // Proxy anatomy participates in region classification but must not be
      // measured from (or painted onto) the undivided cerebral OBJ.
      if (!candidate) continue;
      const distance = getRegionDistance(coordinates, profile);

      if (distance < candidate.distance) {
        candidate.distance = distance;
        candidate.point = coordinates;
      }
      if (distance <= 0.72) {
        candidate.surfacePoints.push({ coordinates, distance });
      }
    }
  });

  for (const [region, candidate] of candidates) {
    if (!candidate.point) continue;
    const measured = positions.get(region);
    measured.center = candidate.point;
    measured.radius = Math.min(measured.radius, 0.55);
    const uniquePoints = new Map();
    candidate.surfacePoints
      .sort((left, right) => left.distance - right.distance)
      .forEach(({ coordinates }) => {
        const key = coordinates.map((value) => value.toFixed(5)).join(":");
        if (!uniquePoints.has(key)) uniquePoints.set(key, coordinates);
      });
    // Nodes belong at the visual core of the highlighted patch. Sampling the
    // entire mask includes its anatomical boundary and makes an attached node
    // look detached when its sphere extends beyond the colored surface.
    measured.surfacePoints = [...uniquePoints.values()].slice(0, 8);
  }

  return positions;
}

export function getLegacyMemoryPosition(
  memoryId,
  region,
  regionPositions,
  surfaceInset = 0,
) {
  const measured = regionPositions.get(region);
  if (!measured?.surfacePoints?.length) return null;

  let hash = 2166136261;
  const value = `${memoryId}:${region}:legacy-surface`;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const sample = Math.floor(
    ((hash >>> 0) / 4294967296) * measured.surfacePoints.length,
  );
  const coordinates = measured.surfacePoints[sample];
  const distanceFromCenter = Math.hypot(...coordinates);
  if (!distanceFromCenter) return [...coordinates];
  return coordinates.map(
    (coordinate) => coordinate * (1 - surfaceInset / distanceFromCenter),
  );
}

export function getLegacyRegionTarget(region, hemisphere = null) {
  const definition = LEGACY_REGION_GEOMETRY[region];
  if (!definition) return null;
  if (hemisphere && definition.hemispheres?.[hemisphere]) {
    return definition.hemispheres[hemisphere];
  }
  return definition.center;
}

function getMotorRibbonDistance(point) {
  const lowerEdge = 0.15;
  const verticalProgress = Math.min(Math.max((point[1] - lowerEdge) / 1.75, 0), 1);
  const centerZ = 0.1 + 0.14 * verticalProgress;
  const endTaper = Math.min(Math.max((point[1] - lowerEdge) / 0.5, 0), 1);
  const halfWidth = 0.12 + 0.11 * endTaper;
  const ventralOverflow = Math.max(lowerEdge - point[1], 0) / 0.18;
  const depth = (point[2] - centerZ) / halfWidth;
  return Math.hypot(ventralOverflow, depth);
}

function getRegionDistance(point, profile) {
  if (profile.shape === "motorRibbon") return getMotorRibbonDistance(point);

  const x = profile.bilateral ? Math.abs(point[0]) : point[0];
  return Math.sqrt(profile.center.reduce((total, center, index) => {
    const coordinate = index === 0 ? x : point[index];
    const normalized = (coordinate - (index === 0 && profile.bilateral
      ? Math.abs(center)
      : center)) / profile.radius[index];
    return total + normalized * normalized;
  }, 0));
}

export function getSurfaceBrainRegion(point) {
  let closestRegion = null;
  let closestDistance = Infinity;

  for (const region of SURFACE_CLASSIFICATION_ORDER) {
    const profile = LEGACY_REGION_GEOMETRY[region];
    const distance = getRegionDistance(point, profile);

    if (distance < closestDistance) {
      closestRegion = region;
      closestDistance = distance;
    }
  }

  return closestRegion;
}

export function getRegionShaderData() {
  return SURFACE_REGION_ORDER.map((name) => {
    const profile = LEGACY_REGION_GEOMETRY[name];
    return {
      name,
      center: profile.center,
      radius: profile.radius,
      bilateral: profile.bilateral || false,
      shape: profile.shape || "ellipsoid",
    };
  });
}
