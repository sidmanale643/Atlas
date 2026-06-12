export const REGION_COLORS = Object.freeze({
  hippocampus: "#ffd38a",
  prefrontal: "#8edfff",
  amygdala: "#ff8fa8",
  temporalCortex: "#b9a7ff",
  parietalCortex: "#7ee8d3",
  basalGanglia: "#978cff",
  cerebellum: "#9ce4ba",
  motorCortex: "#ffad8a",
  insula: "#e99fd1",
  associationCortex: "#d9e4e8",
  entorhinal: "#80d8d0",
});

export const REGION_ANCHORS = Object.freeze({
  hippocampus: {
    label: "Hippocampus",
    position: [0.93, -0.85, 0.8],
    color: REGION_COLORS.hippocampus,
    markerScale: 0.85,
  },
  prefrontal: {
    label: "Prefrontal cortex",
    position: [0, 0.35, 2.28],
    color: REGION_COLORS.prefrontal,
    markerScale: 1.1,
  },
  associationCortex: {
    label: "Association cortex",
    position: [-1.25, 0.75, 0.85],
    color: REGION_COLORS.associationCortex,
    markerScale: 1.15,
  },
  temporalCortex: {
    label: "Temporal cortex",
    position: [1.72, -0.45, 0.35],
    color: REGION_COLORS.temporalCortex,
    markerScale: 1.1,
  },
  basalGanglia: {
    label: "Basal ganglia",
    position: [0.62, -0.12, 0.25],
    color: REGION_COLORS.basalGanglia,
    markerScale: 0.8,
  },
  cerebellum: {
    label: "Cerebellum",
    position: [0.72, -1.68, -1.45],
    color: REGION_COLORS.cerebellum,
    markerScale: 1.1,
  },
  motorCortex: {
    label: "Motor cortex",
    position: [1.15, 1.35, 0.05],
    color: REGION_COLORS.motorCortex,
    markerScale: 1,
  },
  amygdala: {
    label: "Amygdala",
    position: [0.82, -0.78, 0.72],
    color: REGION_COLORS.amygdala,
    markerScale: 0.72,
  },
  insula: {
    label: "Insula",
    position: [1.48, 0.02, 0.48],
    color: REGION_COLORS.insula,
    markerScale: 0.9,
  },
  entorhinal: {
    label: "Entorhinal cortex",
    position: [1.08, -0.92, 0.18],
    color: REGION_COLORS.entorhinal,
    markerScale: 0.76,
  },
  parietalCortex: {
    label: "Parietal cortex",
    position: [0.82, 1.3, -1.08],
    color: REGION_COLORS.parietalCortex,
    markerScale: 1.1,
  },
});

export function getRegionAnchor(region) {
  return REGION_ANCHORS[region];
}
