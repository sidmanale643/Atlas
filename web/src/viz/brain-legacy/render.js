import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { createMemoryNodeState } from "../brain/memory-placement.js";
import { LEGACY_BRAIN_VISUAL_PROFILE } from "../brain/legacy-visual-profile.js";
import { REGION_ANCHORS } from "../brain/region-anchors.js";
import { animateLegacyConnections, animateLegacyMemoryNodes } from "./animations.js";
import { LEGACY_REGION_COLORS } from "./region-colors.js";
import { createLegacyRegionMarkers, updateLegacyRegionMarkers } from "./region-markers.js";
import {
  LEGACY_REGION_GEOMETRY,
  getLegacyMemoryPosition,
  getLegacyRegionPositions,
  getLegacyRegionTarget,
  getRegionShaderData,
  measureLegacyRegionPositions,
} from "./regions.js";
import { applyLegacyShell } from "./shell.js";

const DRAG_THRESHOLD = 5;
const MEMORY_COLOR = "#f4d8b4";
const MEMORY_SURFACE_INSET_RATIO = 0.55;
const LEGACY_BRAIN_URL = new URL(
  "../../../../public/assets/brain.obj",
  import.meta.url,
).href;

function disposeObject(object) {
  object.traverse((child) => {
    child.geometry?.dispose();
    if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose());
    else child.material?.dispose();
  });
}

function getMemoryNodeRadius(memory) {
  const salience = THREE.MathUtils.clamp(Number(memory.extraction?.salience) || 0, 0, 1);
  return THREE.MathUtils.lerp(0.09, 0.16, salience);
}

function createMemoryNode(memory, state, index) {
  const radius = getMemoryNodeRadius(memory);
  const isSurfaceRegion =
    LEGACY_REGION_GEOMETRY[state.core.region]?.kind === "surface";
  const node = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 20, 14),
    new THREE.MeshStandardMaterial({
      color: MEMORY_COLOR,
      emissive: MEMORY_COLOR,
      emissiveIntensity: 0.72,
      roughness: 0.16,
      transparent: true,
      opacity: 0.96,
      depthTest: isSurfaceRegion,
      depthWrite: false,
    }),
  );
  node.position.set(...state.core.position);
  node.renderOrder = 10;
  node.userData = {
    memoryId: memory.id,
    region: state.core.region,
    pulseOffset: index * 0.73,
    selectionScale: 1,
  };

  const emotion = memory.extraction?.emotions?.[0];
  if (emotion) {
    const aura = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 1.65, 16, 12),
      new THREE.MeshBasicMaterial({
        color: emotion.color || "#fff1d2",
        transparent: true,
        opacity: 0.12,
        blending: THREE.AdditiveBlending,
        depthTest: isSurfaceRegion,
        depthWrite: false,
      }),
    );
    node.add(aura);
    node.userData.aura = aura;
  }
  return node;
}

