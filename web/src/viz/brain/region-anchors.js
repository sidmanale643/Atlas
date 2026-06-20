export const REGION_COLORS = Object.freeze({
  // Warm amber — binds context (who/where/when).
  hippocampus: "#ffb547",
  // Sky blue — active recall, planning, working control.
  prefrontal: "#5ec8ff",
  // Hot pink — emotional salience.
  amygdala: "#ff5d8f",
  // Violet — semantic knowledge.
  temporalCortex: "#9d7bff",
  // Teal — spatial attention.
  parietalCortex: "#3ddcc4",
  // Deep indigo — habits, procedural patterns.
  basalGanglia: "#6c5cff",
  // Green — timing, precision.
  cerebellum: "#5ed97a",
  // Orange — physical action.
  motorCortex: "#ff8a3d",
  // Magenta — internal/bodily state.
  insula: "#e667d4",
  // Slate blue — multi-modal integration.
  associationCortex: "#7a8aa3",
  // Cyan — spatial navigation.
  entorhinal: "#42c8e6",
});

export const REGION_ANCHORS = Object.freeze({
  hippocampus: {
    label: "Hippocampus",
    role: "Binds events to their spatial and temporal context.",
    position: [0, -0.85, 0.8],
    // The calibrated brain model uses negative X for anatomical left.
    hemispherePositions: {
      left: [-0.93, -0.85, 0.8],
      right: [0.93, -0.85, 0.8],
    },
    color: REGION_COLORS.hippocampus,
    markerScale: 0.85,
  },
  prefrontal: {
    label: "Prefrontal cortex",
    role: "Supports active recall, planning, and working control.",
    position: [0, 0.35, 2.28],
    color: REGION_COLORS.prefrontal,
    markerScale: 1.1,
  },
  associationCortex: {
    label: "Association cortex",
    role: "Integrates concepts across knowledge and sensory systems.",
    position: [-1.25, 0.75, 0.85],
    color: REGION_COLORS.associationCortex,
    markerScale: 1.15,
  },
  temporalCortex: {
    label: "Temporal cortex",
    role: "Supports semantic knowledge and recognizable concepts.",
    position: [1.72, -0.45, 0.35],
    color: REGION_COLORS.temporalCortex,
    markerScale: 1.1,
  },
  basalGanglia: {
    label: "Basal ganglia",
    role: "Supports learned routines, habits, and procedural patterns.",
    position: [0.62, -0.12, 0.25],
    color: REGION_COLORS.basalGanglia,
    markerScale: 0.8,
  },
  cerebellum: {
    label: "Cerebellum",
    role: "Coordinates timing and precision in practiced movement.",
    position: [0.45, -1.3, -1.15],
    color: REGION_COLORS.cerebellum,
    markerScale: 1.1,
  },
  motorCortex: {
    label: "Motor cortex",
    role: "Represents and plans physical actions.",
    position: [1.15, 1.35, 0.05],
    color: REGION_COLORS.motorCortex,
    markerScale: 1,
  },
  amygdala: {
    label: "Amygdala",
    role: "Tags experiences with emotional salience.",
    position: [0.82, -0.78, 0.72],
    color: REGION_COLORS.amygdala,
    markerScale: 0.72,
  },
  insula: {
    label: "Insula",
    role: "Represents internal feelings and bodily state.",
    position: [1.48, 0.02, 0.48],
    color: REGION_COLORS.insula,
    markerScale: 0.9,
  },
  entorhinal: {
    label: "Entorhinal cortex",
    role: "Supports spatial context and navigation through memory.",
    position: [1.08, -0.92, 0.18],
    color: REGION_COLORS.entorhinal,
    markerScale: 0.76,
  },
  parietalCortex: {
    label: "Parietal cortex",
    role: "Supports spatial attention and active information.",
    position: [0.82, 1.3, -1.08],
    color: REGION_COLORS.parietalCortex,
    markerScale: 1.1,
  },
});

export function getRegionAnchor(region) {
  return REGION_ANCHORS[region];
}
