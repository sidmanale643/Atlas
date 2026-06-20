import * as THREE from "three";
import { REGION_COLORS } from "../brain/region-anchors.js";
import { REGION_SHADER_ORDER } from "./regions.js";

const REGION_SHADER_COUNT = REGION_SHADER_ORDER.length;
const REGION_SHADER_INDEX = Object.freeze(
  Object.fromEntries(REGION_SHADER_ORDER.map((name, index) => [name, index])),
);

const VERTEX_SHADER = `
  precision highp float;
  varying vec3 vObjPosition;
  void main() {
    vObjPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  precision highp float;
  uniform int uRegionCount;
  uniform vec3 uRegionCenters[${REGION_SHADER_COUNT}];
  uniform vec3 uRegionRadii[${REGION_SHADER_COUNT}];
  uniform vec3 uRegionColors[${REGION_SHADER_COUNT}];
  uniform float uRegionBilateral[${REGION_SHADER_COUNT}];
  uniform float uRegionWeights[${REGION_SHADER_COUNT}];
  uniform float uRegionEmphasis[${REGION_SHADER_COUNT}];
  uniform float uRegionFocusStrength[${REGION_SHADER_COUNT}];
  uniform float uHighlightStrength;
  uniform vec3 uModelCenter;
  varying vec3 vObjPosition;

  void main() {
    vec3 fillColor = vec3(0.0);
    vec3 edgeColor = vec3(0.0);
    float fillCoverage = 0.0;
    float edgeCoverage = 0.0;
    vec3 objPos = vObjPosition - uModelCenter;
    for (int i = 0; i < ${REGION_SHADER_COUNT}; i++) {
      if (i >= uRegionCount) break;
      float weight = uRegionWeights[i];
      if (weight <= 0.001) continue;
      vec3 center = uRegionCenters[i];
      float px = objPos.x;
      if (uRegionBilateral[i] > 0.5) {
        px = abs(px);
        center.x = abs(center.x);
      }
      vec3 delta = (vec3(px, objPos.y, objPos.z) - center) / uRegionRadii[i];
      float distanceFromCenter = length(delta);
      float mask = 1.0 - smoothstep(0.28, 1.05, distanceFromCenter);
      float highlight = mask * weight * uRegionEmphasis[i];
      fillColor += uRegionColors[i] * highlight;
      fillCoverage += highlight;

      // A broad feathered band suggests the focused region's boundary without
      // exposing the low-poly OBJ or pretending the approximate ellipsoid is a
      // precise anatomical seam.
      float edge = smoothstep(0.38, 0.72, distanceFromCenter)
        * (1.0 - smoothstep(0.72, 1.12, distanceFromCenter))
        * uRegionFocusStrength[i];
      edgeColor += uRegionColors[i] * edge;
      edgeCoverage += edge;
    }
    vec3 color = fillColor + edgeColor * 0.85;
    float peak = max(color.r, max(color.g, color.b));
    if (peak > 1.0) color /= peak;
    float alpha = min(
      (fillCoverage * 0.58 + edgeCoverage * 0.32) * uHighlightStrength,
      0.78
    );
    gl_FragColor = vec4(color, alpha);
  }
`;

export function applyLegacyShell(model, regionData) {
  const shellMaterial = new THREE.MeshStandardMaterial({
    color: "#f4eee2",
    emissive: "#9bb9bc",
    emissiveIntensity: 0.035,
    roughness: 0.22,
    metalness: 0,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const modelCenter = new THREE.Box3()
    .setFromObject(model)
    .getCenter(new THREE.Vector3());
  const weights = new Float32Array(REGION_SHADER_COUNT);
  const emphasis = new Float32Array(REGION_SHADER_COUNT).fill(1);
  const focusStrength = new Float32Array(REGION_SHADER_COUNT);
  const uniforms = {
    uRegionCount: { value: REGION_SHADER_COUNT },
    uRegionCenters: {
      value: regionData.map(({ center }) => new THREE.Vector3(...center)),
    },
    uRegionRadii: {
      value: regionData.map(({ radius }) => new THREE.Vector3(...radius)),
    },
    uRegionColors: {
      value: regionData.map(({ name }) => {
        const region = name.startsWith("hippocampus") ? "hippocampus" : name;
        return new THREE.Color(REGION_COLORS[region]);
      }),
    },
    uRegionBilateral: {
      value: regionData.map(({ bilateral }) => (bilateral ? 1 : 0)),
    },
    uRegionWeights: { value: weights },
    uRegionEmphasis: { value: emphasis },
    uRegionFocusStrength: { value: focusStrength },
    uHighlightStrength: { value: 1 },
    uModelCenter: { value: modelCenter },
  };
  const glowMaterial = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
  });

  const glowMeshes = [];
  const shellMeshes = [];
  model.traverse((child) => {
    if (child.isMesh) shellMeshes.push(child);
  });
  shellMeshes.forEach((child) => {
    child.material = shellMaterial;
    const glow = new THREE.Mesh(child.geometry, glowMaterial);
    glow.name = `${child.name || "brain"}:region-glow`;
    glow.renderOrder = 1;
    child.add(glow);
    glowMeshes.push(glow);
  });

  function setActivations(regions = [], focusedRegion = null) {
    weights.fill(0);
    emphasis.fill(1);
    focusStrength.fill(0);
    for (const activation of regions) {
      const value = THREE.MathUtils.clamp(Number(activation.weight) || 0, 0, 1);
      const isFocused = activation.region === focusedRegion;
      const boost = focusedRegion
        ? isFocused ? 1.2 : 0.55
        : 1;
      if (activation.region === "hippocampus") {
        const left = REGION_SHADER_INDEX.hippocampusLeft;
        const right = REGION_SHADER_INDEX.hippocampusRight;
        weights[left] = THREE.MathUtils.clamp(
          Number(activation.hemispheres?.left ?? value / 2) || 0,
          0,
          1,
        );
        weights[right] = THREE.MathUtils.clamp(
          Number(activation.hemispheres?.right ?? value / 2) || 0,
          0,
          1,
        );
        emphasis[left] = boost;
        emphasis[right] = boost;
        focusStrength[left] = isFocused ? 0.35 + 0.65 * Math.sqrt(weights[left]) : 0;
        focusStrength[right] = isFocused ? 0.35 + 0.65 * Math.sqrt(weights[right]) : 0;
      } else {
        const index = REGION_SHADER_INDEX[activation.region];
        if (index == null) continue;
        weights[index] = value;
        emphasis[index] = boost;
        focusStrength[index] = isFocused ? 0.35 + 0.65 * Math.sqrt(value) : 0;
      }
    }
    uniforms.uRegionWeights.value = weights;
    uniforms.uRegionEmphasis.value = emphasis;
    uniforms.uRegionFocusStrength.value = focusStrength;
  }

  return {
    setActivations,
    dispose() {
      shellMaterial.dispose();
      glowMaterial.dispose();
      glowMeshes.forEach((mesh) => mesh.removeFromParent());
    },
  };
}
