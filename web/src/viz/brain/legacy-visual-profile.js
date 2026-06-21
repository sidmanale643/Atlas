export const LEGACY_BRAIN_VISUAL_PROFILE = Object.freeze({
  neutralMaterial: Object.freeze({
    color: "#f4eee2",
    emissive: "#9bb9bc",
    emissiveIntensity: 0.035,
    roughness: 0.22,
    metalness: 0,
    opacity: 0.35,
  }),
  fog: Object.freeze({ color: 0x121718, density: 0.055 }),
  toneMappingExposure: 1.18,
  camera: Object.freeze({ position: [0, 0, 7], minDistance: 4, maxDistance: 14 }),
  model: Object.freeze({ rotation: [-0.08, -0.45, -0.08], size: 4.5 }),
  controls: Object.freeze({ autoRotateSpeed: 2.5 }),
  lights: Object.freeze({
    hemisphere: Object.freeze({ sky: 0xfff8e9, ground: 0x172527, intensity: 2.4 }),
    key: Object.freeze({ color: 0xfff3df, intensity: 5.2, position: [-3, 4, 5] }),
    rim: Object.freeze({ color: 0x8ee7ff, intensity: 3.2, position: [4, -1, 2] }),
    lower: Object.freeze({ color: 0xb7a4ff, intensity: 2.8, distance: 12, position: [-2.5, -3, 3] }),
  }),
});
