import * as THREE from "three";
import { LEGACY_REGION_COLORS } from "./region-colors.js";
import { LEGACY_BRAIN_VISUAL_PROFILE } from "../brain/legacy-visual-profile.js";

const NEUTRAL_COLOR = "#a7afb0";
const NEUTRAL_EMISSIVE = "#30393c";
const IDLE_COLOR = new THREE.Color(
  LEGACY_BRAIN_VISUAL_PROFILE.neutralMaterial.color,
);
const IDLE_EMISSIVE = new THREE.Color(
  LEGACY_BRAIN_VISUAL_PROFILE.neutralMaterial.emissive,
);
const SELECTED_COLOR = new THREE.Color(NEUTRAL_COLOR);
const SELECTED_EMISSIVE = new THREE.Color(NEUTRAL_EMISSIVE);
const IDLE_TRANSITION_RATE = 9;

function shaderDeclarations(regionCount) {
  return `
    varying vec3 vLegacyObjectPosition;
    varying vec3 vLegacyViewPosition;
    varying vec3 vLegacyViewNormal;
    uniform vec3 uLegacyModelCenter;
    uniform vec3 uLegacyRegionCenters[${regionCount}];
    uniform vec3 uLegacyRegionRadii[${regionCount}];
    uniform vec3 uLegacyRegionColors[${regionCount}];
    uniform float uLegacyRegionBilateral[${regionCount}];
    uniform float uLegacyRegionShapes[${regionCount}];
    uniform float uLegacyRegionWeights[${regionCount}];
    uniform float uLegacyRegionEmphasis[${regionCount}];
    uniform float uLegacyRegionFocus[${regionCount}];
    uniform float uLegacySelectedMix;

    void getLegacyRegionState(
      vec3 objectPosition,
      out vec3 regionColor,
      out float hueStrength,
      out float activationStrength,
      out float focusStrength
    ) {
      float closestDistance = 10000.0;
      int owner = -1;

      for (int i = 0; i < ${regionCount}; i++) {
        vec3 center = uLegacyRegionCenters[i];
        float px = objectPosition.x;
        if (uLegacyRegionBilateral[i] > 0.5) {
          px = abs(px);
          center.x = abs(center.x);
        }
        float regionDistance;
        if (uLegacyRegionShapes[i] > 0.5) {
          // Precentral-gyrus ribbon: a thin coronal band on the surface, with
          // a slight anterior/posterior slope from the lateral wall to crown.
          float lowerEdge = 0.15;
          float verticalProgress = clamp(
            (objectPosition.y - lowerEdge) / 1.75,
            0.0,
            1.0
          );
          float centerZ = 0.1 + 0.14 * verticalProgress;
          float endTaper = clamp(
            (objectPosition.y - lowerEdge) / 0.5,
            0.0,
            1.0
          );
          float halfWidth = 0.12 + 0.11 * endTaper;
          vec2 delta = vec2(
            max(lowerEdge - objectPosition.y, 0.0) / 0.18,
            (objectPosition.z - centerZ) / halfWidth
          );
          regionDistance = length(delta);
        } else {
          vec3 delta = (vec3(px, objectPosition.y, objectPosition.z) - center)
            / uLegacyRegionRadii[i];
          regionDistance = length(delta);
        }
        if (regionDistance < closestDistance) {
          closestDistance = regionDistance;
          owner = i;
        }
      }

      regionColor = vec3(0.0);
      hueStrength = 0.0;
      activationStrength = 0.0;
      focusStrength = 0.0;
      float coverage = 1.0 - smoothstep(0.72, 1.08, closestDistance);
      for (int i = 0; i < ${regionCount}; i++) {
        if (i == owner) {
          float weight = uLegacyRegionWeights[i];
          regionColor = uLegacyRegionColors[i];
          hueStrength = coverage
            * step(0.0001, weight)
            * (0.52 + weight * 0.48)
            * uLegacyRegionEmphasis[i]
            * uLegacySelectedMix;
          activationStrength = coverage * weight * uLegacyRegionEmphasis[i]
            * uLegacySelectedMix;
          focusStrength = coverage * uLegacyRegionFocus[i]
            * uLegacySelectedMix;
        }
      }
    }
  `;
}

