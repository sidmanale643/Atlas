import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { REGION_COLORS } from "./region-anchors.js";

const REGION_NODE_PATTERN = /^region:([^:]+):(L|R)$/;
const VALID_REGIONS = new Set([
  "hippocampus",
  "prefrontal",
  "associationCortex",
  "temporalCortex",
  "basalGanglia",
  "cerebellum",
  "motorCortex",
  "amygdala",
  "insula",
  "entorhinal",
  "parietalCortex",
]);
const DEEP_REGIONS = new Set([
  "hippocampus",
  "amygdala",
  "basalGanglia",
  "entorhinal",
]);

// The segmented atlas needs an opaque neutral surface. Applying the legacy
// OBJ's translucent cream material to every region makes overlapping anatomy
// accumulate into a blown-out, noisy volume.
const NEUTRAL_MATERIAL = Object.freeze({
  color: "#111827",
  emissive: "#14223a",
  emissiveIntensity: 0.06,
  roughness: 0.78,
  metalness: 0,
  opacity: 1,
});
const NEUTRAL_COLOR = new THREE.Color(NEUTRAL_MATERIAL.color);

// The per-region highlight palette is the canonical REGION_COLORS map from
// region-anchors.js (shared with node/connection placement) so a region's mesh
// highlight, nodes, and activation tubes always read as the same hue. Keeping a
// separate copy here would let the two drift apart.

// Cached THREE.Color instances per region. Region colors identify anatomy, but
// activation is rendered as light within neutral tissue rather than a solid
// coat of color. The brighter variant is reserved for explicit focus.
const REGION_BASE_COLORS = new Map();
const REGION_BRIGHT_COLORS = new Map();

function regionBaseColor(region) {
  let color = REGION_BASE_COLORS.get(region);
  if (!color) {
    const hex = REGION_COLORS[region] || "#ffb547";
    color = new THREE.Color(hex);
    REGION_BASE_COLORS.set(region, color);
  }
  return color;
}

function regionBrightColor(region) {
  let color = REGION_BRIGHT_COLORS.get(region);
  if (!color) {
    color = regionBaseColor(region).clone();
    const hsl = { h: 0, s: 0, l: 0 };
    color.getHSL(hsl);
    hsl.s = Math.min(1, hsl.s * 0.85 + 0.15);
    hsl.l = Math.min(0.78, hsl.l * 0.5 + 0.42);
    color.setHSL(hsl.h, hsl.s, hsl.l);
    REGION_BRIGHT_COLORS.set(region, color);
  }
  return color;
}

function clampWeight(value) {
  const number = Number(value);
  return Number.isFinite(number) ? THREE.MathUtils.clamp(number, 0, 1) : 0;
}

function activationEntries(activations) {
  if (activations instanceof Map) return [...activations.entries()];
  if (Array.isArray(activations)) {
    return activations.map((activation) => [activation?.region, activation]);
  }
  if (activations && typeof activations === "object") {
    return Object.entries(activations);
  }
  return [];
}

function normalizeActivation(value) {
  if (typeof value === "number") return { weight: clampWeight(value) };
  return {
    weight: clampWeight(value?.weight),
    hemispheres: value?.hemispheres,
  };
}

function setMaterialSide(material, side) {
  if (material.side === side) return;
  material.side = side;
  material.needsUpdate = true;
}

/**
 * Builds the surface material for a brain region. A single MeshStandardMaterial
 * drives every region; its appearance (activation brightness, focus glow, the
 * dimming of non-focused regions) is controlled by uniforms updated in place.
 *
 * Inactive structures share the legacy brain's warm translucent shell style.
 * Activated structures retain the segmented renderer's matte colored style.
 * A screen-space curvature term derived from `dFdx`/`dFdy` of the view-space
 * normal keeps folds legible on both treatments without a baked AO texture.
 *
 * A fresnel/view-direction term is also injected via onBeforeCompile for:
 *   1. a restrained neutral edge highlight that gives the opaque surface depth
 *      at silhouette edges (so an opaque brain still reads as a solid form);
 *   2. a thin colored luminous boundary on the focused region, replacing the
 *      old "opaque white region" treatment with a colored rim.
 *
 * The same material class serves every region — no per-region material
 * proliferation and no detached discs/slabs.
 */