function createConnection(memoryId, start, activation, connectionTargets) {
  const anchor = REGION_ANCHORS[activation.region];
  const geometry = LEGACY_REGION_GEOMETRY[activation.region];
  if (!anchor || !geometry) return [];
  const measured = connectionTargets.get(activation.region);
  const hemispheres = ["left", "right"].filter(
    (hemisphere) => measured?.[hemisphere],
  );
  const targets = hemispheres.length
    ? hemispheres.map((hemisphere) => ({
        position: measured?.[hemisphere]
          || getLegacyRegionTarget(activation.region, hemisphere),
        weight: activation.hemispheres?.[hemisphere] ?? activation.weight / 2,
      }))
    : [{
        position: measured?.center || getLegacyRegionTarget(activation.region),
        weight: activation.weight,
      }];

  return targets.map(({ position, weight }) => {
    const end = new THREE.Vector3(...position);
    const control = start.clone().add(end).multiplyScalar(0.5).lerp(new THREE.Vector3(), 0.28);
    const curve = new THREE.QuadraticBezierCurve3(start, control, end);
    const radius = THREE.MathUtils.lerp(0.006, 0.032, Math.sqrt(weight));
    const group = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({
      color: LEGACY_REGION_COLORS[activation.region],
      transparent: true,
      opacity: THREE.MathUtils.lerp(0.2, 0.52, weight),
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    const glowMaterial = material.clone();
    glowMaterial.opacity *= 0.24;
    group.add(
      new THREE.Mesh(new THREE.TubeGeometry(curve, 36, radius * 2.25, 6), glowMaterial),
      new THREE.Mesh(new THREE.TubeGeometry(curve, 36, radius, 6), material),
    );
    const particles = Array.from({ length: 3 }, () => {
      const particle = new THREE.Mesh(
        new THREE.SphereGeometry(radius * 2.4, 10, 8),
        new THREE.MeshBasicMaterial({
          color: LEGACY_REGION_COLORS[activation.region],
          transparent: true,
          opacity: 0.92,
          blending: THREE.AdditiveBlending,
          depthTest: false,
          depthWrite: false,
        }),
      );
      group.add(particle);
      return particle;
    });
    group.visible = false;
    group.renderOrder = 8;
    group.userData = {
      memoryId,
      region: activation.region,
      curve,
      particles,
      speed: THREE.MathUtils.lerp(0.18, 0.42, weight),
      weight,
    };
    return group;
  });
}

export function renderLegacyBrain({
  canvas,
  stage,
  getMemories,
  getActiveMemoryId,
  getFocusedRegion,
  setHoveredMemory,
  setHoveredRegion,
  selectMemory,
  selectRegion,
  clearSelection,
  reduceMotion,
  onReady,
}) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x121718, 0.055);
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  camera.position.set(0, 0, 7);
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 4;
  controls.maxDistance = 14;
  controls.autoRotate = !reduceMotion.matches;
  controls.autoRotateSpeed = 2.5;
  controls.addEventListener("start", () => { controls.autoRotate = false; });

  const hemisphereLight = new THREE.HemisphereLight(0xe4e8e7, 0x182024, 0.95);
  scene.add(hemisphereLight);
  const keyLight = new THREE.DirectionalLight(0xfffbf2, 1.7);
  keyLight.position.set(-3, 4, 5);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0xb9c7ce, 0.55);
  fillLight.position.set(3, -1, 2);
  scene.add(fillLight);
  const rimLight = new THREE.DirectionalLight(0xdce8eb, 0.5);
  rimLight.position.set(0, 2, -6);
  scene.add(rimLight);
  const idleLowerLight = new THREE.PointLight(
    LEGACY_BRAIN_VISUAL_PROFILE.lights.lower.color,
    0,
    LEGACY_BRAIN_VISUAL_PROFILE.lights.lower.distance,
  );
  idleLowerLight.position.fromArray(
    LEGACY_BRAIN_VISUAL_PROFILE.lights.lower.position,
  );
  scene.add(idleLowerLight);

  const selectedHemisphereSky = new THREE.Color(0xe4e8e7);
  const selectedHemisphereGround = new THREE.Color(0x182024);
  const selectedKeyColor = new THREE.Color(0xfffbf2);
  const selectedRimColor = new THREE.Color(0xdce8eb);
  const idleHemisphereSky = new THREE.Color(
    LEGACY_BRAIN_VISUAL_PROFILE.lights.hemisphere.sky,
  );
  const idleHemisphereGround = new THREE.Color(
    LEGACY_BRAIN_VISUAL_PROFILE.lights.hemisphere.ground,
  );
  const idleKeyColor = new THREE.Color(
    LEGACY_BRAIN_VISUAL_PROFILE.lights.key.color,
  );
  const idleRimColor = new THREE.Color(
    LEGACY_BRAIN_VISUAL_PROFILE.lights.rim.color,
  );
  const selectedRimPosition = new THREE.Vector3(0, 2, -6);
  const idleRimPosition = new THREE.Vector3().fromArray(
    LEGACY_BRAIN_VISUAL_PROFILE.lights.rim.position,
  );

  function updateLighting(idleAmount) {
    const profile = LEGACY_BRAIN_VISUAL_PROFILE;
    hemisphereLight.color.copy(selectedHemisphereSky).lerp(
      idleHemisphereSky,
      idleAmount,
    );
    hemisphereLight.groundColor.copy(selectedHemisphereGround).lerp(
      idleHemisphereGround,
      idleAmount,
    );
    hemisphereLight.intensity = THREE.MathUtils.lerp(
      0.95,
      profile.lights.hemisphere.intensity,
      idleAmount,
    );
    keyLight.color.copy(selectedKeyColor).lerp(idleKeyColor, idleAmount);
    keyLight.intensity = THREE.MathUtils.lerp(
      1.7,
      profile.lights.key.intensity,
      idleAmount,
    );
    fillLight.intensity = THREE.MathUtils.lerp(0.55, 0, idleAmount);
    rimLight.color.copy(selectedRimColor).lerp(idleRimColor, idleAmount);
    rimLight.intensity = THREE.MathUtils.lerp(
      0.5,
      profile.lights.rim.intensity,
      idleAmount,
    );
    rimLight.position.lerpVectors(
      selectedRimPosition,
      idleRimPosition,
      idleAmount,
    );
    idleLowerLight.intensity = profile.lights.lower.intensity * idleAmount;
    renderer.toneMappingExposure = THREE.MathUtils.lerp(
      1.02,
      profile.toneMappingExposure,
      idleAmount,
    );
  }

  const brainContent = new THREE.Group();
  brainContent.rotation.set(-0.08, -0.45, -0.08);
  const memoryGroup = new THREE.Group();
  const connectionGroup = new THREE.Group();
  memoryGroup.renderOrder = 10;
  connectionGroup.renderOrder = 8;
  brainContent.add(connectionGroup, memoryGroup);
  scene.add(brainContent);

  const status = document.createElement("p");
  status.className = "brain-model-status";
  status.setAttribute("role", "status");
  status.textContent = "Loading legacy brain model…";
  stage.append(status);

  let markerState = null;
  let shell = null;
  let model = null;
  let nodes = [];
  let memorySignature = "";
  let frame = 0;
  let disposed = false;
  let legacyRegionPositions = getLegacyRegionPositions();
  let legacyConnectionTargets = getLegacyRegionPositions();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const pointerDown = new THREE.Vector2();

  function rebuildMemories(memories) {
    memoryGroup.children.forEach(disposeObject);
    connectionGroup.children.forEach(disposeObject);
    memoryGroup.clear();
    connectionGroup.clear();
    nodes = [];
    const states = createMemoryNodeState(memories, legacyRegionPositions);
    memories.forEach((memory, index) => {
      const state = states.get(memory.id);
      if (!state) return;
      state.core.position =
        getLegacyMemoryPosition(
          memory.id,
          state.core.region,
          legacyRegionPositions,
          getMemoryNodeRadius(memory) * MEMORY_SURFACE_INSET_RATIO,
        ) || state.core.position;
      const node = createMemoryNode(memory, state, index);
      memoryGroup.add(node);
      nodes.push(node);
      for (const activation of state.activations) {
        for (const connection of createConnection(
          memory.id,
          new THREE.Vector3(...state.core.position),
          activation,
          legacyConnectionTargets,
        )) connectionGroup.add(connection);
      }
    });
  }

  function syncState(deltaSeconds = 0) {
    const memories = getMemories();
    const signature = memories.map((memory) => memory.id).join("|");
    if (signature !== memorySignature) {
      memorySignature = signature;
      rebuildMemories(memories);
    }
    const activeId = getActiveMemoryId();
    const activeMemory = memories.find((memory) => memory.id === activeId) || null;
    const focusedRegion = activeMemory ? getFocusedRegion() : null;
    nodes.forEach((node) => {
      const active = node.userData.memoryId === activeId;
      node.userData.selectionScale = active ? 1.35 : 1;
      node.material.emissiveIntensity = active ? 1.15 : 0.55;
      node.material.opacity = activeId && !active ? 0.45 : 0.96;
    });
    connectionGroup.children.forEach((connection) => {
      connection.visible = connection.userData.memoryId === activeId;
    });
    markerState && updateLegacyRegionMarkers(markerState, {
      memory: activeMemory,
      focusedRegion,
    });
    shell?.setActivations(activeMemory?.regions, focusedRegion, {
      idle: activeMemory == null,
    });
    const idleAmount = shell?.update(deltaSeconds, {
      immediate: reduceMotion.matches,
    }) ?? 1;
    updateLighting(idleAmount);
  }

  new OBJLoader().load(
    LEGACY_BRAIN_URL,
    (loaded) => {
      if (disposed) return;
      model = loaded;
      const bounds = new THREE.Box3().setFromObject(model);
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      shell = applyLegacyShell(model, getRegionShaderData());
      model.position.sub(center);
      legacyRegionPositions = measureLegacyRegionPositions(model);
      brainContent.scale.setScalar(4.5 / Math.max(size.x, size.y, size.z));
      brainContent.add(model);
      const markerDefinitions = Object.fromEntries(
        Object.entries(REGION_ANCHORS).map(([region, anchor]) => [
          region,
          {
            ...anchor,
            ...LEGACY_REGION_GEOMETRY[region],
            position: legacyRegionPositions.get(region).center,
          },
        ]),
      );
      markerState = createLegacyRegionMarkers(brainContent, markerDefinitions);
      legacyConnectionTargets = markerState.connectionTargets;
      memorySignature = "";
      status.hidden = true;
      stage.dataset.modelState = "ready";
      syncState();
      onReady?.({ camera, controls });
    },
    undefined,
    (error) => {
      console.error("Failed to load legacy brain model:", error);
      stage.dataset.modelState = "error";
      status.textContent = "Legacy brain model unavailable.";
      status.setAttribute("role", "alert");
    },
  );

  function setPointer(event) {
    const bounds = canvas.getBoundingClientRect();
    pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
  }

  function onPointerMove(event) {
    setPointer(event);
    const [memoryHit] = raycaster.intersectObjects(nodes, false);
    if (memoryHit) {
      setHoveredRegion(null);
      setHoveredMemory(memoryHit.object.userData.memoryId, event);
      return;
    }
    const targets = markerState?.hitTargets.filter((target) => target.parent?.visible) || [];
    const [regionHit] = raycaster.intersectObjects(targets, false);
    if (regionHit && getActiveMemoryId()) {
      setHoveredMemory(null);
      setHoveredRegion(regionHit.object.userData.region);
      canvas.style.cursor = "pointer";
      return;
    }
    setHoveredMemory(null);
    setHoveredRegion(null);
    canvas.style.cursor = "default";
  }

  function onPointerUp(event) {
    if (event.button !== 0) return;
    if (pointerDown.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > DRAG_THRESHOLD) return;
    setPointer(event);
    const [memoryHit] = raycaster.intersectObjects(nodes, false);
    if (memoryHit) {
      selectMemory(memoryHit.object.userData.memoryId, { focusCamera: false });
      return;
    }
    const targets = markerState?.hitTargets.filter((target) => target.parent?.visible) || [];
    const [regionHit] = raycaster.intersectObjects(targets, false);
    if (regionHit) selectRegion(regionHit.object.userData.region);
    else clearSelection();
  }

  const preventWheel = (event) => event.preventDefault();
  const onPointerDown = (event) => pointerDown.set(event.clientX, event.clientY);
  const onMouseEnter = () => { controls.autoRotate = false; };
  const onMouseLeave = () => {
    setHoveredMemory(null);
    setHoveredRegion(null);
    controls.autoRotate = !reduceMotion.matches && !getActiveMemoryId();
  };
  canvas.addEventListener("wheel", preventWheel, { passive: false });
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onMouseLeave);
  canvas.addEventListener("mouseenter", onMouseEnter);
  canvas.addEventListener("mouseleave", onMouseLeave);

  function resize() {
    const { width, height } = stage.getBoundingClientRect();
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(stage);
  resize();

  let previousFrame = performance.now();
  function animate(now = performance.now()) {
    if (disposed) return;
    const deltaSeconds = Math.min((now - previousFrame) / 1000, 0.1);
    previousFrame = now;
    syncState(deltaSeconds);
    controls.update();
    if (!reduceMotion.matches) {
      const elapsed = performance.now() * 0.001;
      animateLegacyMemoryNodes(memoryGroup, elapsed);
      animateLegacyConnections(connectionGroup, elapsed);
    }
    renderer.render(scene, camera);
    frame = requestAnimationFrame(animate);
  }
  animate();

  return {
    camera,
    controls,
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      controls.dispose();
      shell?.dispose();
      markerState?.dispose();
      model && disposeObject(model);
      memoryGroup.children.forEach(disposeObject);
      connectionGroup.children.forEach(disposeObject);
      renderer.dispose();
      status.remove();
      canvas.removeEventListener("wheel", preventWheel);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onMouseLeave);
      canvas.removeEventListener("mouseenter", onMouseEnter);
      canvas.removeEventListener("mouseleave", onMouseLeave);
    },
  };
}
