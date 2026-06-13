export const CORE_BRAIN_REGIONS = Object.freeze([
  "hippocampus",
  "prefrontal",
  "temporalCortex",
  "parietalCortex",
  "amygdala",
  "basalGanglia",
  "cerebellum",
  "motorCortex",
  "insula",
]);

const SURFACE_REGION_PROFILES = Object.freeze({
  prefrontal: {
    center: [0, 0.35, 1.8],
    radius: [1.8, 1.45, 1.15],
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
  cerebellum: {
    center: [0, -1.55, -1.45],
    radius: [1.45, 0.7, 1.1],
  },
  motorCortex: {
    center: [0, 1.25, 0.25],
    radius: [1.9, 0.7, 0.75],
  },
  insula: {
    center: [1.25, -0.05, 0.45],
    radius: [0.7, 0.8, 0.8],
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
