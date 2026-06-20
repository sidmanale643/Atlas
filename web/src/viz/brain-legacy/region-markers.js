import * as THREE from "three";

const DEEP_BRAIN_REGIONS = new Set([
  "hippocampus",
  "amygdala",
  "basalGanglia",
  "entorhinal",
]);

const REGION_MARKER_SHAPES = Object.freeze({
  prefrontal: { scale: [0.72, 0.38, 0.28], rotation: [-0.12, 0, 0] },
  associationCortex: { scale: [0.44, 0.62, 0.34], rotation: [0.28, -0.38, -0.32] },
  temporalCortex: { scale: [0.52, 0.3, 0.48], rotation: [0.08, 0.32, -0.16] },
  parietalCortex: { scale: [0.46, 0.44, 0.58], rotation: [-0.25, 0.18, 0.24] },
  motorCortex: { scale: [0.3, 0.64, 0.32], rotation: [0.42, 0.06, -0.42] },
  cerebellum: { scale: [0.54, 0.3, 0.38], rotation: [-0.14, 0.2, 0.04] },
  basalGanglia: { scale: [0.3, 0.22, 0.28], rotation: [0.1, 0.35, 0] },
  amygdala: { scale: [0.24, 0.18, 0.3], rotation: [0.2, 0.22, -0.08] },
  insula: { scale: [0.38, 0.5, 0.24], rotation: [0.12, 0.54, -0.18] },
  entorhinal: { scale: [0.34, 0.2, 0.26], rotation: [0.18, 0.18, 0.12] },
});

function createHitMaterial() {
  return new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
}

function createHippocampusMarker(definition) {
  const marker = new THREE.Group();
  const hitTargets = [];
  for (const [hemisphere, side] of [["left", -1], ["right", 1]]) {
    const points = [
      [1.02, -0.98, -0.78], [1.12, -1.02, -0.43], [1.13, -0.98, -0.08],
      [1.06, -0.9, 0.28], [0.94, -0.78, 0.58], [0.8, -0.61, 0.8],
      [0.77, -0.43, 0.72], [0.86, -0.36, 0.57],
    ].map(([x, y, z]) => new THREE.Vector3(
      side * x - definition.position[0],
      y - definition.position[1],
      z - definition.position[2],
    ));
    const hitTarget = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, false, "centripetal"), 16, 0.25, 6),
      createHitMaterial(),
    );
    hitTarget.userData = { region: "hippocampus", hemisphere, isRegionMarker: true };
    marker.add(hitTarget);
    hitTargets.push(hitTarget);
  }
  marker.userData = {
    region: "hippocampus",
    isDeepRegion: true,
    markerScale: 1,
    weight: 0,
    hitTargets,
  };
  return marker;
}

function createRegionMarker(region, definition) {
  if (region === "hippocampus") return createHippocampusMarker(definition);
  const marker = new THREE.Group();
  const shape = REGION_MARKER_SHAPES[region];
  const target = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), createHitMaterial());
  if (shape) {
    target.scale.set(...shape.scale).multiplyScalar(1.12);
    target.rotation.set(...shape.rotation);
  } else {
    target.scale.setScalar(0.2);
  }
  target.userData = { region, isRegionMarker: true };
  marker.userData = {
    region,
    isDeepRegion: DEEP_BRAIN_REGIONS.has(region),
    markerScale: definition.markerScale,
    weight: 0,
    hitTargets: [target],
  };
  marker.add(target);
  return marker;
}

function getRegionMarkerScale(marker) {
  const { isDeepRegion, markerScale, weight } = marker.userData;
  const strength = Math.sqrt(THREE.MathUtils.clamp(weight, 0, 1));
  return markerScale * (isDeepRegion ? 1.08 : 1) * (0.94 + strength * 0.5);
}

function setRegionMarkerWeight(marker, value, focused = false) {
  const weight = THREE.MathUtils.clamp(Number(value) || 0, 0, 1);
  marker.userData.weight = weight;
  marker.visible = weight > 0;
  marker.scale.setScalar(getRegionMarkerScale(marker) * (focused ? 1.12 : 1));
}

export function createLegacyRegionMarkers(parent, regions) {
  const group = new THREE.Group();
  const markers = new Map();
  const hitTargets = [];
  group.name = "legacy-region-markers";

  for (const [region, definition] of Object.entries(regions)) {
    const anchor = new THREE.Group();
    anchor.position.set(...definition.position);
    const marker = createRegionMarker(region, definition);
    marker.visible = false;
    anchor.add(marker);
    group.add(anchor);
    markers.set(region, marker);
    hitTargets.push(...marker.userData.hitTargets);
  }
  parent.add(group);

  return {
    group,
    markers,
    hitTargets,
    update({ memory, focusedRegion }) {
      markers.forEach((marker) => setRegionMarkerWeight(marker, 0));
      for (const activation of memory?.regions || []) {
        const marker = markers.get(activation.region);
        if (marker) {
          setRegionMarkerWeight(
            marker,
            activation.weight,
            activation.region === focusedRegion,
          );
        }
      }
    },
  };
}

export function updateLegacyRegionMarkers(state, next) {
  state.update(next);
}