function makeSurfaceMaterial({ deep = false } = {}) {
  const material = new THREE.MeshStandardMaterial({
    color: NEUTRAL_COLOR.clone(),
    emissive: new THREE.Color(NEUTRAL_MATERIAL.emissive),
    emissiveIntensity: deep ? 0 : NEUTRAL_MATERIAL.emissiveIntensity,
    roughness: NEUTRAL_MATERIAL.roughness,
    metalness: NEUTRAL_MATERIAL.metalness,
    transparent: deep,
    opacity: deep ? 0 : NEUTRAL_MATERIAL.opacity,
    depthWrite: !deep,
    side: THREE.FrontSide,
  });

  // Uniforms referenced from the injected shader chunks. These objects are
  // merged into the per-program shader.uniforms, so mutating `.value` here
  // updates the live program without any recompilation.
  const uniforms = {
    uRimColor: { value: new THREE.Color(0xffffff) },
    uRimIntensity: { value: 0 },
    uEdgeBoost: { value: 1.1 },
    uDim: { value: 1 },
    // Curvature-driven ambient-occlusion falloff. Sulci (concave) darken toward
    // (1 - uAoStrength); gyri (convex) stay at full brightness. uAoSpread
    // controls how sharply the concavity maps into darkness. Tune via
    // #paintRegion per visual state.
    uAoStrength: { value: 0.85 },
    uAoSpread: { value: 2.2 },
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `varying vec3 neuroViewPos;
        #include <common>`,
      )
      .replace(
        "#include <fog_vertex>",
        `#include <fog_vertex>
        neuroViewPos = -mvPosition.xyz;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `varying vec3 neuroViewPos;
        uniform vec3 uRimColor;
        uniform float uRimIntensity;
        uniform float uEdgeBoost;
        uniform float uDim;
        uniform float uAoStrength;
        uniform float uAoSpread;
        #include <common>`,
      )
      // outgoingLight holds the fully lit surface radiance just before it is
      // written out, so we modulate it there. vNormal is the view-space
      // normal varying declared by the standard material's normal pars.
      .replace(
        "#include <output_fragment>",
        `// Screen-space curvature as fake ambient occlusion. The rate of change
        // of the view-space normal across the pixel neighborhood is large in
        // concave grooves (sulci) and small on convex ridges (gyri); we map
        // that magnitude to an occlusion term so sulci fall toward the dark
        // slate base. dFdx/dFdy are WebGL2 core (three r150+ targets WebGL2),
        // so no extension pragma is needed.
        vec3 neuroNormal = normalize(vNormal);
        float neuroCurv = length(fwidth(neuroNormal));
        float neuroAo = 1.0 - smoothstep(0.0, uAoSpread, neuroCurv) * uAoStrength;

        vec3 neuroViewDir = normalize(neuroViewPos);
        float neuroFresnel = pow(1.0 - max(dot(neuroNormal, neuroViewDir), 0.0), 3.2);

        // Crisp neutral edge highlight: a tight rim confined to the silhouette
        // so the dark opaque form gets a hard bright terminator, matching the
        // old brain's strong shading contrast rather than a soft matte wash.
        vec3 neuroEdge = outgoingLight * (1.0 + neuroFresnel * uEdgeBoost);

        // Thin colored luminous boundary on focused regions.
        vec3 neuroRim = uRimColor * neuroFresnel * uRimIntensity;

        outgoingLight = (neuroEdge * neuroAo + neuroRim) * uDim;
        #include <output_fragment>`,
      );
  };

  material.userData.uniforms = uniforms;
  return material;
}

/**
 * Owns the anatomical model and its visual state. It does not create a camera,
 * WebGLRenderer, controls, or animation loop.
 */
export class AnatomicalBrainRenderer {
  constructor({
    parent = null,
    camera = null,
    onLoading = null,
    onLoad = null,
    onError = null,
    onFocusRegion = null,
  } = {}) {
    this.group = new THREE.Group();
    this.group.name = "anatomical-brain";
    this.group.visible = false;
    this.camera = camera;
    this.onLoading = onLoading;
    this.onLoad = onLoad;
    this.onError = onError;
    this.onFocusRegion = onFocusRegion;
    this.regions = new Map();
    this.activations = new Map();
    this.selectedRegion = null;
    this.hoveredRegion = null;
    this.status = "idle";
    this.error = null;
    this.ready = Promise.resolve(this);

    parent?.add(this.group);
  }