function createLegacyShellMaterial(regionData, modelCenter) {
  const weights = new Float32Array(regionData.length);
  const emphasis = new Float32Array(regionData.length).fill(1);
  const focus = new Float32Array(regionData.length);
  const uniforms = {
    uLegacyModelCenter: { value: modelCenter },
    uLegacyRegionCenters: {
      value: regionData.map(({ center }) => new THREE.Vector3(...center)),
    },
    uLegacyRegionRadii: {
      value: regionData.map(({ radius }) => new THREE.Vector3(...radius)),
    },
    uLegacyRegionColors: {
      value: regionData.map(
        ({ name }) => new THREE.Color(LEGACY_REGION_COLORS[name]),
      ),
    },
    uLegacyRegionBilateral: {
      value: regionData.map(({ bilateral }) => (bilateral ? 1 : 0)),
    },
    uLegacyRegionShapes: {
      value: regionData.map(({ shape }) => (shape === "motorRibbon" ? 1 : 0)),
    },
    uLegacyRegionWeights: { value: weights },
    uLegacyRegionEmphasis: { value: emphasis },
    uLegacyRegionFocus: { value: focus },
    uLegacySelectedMix: { value: 0 },
  };

  const idleMaterial = LEGACY_BRAIN_VISUAL_PROFILE.neutralMaterial;
  const material = new THREE.MeshStandardMaterial({
    color: idleMaterial.color,
    emissive: idleMaterial.emissive,
    emissiveIntensity: idleMaterial.emissiveIntensity,
    roughness: idleMaterial.roughness,
    metalness: idleMaterial.metalness,
    transparent: true,
    opacity: idleMaterial.opacity,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const declarations = shaderDeclarations(regionData.length);

  material.userData.legacyUniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vLegacyObjectPosition;
        varying vec3 vLegacyViewPosition;
        varying vec3 vLegacyViewNormal;`,
      )
      .replace(
        "#include <fog_vertex>",
        `#include <fog_vertex>
        vLegacyObjectPosition = position;
        vLegacyViewPosition = -mvPosition.xyz;
        vLegacyViewNormal = normalize(normalMatrix * normal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>${declarations}`)
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        vec3 legacyRegionColor;
        float legacyHueStrength;
        float legacyActivationStrength;
        float legacyFocusStrength;
        getLegacyRegionState(
          vLegacyObjectPosition - uLegacyModelCenter,
          legacyRegionColor,
          legacyHueStrength,
          legacyActivationStrength,
          legacyFocusStrength
        );
        float legacyColorMix = clamp(
          legacyHueStrength * 1.15 + legacyFocusStrength * 0.22,
          0.0,
          0.97
        );
        diffuseColor.rgb = mix(diffuseColor.rgb, legacyRegionColor, legacyColorMix);`,
      )
      .replace(
        "#include <output_fragment>",
        `vec3 legacyViewDirection = normalize(vLegacyViewPosition);
        float legacyRim = pow(
          1.0 - abs(dot(legacyViewDirection, normalize(vLegacyViewNormal))),
          3.2
        );
        outgoingLight += vec3(0.24, 0.27, 0.28) * legacyRim * 0.3;
        outgoingLight += legacyRegionColor * (
          legacyActivationStrength * 0.48
          + legacyFocusStrength * (0.28 + legacyRim * 0.9)
        );
        #include <output_fragment>`,
      );
  };
  material.customProgramCacheKey = () => `legacy-exclusive-regions:${regionData.length}`;

  return {
    material,
    weights,
    emphasis,
    focus,
    idleAmount: 1,
    idleTarget: 1,
    uniforms,
  };
}

export function applyLegacyShell(model, regionData) {
  const modelCenter = new THREE.Box3()
    .setFromObject(model)
    .getCenter(new THREE.Vector3());
  const state = createLegacyShellMaterial(regionData, modelCenter);
  const regionIndexes = new Map(
    regionData.map(({ name }, index) => [name, index]),
  );
  const replacedMaterials = new Set();

  model.traverse((child) => {
    if (!child.isMesh) return;
    if (Array.isArray(child.material)) {
      child.material.forEach((material) => replacedMaterials.add(material));
    } else if (child.material) {
      replacedMaterials.add(child.material);
    }
    child.material = state.material;
  });
  replacedMaterials.forEach((material) => material.dispose());

  function applyAppearance() {
    const idle = state.idleAmount;
    const idleMaterial = LEGACY_BRAIN_VISUAL_PROFILE.neutralMaterial;
    state.material.color.copy(SELECTED_COLOR).lerp(IDLE_COLOR, idle);
    state.material.emissive.copy(SELECTED_EMISSIVE).lerp(IDLE_EMISSIVE, idle);
    state.material.emissiveIntensity = THREE.MathUtils.lerp(
      0.08,
      idleMaterial.emissiveIntensity,
      idle,
    );
    state.material.roughness = THREE.MathUtils.lerp(
      0.78,
      idleMaterial.roughness,
      idle,
    );
    state.material.opacity = THREE.MathUtils.lerp(1, idleMaterial.opacity, idle);
    state.material.depthWrite = idle < 0.5;
    const side = idle > 0.5 ? THREE.DoubleSide : THREE.FrontSide;
    if (state.material.side !== side) {
      state.material.side = side;
      state.material.needsUpdate = true;
    }
    state.uniforms.uLegacySelectedMix.value = 1 - idle;
  }

  function setActivations(regions = [], focusedRegion = null, { idle = false } = {}) {
    state.idleTarget = idle ? 1 : 0;
    state.weights.fill(0);
    state.emphasis.fill(1);
    state.focus.fill(0);

    for (const activation of regions || []) {
      const index = regionIndexes.get(activation.region);
      if (index == null) continue;
      const weight = THREE.MathUtils.clamp(Number(activation.weight) || 0, 0, 1);
      const focused = activation.region === focusedRegion;
      state.weights[index] = weight;
      state.emphasis[index] = focusedRegion && !focused ? 0.58 : 1;
      state.focus[index] = focused ? 1 : 0;
    }
  }

  function update(deltaSeconds = 0, { immediate = false } = {}) {
    if (immediate) {
      state.idleAmount = state.idleTarget;
    } else if (state.idleAmount !== state.idleTarget) {
      const delta = Math.max(0, Number(deltaSeconds) || 0);
      const blend = 1 - Math.exp(-IDLE_TRANSITION_RATE * delta);
      state.idleAmount = THREE.MathUtils.lerp(
        state.idleAmount,
        state.idleTarget,
        blend,
      );
      if (Math.abs(state.idleAmount - state.idleTarget) < 0.002) {
        state.idleAmount = state.idleTarget;
      }
    }
    applyAppearance();
    return state.idleAmount;
  }

  applyAppearance();

  return {
    setActivations,
    update,
    dispose() {
      state.material.dispose();
    },
  };
}
