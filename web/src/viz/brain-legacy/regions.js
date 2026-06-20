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

const SURFACE_REGION_PROFILES = Object.freeze({
  hippocampusLeft: {
    center: [-0.93, -0.85, 0.8],
    radius: [0.65, 0.6, 0.9],
  },
  hippocampusRight: {
    center: [0.93, -0.85, 0.8],
    radius: [0.65, 0.6, 0.9],
  },
  prefrontal: {
    center: [0, 0.35, 1.8],
    radius: [1.8, 1.45, 1.15],
  },
  associationCortex: {
    center: [-1.25, 0.75, 0.85],
    radius: [1.2, 1.0, 1.0],
    bilateral: true,
  },
  temporalCortex: {
    center: [1.45, -0.5, 0.35],
    radius: [0.85, 1.1, 1.45],
    bilateral: true,
  },
  parietalCortex: {
    center: [0, 1.2, -0.9],
    radius: [1.9, 1.05, 1.35],
  },
  basalGanglia: {
    center: [0.62, -0.12, 0.25],
    radius: [0.6, 0.5, 0.55],
    bilateral: true,
  },
  cerebellum: {
    center: [0, -1.55, -1.45],
    radius: [1.45, 0.7, 1.1],
  },
  motorCortex: {
    center: [0, 1.25, 0.25],
    radius: [1.9, 0.7, 0.75],
  },
  amygdala: {
    center: [0.82, -0.78, 0.72],
    radius: [0.5, 0.45, 0.6],
    bilateral: true,
  },
  insula: {
    center: [1.25, -0.05, 0.45],
    radius: [0.7, 0.8, 0.8],
    bilateral: true,
  },
  entorhinal: {
    center: [1.08, -0.92, 0.18],
    radius: [0.55, 0.45, 0.5],
    bilateral: true,
  },
});

export function getSurfaceBrainRegion(point) {
  let closestRegion = null;
  let closestDistance = Infinity;

  for (const [region, profile] of Object.entries(SURFACE_REGION_PROFILES)) {
    const x = profile.bilateral ? Math.abs(point[0]) : point[0];
    const distance = profile.center.reduce((total, center, index) => {
      const coordinate = index === 0 ? x : point[index];
      const normalized = (coordinate - center) / profile.radius[index];
      return total + normalized * normalized;
    }, 0);

    if (distance < closestDistance) {
      closestRegion = region;
      closestDistance = distance;
    }
  }

  return closestRegion;
}

export const REGION_SHADER_ORDER = Object.freeze([
  "hippocampusLeft",
  "hippocampusRight",
  "prefrontal",
  "associationCortex",
  "temporalCortex",
  "parietalCortex",
  "basalGanglia",
  "cerebellum",
  "motorCortex",
  "amygdala",
  "insula",
  "entorhinal",
]);

export function getRegionShaderData() {
  return REGION_SHADER_ORDER.map((name) => {
    const profile = SURFACE_REGION_PROFILES[name];
    return {
      name,
      center: profile.center,
      radius: profile.radius,
      bilateral: profile.bilateral || false,
    };
  });
}