  load(url, { loader = null } = {}) {
    this.status = "loading";
    this.error = null;
    this.group.visible = false;
    this.onLoading?.({ url, controller: this });

    const gltfLoader = loader || new GLTFLoader();
    gltfLoader.setMeshoptDecoder(MeshoptDecoder);
    this.ready = gltfLoader
      .loadAsync(url, (event) => {
        const progress = event.total > 0 ? event.loaded / event.total : null;
        this.onLoading?.({ url, event, progress, controller: this });
      })
      .then((gltf) => {
        this.#install(gltf.scene);
        this.status = "ready";
        this.group.visible = true;
        const detail = this.getModelMetadata();
        this.onLoad?.({ gltf, ...detail, controller: this });
        return this;
      })
      .catch((error) => {
        this.status = "error";
        this.error = error instanceof Error ? error : new Error(String(error));
        this.group.visible = false;
        this.onError?.(this.error, { url, controller: this });
        throw this.error;
      });

    return this.ready;
  }

  #install(scene) {
    this.#clearModel();
    this.group.add(scene);
    scene.updateMatrixWorld(true);

    scene.traverse((object) => {
      // The model ships no context:shell node (see anatomy-manifest); inactive
      // surface-region meshes collectively form the neutral surface.
      const match = REGION_NODE_PATTERN.exec(object.name);
      const region = object.userData.neurogramRegion || match?.[1];
      const hemisphere = object.userData.hemisphere
        || (match?.[2] === "L" ? "left" : match?.[2] === "R" ? "right" : null);
      if (!VALID_REGIONS.has(region) || !hemisphere) return;
      const deep = DEEP_REGIONS.has(region);
      const meshes = [];
      object.traverse((child) => {
        if (child.isMesh) meshes.push(child);
      });

      if (!this.regions.has(region)) this.regions.set(region, new Map());
      const hemisphereMeshes = this.regions.get(region);
      if (!hemisphereMeshes.has(hemisphere)) {
        hemisphereMeshes.set(hemisphere, []);
      }
      for (const mesh of meshes) {
        mesh.material = makeSurfaceMaterial({ deep });
        mesh.renderOrder = deep ? 2 : 1;
        mesh.visible = !deep;
        mesh.userData.anatomicalRegion = region;
        mesh.userData.hemisphere = hemisphere;
        mesh.userData.isDeep = deep;
        hemisphereMeshes.get(hemisphere).push(mesh);
      }
    });

