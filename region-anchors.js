export const REGION_ANCHORS = Object.freeze({
  hippocampus: {
    label: "Hippocampus",
    position: [0.93, -0.85, 0.8],
    color: "#ff5a00",
    markerScale: 0.85,
  },
  prefrontal: {
    label: "Prefrontal cortex",
    position: [0, 0.35, 2.28],
    color: "#f2b134",
    markerScale: 1.1,
  },
  associationCortex: {
    label: "Association cortex",
    position: [-1.25, 0.75, 0.85],
    color: "#d95f9f",
    markerScale: 1.15,
  },
  temporalCortex: {
    label: "Temporal cortex",
    position: [1.72, -0.45, 0.35],
    color: "#7b61ff",
    markerScale: 1.1,
  },
  basalGanglia: {
    label: "Basal ganglia",
    position: [0.62, -0.12, 0.25],
    color: "#cf4b32",
    markerScale: 0.8,
  },
  cerebellum: {
    label: "Cerebellum",
    position: [0.72, -1.68, -1.45],
    color: "#2e8b8b",
    markerScale: 1.1,
  },
  motorCortex: {
    label: "Motor cortex",
    position: [1.15, 1.35, 0.05],
    color: "#e64a4a",
    markerScale: 1,
  },
  amygdala: {
    label: "Amygdala",
    position: [0.82, -0.78, 0.72],
    color: "#ed3b70",
    markerScale: 0.72,
  },
  insula: {
    label: "Insula",
    position: [1.48, 0.02, 0.48],
    color: "#00a878",
    markerScale: 0.9,
  },
  entorhinal: {
    label: "Entorhinal cortex",
    position: [1.08, -0.92, 0.18],
    color: "#2e6cff",
    markerScale: 0.76,
  },
  parietalCortex: {
    label: "Parietal cortex",
    position: [0.82, 1.3, -1.08],
    color: "#00a6c7",
    markerScale: 1.1,
  },
});

export function getRegionAnchor(region) {
  return REGION_ANCHORS[region];
}
