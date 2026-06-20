import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { createMemoryNodeState } from "../brain/memory-placement.js";
import { REGION_ANCHORS } from "../brain/region-anchors.js";
import { animateLegacyConnections, animateLegacyMemoryNodes } from "./animations.js";
import { createLegacyRegionMarkers, updateLegacyRegionMarkers } from "./region-markers.js";
import { getRegionShaderData } from "./regions.js";
import { applyLegacyShell } from "./shell.js";

const DRAG_THRESHOLD = 5;
const MEMORY_COLOR = "#f4d8b4";

function disposeObject(object) {
  object.traverse((child) => {
    child.geometry?.dispose();
    if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose());
    else child.material?.dispose();
  });
}

function createMemoryNode(memory, state, index) {
  const salience = THREE.MathUtils.clamp(Number(memory.extraction?.salience) || 0, 0, 1);
  const radius = THREE.MathUtils.lerp(0.09, 0.16, salience);
  const node = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 20, 14),
    new THREE.MeshStandardMaterial({
      color: MEMORY_COLOR,
      emissive: MEMORY_COLOR,
      emissiveIntensity: 0.72,
      roughness: 0.16,
      transparent: true,
      opacity: 0.96,
      depthTest: false,
      depthWrite: false,
    }),
  );
  node.position.set(...state.core.position);
  node.renderOrder = 10;
  node.userData = {
    memoryId: memory.id,
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
        depthTest: false,
        depthWrite: false,
      }),
    );
    node.add(aura);
    node.userData.aura = aura;
  }
  return node;
}

function createConnection(memoryId, start, activation) {
  const anchor = REGION_ANCHORS[activation.region];
  if (!anchor) return [];
  const targets = activation.region === "hippocampus" && anchor.hemispherePositions
    ? Object.entries(anchor.hemispherePositions).map(([hemisphere, position]) => ({
        position,
        weight: activation.hemispheres?.[hemisphere] ?? activation.weight / 2,
      }))
    : [{ position: anchor.position, weight: activation.weight }];

  return targets.map(({ position, weight }) => {
    const end = new THREE.Vector3(...position);
    const control = start.clone().add(end).multiplyScalar(0.5).lerp(new THREE.Vector3(), 0.28);
    const curve = new THREE.QuadraticBezierCurve3(start, control, end);
    const radius = THREE.MathUtils.lerp(0.006, 0.032, Math.sqrt(weight));
    const group = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({
      color: anchor.color,
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
          color: anchor.color,
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
  renderer.toneMappingExposure = 1.18;

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 4;
  controls.maxDistance = 14;
  controls.autoRotate = !reduceMotion.matches;
  controls.autoRotateSpeed = 2.5;
  controls.addEventListener("start", () => { controls.autoRotate = false; });

  scene.add(new THREE.HemisphereLight(0xfff8e9, 0x172527, 2.4));
  const keyLight = new THREE.DirectionalLight(0xfff3df, 5.2);
  keyLight.position.set(-3, 4, 5);
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0x8ee7ff, 3.2);
  rimLight.position.set(4, -1, 2);
  scene.add(rimLight);
  const lowerLight = new THREE.PointLight(0xb7a4ff, 2.8, 12);
  lowerLight.position.set(-2.5, -3, 3);
  scene.add(lowerLight);

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
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const pointerDown = new THREE.Vector2();

  function rebuildMemories(memories) {
    memoryGroup.children.forEach(disposeObject);
    connectionGroup.children.forEach(disposeObject);
    memoryGroup.clear();
    connectionGroup.clear();
    nodes = [];
    const states = createMemoryNodeState(memories);
    memories.forEach((memory, index) => {
      const state = states.get(memory.id);
      if (!state) return;
      const node = createMemoryNode(memory, state, index);
      memoryGroup.add(node);
      nodes.push(node);
      for (const activation of state.activations) {
        for (const connection of createConnection(
          memory.id,
          new THREE.Vector3(...state.core.position),
          activation,
        )) connectionGroup.add(connection);
      }
    });
  }

  function syncState() {
    const memories = getMemories();
    const signature = memories.map((memory) => memory.id).join("|");
    if (signature !== memorySignature) {
      memorySignature = signature;
      rebuildMemories(memories);
    }
    const activeId = getActiveMemoryId();
    const focusedRegion = getFocusedRegion();
    const activeMemory = memories.find((memory) => memory.id === activeId) || null;
    nodes.forEach((node) => {
      const active = node.userData.memoryId === activeId;
      node.userData.selectionScale = active ? 1.35 : 1;
      node.material.emissiveIntensity = active ? 1.15 : 0.55;
      node.material.opacity = activeId && !active ? 0.45 : 0.96;
    });
    connectionGroup.children.forEach((connection) => {
      connection.visible = connection.userData.memoryId === activeId;
    });
    markerState && updateLegacyRegionMarkers(markerState, { memory: activeMemory, focusedRegion });
    shell?.setActivations(activeMemory?.regions, focusedRegion);
  }

  new OBJLoader().load(
    "/assets/brain.obj",
    (loaded) => {
      if (disposed) return;
      model = loaded;
      const bounds = new THREE.Box3().setFromObject(model);
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      shell = applyLegacyShell(model, getRegionShaderData());
      model.position.sub(center);
      brainContent.scale.setScalar(4.5 / Math.max(size.x, size.y, size.z));
      brainContent.add(model);
      markerState = createLegacyRegionMarkers(brainContent, REGION_ANCHORS);
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

  function animate() {
    if (disposed) return;
    syncState();
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