    this.#applyVisualState();
  }

  setMemoryActivations(activations) {
    this.activations.clear();
    for (const [region, value] of activationEntries(activations)) {
      if (!VALID_REGIONS.has(region)) continue;
      this.activations.set(region, normalizeActivation(value));
    }
    this.#applyVisualState();
    return this;
  }

  setSelectedRegion(region) {
    this.selectedRegion = VALID_REGIONS.has(region) ? region : null;
    this.#applyVisualState();
    return this;
  }

  setHoveredRegion(region) {
    this.hoveredRegion = VALID_REGIONS.has(region) ? region : null;
    this.#applyVisualState();
    return this;
  }

  clearActivations() {
    this.activations.clear();
    this.#applyVisualState();
    return this;
  }

  focusRegion(region, { camera = this.camera, padding = 1.35 } = {}) {
    const meshes = this.#regionMeshes(region);
    if (meshes.length === 0) return null;

    this.group.updateWorldMatrix(true, true);
    const bounds = meshes.reduce(
      (box, mesh) => box.union(new THREE.Box3().setFromObject(mesh)),
      new THREE.Box3(),
    );
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() * 0.5, 0.001);
    const verticalFov = THREE.MathUtils.degToRad(camera?.fov || 50);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * (camera?.aspect || 1));
    const limitingFov = Math.min(verticalFov, horizontalFov);
    const distance = (radius / Math.sin(limitingFov / 2)) * Math.max(padding, 1);
    const direction = camera
      ? camera.position.clone().sub(center).normalize()
      : new THREE.Vector3(0, 0, 1);
    if (direction.lengthSq() === 0) direction.set(0, 0, 1);

    const metadata = {
      region,
      bounds: bounds.clone(),
      center,
      size,
      radius,
      distance,
      cameraPosition: center.clone().addScaledVector(direction, distance),
      target: center.clone(),
    };
    this.onFocusRegion?.(metadata, this);
    return metadata;
  }

  getModelMetadata() {
    this.group.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(this.group);
    return {
      object: this.group,
      bounds,
      center: bounds.getCenter(new THREE.Vector3()),
      size: bounds.getSize(new THREE.Vector3()),
      regions: [...this.regions.keys()],
      missingRegions: [...VALID_REGIONS].filter((region) => !this.regions.has(region)),
      hasShell: this.regions.size > 0,
    };
  }

  getRegionHitTargets({ activeOnly = true } = {}) {
    const targets = [];
    for (const [region, hemispheres] of this.regions) {
      if (activeOnly && !this.activations.get(region)?.weight) continue;
      for (const meshes of hemispheres.values()) targets.push(...meshes);
    }
    return targets;
  }

  getRegionCenter(region, hemisphere = null) {
    const regionHemispheres = this.regions.get(region);
    if (!regionHemispheres) return null;
    const meshes = hemisphere
      ? regionHemispheres.get(hemisphere) || []
      : [...regionHemispheres.values()].flat();
    if (!meshes.length) return null;
    this.group.updateWorldMatrix(true, true);
    const bounds = meshes.reduce(
      (box, mesh) => box.union(new THREE.Box3().setFromObject(mesh)),
      new THREE.Box3(),
    );
    return bounds.getCenter(new THREE.Vector3());
  }

  /**
   * Half-extent (radius) of a region's bounding box in world units, used to
   * scale memory scatter so clusters stay inside the region volume.
   */
  getRegionRadius(region, hemisphere = null) {
    const regionHemispheres = this.regions.get(region);
    if (!regionHemispheres) return null;
    const meshes = hemisphere
      ? regionHemispheres.get(hemisphere) || []
      : [...regionHemispheres.values()].flat();
    if (!meshes.length) return null;
    this.group.updateWorldMatrix(true, true);
    const bounds = meshes.reduce(
      (box, mesh) => box.union(new THREE.Box3().setFromObject(mesh)),
      new THREE.Box3(),
    );
    const size = bounds.getSize(new THREE.Vector3());
    // Use the smaller horizontal half-extent as the cluster radius so memories
    // hug the region center rather than spanning its longest axis.
    return Math.max(0.001, Math.min(size.x, size.y, size.z) * 0.5);
  }

  dispose() {
    this.#clearModel();
    this.group.removeFromParent();
    this.status = "disposed";
  }

  #regionMeshes(region) {
    const hemispheres = this.regions.get(region);
    return hemispheres ? [...hemispheres.values()].flat() : [];
  }

  #applyVisualState() {
    const focusedRegion = this.selectedRegion || this.hoveredRegion || null;
    const anyFocus = focusedRegion != null;

    for (const [region, hemispheres] of this.regions) {
      const activation = this.activations.get(region) || { weight: 0 };
      const isFocused = region === focusedRegion;
      const deep = DEEP_REGIONS.has(region);
      const hemisphereValues = activation.hemispheres;

      for (const [hemisphere, meshes] of hemispheres) {
        let weight = activation.weight;
        if (region === "hippocampus" && hemisphereValues) {
          weight = clampWeight(hemisphereValues[hemisphere]);
        }
        const displayWeight = weight;
        const active = displayWeight > 0;

        for (const mesh of meshes) {
          this.#paintRegion(mesh, {
            active,
            deep,
            isFocused,
            anyFocus,
            displayWeight,
            region,
          });
        }
      }
    }
  }

  /**
   * Applies a single consistent three-state treatment to one region mesh:
   *   1. inactive  — neutral slate tissue; dimmed further when another
   *                  region holds focus.
   *   2. activated — a restrained region tint and weight-driven emissive light.
   *                  Deep structures reveal through a translucent X-ray pass.
   *   3. focused   — stronger identity hue and a thin luminous rim edge.
   */
  #paintRegion(mesh, {
    active,
    deep,
    isFocused,
    anyFocus,
    displayWeight,
    region,
  }) {
    const material = mesh.material;
    const uniforms = material.userData.uniforms;
    const base = regionBaseColor(region);
    const bright = regionBrightColor(region);

    // Deep limbic structures stay hidden unless they are active or focused;
    // when revealed they read through the surrounding brain via transparency.
    mesh.visible = active || isFocused || !deep;
    // Only deep anatomy needs an X-ray pass. Cortical regions obey normal
    // occlusion so the far hemisphere cannot bleed through the brain and turn
    // the silhouette into overlapping color patches.
    mesh.renderOrder = isFocused ? 5 : active ? 4 : deep ? 2 : 1;

    // Keep every active surface in the same slate tissue family. Weight changes
    // the amount of colored light, while focus is the only state allowed to
    // reveal most of the region's identity hue.
    const targetColor = active
      ? new THREE.Color().lerpColors(
          NEUTRAL_COLOR,
          base,
          0.12 + displayWeight * 0.18,
        )
      : NEUTRAL_COLOR.clone();
    if (isFocused) {
      targetColor.lerp(bright, 0.48);
    }
    material.color.copy(targetColor);

    // Emissive encodes activation primarily as brightness (not geometry size).
    if (active) {
      material.roughness = 1;
      material.metalness = 0;
      setMaterialSide(material, THREE.FrontSide);
      material.emissive.copy(isFocused ? bright : base);
      material.emissiveIntensity = isFocused
        ? 0.62
        : 0.06 + displayWeight * 0.2;
    } else {
      material.roughness = NEUTRAL_MATERIAL.roughness;
      material.metalness = NEUTRAL_MATERIAL.metalness;
      setMaterialSide(material, THREE.FrontSide);
      material.emissive.set(NEUTRAL_MATERIAL.emissive);
      material.emissiveIntensity = deep ? 0 : NEUTRAL_MATERIAL.emissiveIntensity;
    }

    // Cortical activation stays opaque and depth-tested: it is the same brain
    // tissue receiving light, not a transparent overlay laid on top. Deep
    // structures remain translucent so they can be seen inside the shell.
    if (deep && !active && !isFocused) {
      material.opacity = 0;
    } else if (deep && (active || isFocused)) {
      material.opacity = isFocused ? 0.82 : 0.58 + displayWeight * 0.14;
    } else {
      material.opacity = NEUTRAL_MATERIAL.opacity;
    }
    material.depthTest = !deep || (!active && !isFocused);
    material.depthWrite = !deep;
    material.transparent = deep;

    // Fresnel rim: a thin colored luminous boundary on the focused region.
    // A crisp neutral edge lift remains on every surface for hard contrast.
    if (isFocused) {
      uniforms.uRimColor.value.copy(bright);
      uniforms.uRimIntensity.value = 0.72;
      uniforms.uEdgeBoost.value = 1.18;
    } else if (active) {
      uniforms.uRimColor.value.copy(base);
      uniforms.uRimIntensity.value = 0.08 + displayWeight * 0.14;
      uniforms.uEdgeBoost.value = 1.0;
    } else {
      uniforms.uRimColor.value.setHex(0xffffff);
      uniforms.uRimIntensity.value = 0;
      uniforms.uEdgeBoost.value = 1.1;
    }

    // Curvature "AO": full sulcus darkening on the neutral slate shell so the
    // folds read with the deep contrast of the old brain. Active and focused
    // regions retain enough groove contrast to keep looking anatomical.
    if (isFocused) {
      uniforms.uAoStrength.value = 0.42;
      uniforms.uAoSpread.value = 2.2;
    } else if (active) {
      uniforms.uAoStrength.value = 0.62 - displayWeight * 0.12;
      uniforms.uAoSpread.value = 2.2;
    } else {
      uniforms.uAoStrength.value = 0.85;
      uniforms.uAoSpread.value = 2.2;
    }

    // Dimming: when a region holds focus, the rest of the brain fades to
    // roughly 20-30% intensity but stays anatomically legible.
    if (anyFocus && !isFocused && !active) {
      uniforms.uDim.value = 0.24;
    } else if (anyFocus && !isFocused && active) {
      uniforms.uDim.value = 0.45;
    } else {
      uniforms.uDim.value = 1;
    }
  }

  #clearModel() {
    this.group.traverse((object) => {
      if (!object.isMesh) return;
      object.geometry?.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => material?.dispose());
    });
    this.group.clear();
    this.regions.clear();
  }
}

/** Creates a controller immediately and starts loading its GLTF. */
export function createAnatomicalBrainRenderer(options) {
  const { url, loader, ...controllerOptions } = options || {};
  const controller = new AnatomicalBrainRenderer(controllerOptions);
  if (url) controller.load(url, { loader });
  return controller;
}

/** Loads a GLTF and resolves with its ready controller. */
export async function loadAnatomicalBrainRenderer(options) {
  const controller = createAnatomicalBrainRenderer(options);
  if (!options?.url) throw new TypeError("A GLTF url is required");
  await controller.ready;
  return controller;
}
