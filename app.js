import * as THREE from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createMemoryNodeState } from "./memory-placement.js";
import { REGION_ANCHORS } from "./region-anchors.js";

const MAX_LENGTH = 180;
const SHOW_REGION_ANCHORS =
  new URLSearchParams(window.location.search).get("debugRegions") === "1";
const MEMORY_TYPE_COLORS = Object.freeze({
  episodic: "#ff4d21",
  semantic: "#7b61ff",
  procedural: "#e6a700",
  emotional: "#ed3b70",
  spatial: "#00a878",
  working: "#2e6cff",
});
const DEFAULT_MEMORY_COLOR = "#f4d8b4";
const MIN_MEMORY_NODE_RADIUS = 0.09;
const MAX_MEMORY_NODE_RADIUS = 0.16;

const form = document.querySelector("#memoryForm");
const input = document.querySelector("#memoryInput");
const characterCount = document.querySelector("#characterCount");
const memoryCount = document.querySelector("#memoryCount");
const memoryList = document.querySelector("#memoryList");
const emptyState = document.querySelector("#emptyState");
const detail = document.querySelector("#memoryDetail");
const clearButton = document.querySelector("#clearButton");
const submitButton = form.querySelector("button[type=submit]");
const cardTemplate = document.querySelector("#memoryCardTemplate");
const brainStage = document.querySelector("#brainStage");
const brainCanvas = document.querySelector("#brainModel");
const memoryNodeLabel = document.querySelector("#memoryNodeLabel");

let memories = [];
let selectedMemoryId = null;
let extracting = false;
let regionMarkers = new Map();
let hasActiveRegionMarkers = false;
let memoryNodeState = new Map();
let memoryNodeGroup = null;
let memoryNodes = [];
let brainCamera = null;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

input.maxLength = MAX_LENGTH;
input.addEventListener("input", () => {
  characterCount.textContent = `${input.value.length} / ${MAX_LENGTH}`;
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text || extracting) return;

  extracting = true;
  submitButton.disabled = true;
  submitButton.textContent = "ENCODING\u2026";

  try {
    const res = await fetch("/api/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, ingestionDate: new Date().toISOString() }),
    });

    if (res.ok) {
      const serverMemory = await res.json();
      const memory = normalizeServerMemory(serverMemory);
      memories.unshift(memory);
      selectedMemoryId = memory.id;
      render();
    } else {
      const err = await res.json();
      console.error("Extraction failed:", err.error);
    }
  } catch (err) {
    console.error("Network error:", err);
  }

  extracting = false;
  submitButton.disabled = false;
  submitButton.textContent = "RECORD";

  form.reset();
  characterCount.textContent = `0 / ${MAX_LENGTH}`;
  input.focus();
});

clearButton.addEventListener("click", async () => {
  if (!memories.length) return;
  const shouldClear = window.confirm("Remove every memory from this atlas?");
  if (!shouldClear) return;

  try {
    await fetch("/api/memories", { method: "DELETE" });
  } catch (err) {
    console.error("Failed to clear:", err);
  }

  memories = [];
  selectedMemoryId = null;
  render();
});

function normalizeServerMemory(m) {
  return {
    id: m.id,
    text: m.raw_text,
    createdAt: m.created_at,
    ingestionDate: m.ingestion_date,
    summary: m.summary,
    extraction: m.extraction?.extraction_json || m.extraction || null,
    entities: m.entities || [],
    relationships: m.relationships || [],
    regions: m.regions || [],
    fragments: buildFragments(m),
  };
}

function buildFragments(m) {
  const extraction = m.extraction?.extraction_json || m.extraction;
  if (!extraction) {
    return [{ id: `activity-remembered`, type: "activity", label: "remembered" }];
  }
  return mapExtractionToFragments(extraction);
}

function mapExtractionToFragments(extraction) {
  const fragments = [];

  const typeMap = {
    episodic: "event",
    semantic: "event",
    procedural: "activity",
    emotional: "event",
    spatial: "place",
    working: "event",
  };

  if (extraction.types?.length) {
    extraction.types.forEach(({ type, weight }) => {
      if (weight >= 0.3) {
        fragments.push(fragment(typeMap[type] || "event", type));
      }
    });
  }

  if (extraction.entities?.length) {
    const kindMap = { person: "person", place: "place", organization: "place" };
    extraction.entities.forEach((entity) => {
      const fragType = kindMap[entity.kind];
      if (fragType) {
        fragments.push(fragment(fragType, entity.canonicalName || entity.mention));
      }
    });
  }

  if (extraction.actions?.length) {
    extraction.actions.forEach((action) => {
      fragments.push(fragment("activity", action));
    });
  }

  if (extraction.occurredAt?.text) {
    fragments.push(fragment("time", extraction.occurredAt.text));
  }

  if (!fragments.length) {
    fragments.push(fragment("activity", "remembered"));
  }

  return fragments;
}

function fragment(type, label) {
  return {
    id: `${type}-${label.toLowerCase().replace(/\s+/g, "-")}`,
    type,
    label,
  };
}

function render() {
  memoryNodeState = createMemoryNodeState(memories);
  memoryCount.textContent = memories.length;
  emptyState.hidden = memories.length > 0;
  renderMemoryList();
  renderDetail();
  renderMemoryNodes();
  updateRegionMarkers();
}

function selectMemory(id) {
  selectedMemoryId = id;
  renderDetail();
  updateMemoryNodeSelection();
  updateRegionMarkers();
  document.querySelector(".atlas-panel").scrollIntoView({
    behavior: "smooth",
    block: "center",
  });
}

function renderDetail(sourceNode) {
  const memory = memories.find((item) => item.id === selectedMemoryId);

  if (!memory) {
    detail.innerHTML =
      '<span class="detail-index">SELECT A NODE</span><p>Connected fragments will brighten when you inspect a memory.</p>';
    return;
  }

  const sourceLabel =
    sourceNode && sourceNode.type !== "event"
      ? `${sourceNode.type.toUpperCase()} / ${sourceNode.label}`
      : "EPISODIC TRACE";

  detail.replaceChildren();
  const index = document.createElement("span");
  index.className = "detail-index";
  index.textContent = sourceLabel;
  const text = document.createElement("p");
  text.textContent = memory.text;
  detail.append(index, text);

  if (memory.extraction) {
    const ex = memory.extraction;

    if (ex.summary) {
      const summary = document.createElement("p");
      summary.className = "detail-summary";
      summary.textContent = ex.summary;
      detail.append(summary);
    }

    if (ex.emotions?.length) {
      const emotions = document.createElement("div");
      emotions.className = "detail-section";
      emotions.innerHTML = '<span class="detail-label">EMOTIONS</span>';
      ex.emotions.forEach((e) => {
        const chip = document.createElement("span");
        chip.className = "tag tag-event";
        chip.textContent = `${e.label} (${e.confidence.toFixed(2)})`;
        emotions.append(chip);
      });
      detail.append(emotions);
    }

    if (ex.entities?.length) {
      const entities = document.createElement("div");
      entities.className = "detail-section";
      entities.innerHTML = '<span class="detail-label">ENTITIES</span>';
      ex.entities.forEach((e) => {
        const chip = document.createElement("span");
        chip.className = `tag tag-${e.kind === "person" ? "person" : "place"}`;
        chip.textContent = `${e.mention} [${e.kind}]`;
        entities.append(chip);
      });
      detail.append(entities);
    }

    if (ex.relationships?.length) {
      const rels = document.createElement("div");
      rels.className = "detail-section";
      rels.innerHTML = '<span class="detail-label">RELATIONSHIPS</span>';
      ex.relationships.forEach((r) => {
        const p = document.createElement("p");
        p.className = "detail-relationship";
        p.textContent = `${r.subject} ${r.predicate} ${r.object}`;
        rels.append(p);
      });
      detail.append(rels);
    }

    if (ex.salience != null) {
      const salience = document.createElement("p");
      salience.className = "detail-salience";
      salience.textContent = `Salience: ${ex.salience.toFixed(2)}`;
      detail.append(salience);
    }
  }
}

function renderMemoryList() {
  memoryList.replaceChildren();

  if (!memories.length) {
    const empty = document.createElement("p");
    empty.className = "memory-empty";
    empty.textContent = "No traces yet. Record a moment to begin the atlas.";
    memoryList.append(empty);
    return;
  }

  memories.forEach((memory, index) => {
    const card = cardTemplate.content.firstElementChild.cloneNode(true);
    card.querySelector(".memory-number").textContent = `TRACE ${String(
      memories.length - index,
    ).padStart(2, "0")}`;
    card.querySelector("time").textContent = formatDate(memory.createdAt);
    card.querySelector(".memory-text").textContent = memory.text;

    const tags = card.querySelector(".memory-tags");
    memory.fragments.forEach((item) => {
      const tag = document.createElement("span");
      tag.className = `tag tag-${item.type}`;
      tag.textContent = item.label;
      tags.append(tag);
    });

    card.addEventListener("click", () => selectMemory(memory.id));
    memoryList.append(card);
  });
}

async function loadMemories() {
  try {
    const res = await fetch("/api/memories");
    if (res.ok) {
      const data = await res.json();
      memories = data.map(normalizeServerMemory);
      render();
    }
  } catch (err) {
    console.error("Failed to load memories:", err);
  }
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function createRegionAnchorGroup() {
  const anchors = new THREE.Group();
  anchors.name = "region-anchors";
  regionMarkers = new Map();

  Object.entries(REGION_ANCHORS).forEach(([region, definition]) => {
    const anchor = new THREE.Object3D();
    anchor.name = `region-anchor:${region}`;
    anchor.position.set(...definition.position);
    anchor.userData.region = region;
    anchor.userData.label = definition.label;
    anchor.userData.color = definition.color;
    anchor.userData.markerScale = definition.markerScale;

    const marker = createRegionMarker(region, definition);
    anchor.add(marker);
    regionMarkers.set(region, marker);

    if (SHOW_REGION_ANCHORS) {
      const debugMarker = new THREE.Mesh(
        new THREE.SphereGeometry(0.12 * definition.markerScale, 16, 12),
        new THREE.MeshBasicMaterial({
          color: definition.color,
          depthTest: false,
          transparent: true,
          opacity: 0.9,
        }),
      );
      debugMarker.renderOrder = 10;
      anchor.add(
        debugMarker,
        createRegionLabel(definition.label, definition.color),
      );
    }

    anchors.add(anchor);
  });

  updateRegionMarkers();
  return anchors;
}

function createRegionMarker(region, definition) {
  const color = new THREE.Color(definition.color);
  const coreMaterial = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0,
    roughness: 0.35,
    transparent: true,
    opacity: 0.04,
    depthWrite: false,
  });
  const glowMaterial = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const marker = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 24, 16),
    coreMaterial,
  );
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.24, 24, 16),
    glowMaterial,
  );

  marker.name = `region-marker:${region}`;
  marker.scale.setScalar(definition.markerScale * 0.7);
  marker.userData = {
    region,
    markerScale: definition.markerScale,
    weight: 0,
    coreMaterial,
    glowMaterial,
  };
  marker.add(core, glow);
  return marker;
}

function updateRegionMarkers() {
  regionMarkers.forEach((marker) => setRegionMarkerWeight(marker, 0));

  const memory = memories.find((item) => item.id === selectedMemoryId);
  if (!memory) {
    hasActiveRegionMarkers = false;
    return;
  }

  memory.regions.forEach(({ region, weight }) => {
    const marker = regionMarkers.get(region);
    if (marker) setRegionMarkerWeight(marker, weight);
  });
  hasActiveRegionMarkers = memory.regions.some(
    ({ region, weight }) => regionMarkers.has(region) && weight > 0,
  );
}

function setRegionMarkerWeight(marker, value) {
  const weight = THREE.MathUtils.clamp(Number(value) || 0, 0, 1);
  const { markerScale, coreMaterial, glowMaterial } = marker.userData;

  marker.userData.weight = weight;
  marker.scale.setScalar(markerScale * (0.7 + weight * 0.8));
  coreMaterial.opacity = weight ? 0.2 + weight * 0.75 : 0.04;
  coreMaterial.emissiveIntensity = weight ? 0.5 + weight * 3 : 0;
  glowMaterial.opacity = weight * 0.42;
}

function createRegionLabel(label, color) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  canvas.width = 320;
  canvas.height = 64;
  context.font = "500 24px DM Mono, monospace";
  context.fillStyle = color;
  context.fillText(label.toUpperCase(), 10, 40);

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(canvas),
      depthTest: false,
      transparent: true,
    }),
  );
  sprite.position.set(0.72, 0.18, 0);
  sprite.scale.set(1.6, 0.32, 1);
  sprite.renderOrder = 10;
  return sprite;
}

function renderMemoryNodes() {
  if (!memoryNodeGroup) return;

  memoryNodes.forEach((node) => {
    node.geometry.dispose();
    node.material.dispose();
  });
  memoryNodeGroup.clear();
  memoryNodes = [];

  memories.forEach((memory) => {
    const state = memoryNodeState.get(memory.id);
    if (!state) return;

    const dominantType = getDominantMemoryType(memory.extraction?.types);
    const color = MEMORY_TYPE_COLORS[dominantType] || DEFAULT_MEMORY_COLOR;
    const radius = THREE.MathUtils.lerp(
      MIN_MEMORY_NODE_RADIUS,
      MAX_MEMORY_NODE_RADIUS,
      THREE.MathUtils.clamp(Number(memory.extraction?.salience) || 0, 0, 1),
    );
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.75,
      roughness: 0.28,
      metalness: 0.05,
    });
    const node = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 20, 14),
      material,
    );

    node.name = `memory-node:${memory.id}`;
    node.position.set(...state.position);
    node.userData.memoryId = memory.id;
    node.userData.dominantType = dominantType;
    node.userData.salience = memory.extraction?.salience ?? 0;
    memoryNodeGroup.add(node);
    memoryNodes.push(node);
  });

  updateMemoryNodeSelection();
}

function getDominantMemoryType(types) {
  let dominant = null;

  for (const candidate of types || []) {
    if (
      !MEMORY_TYPE_COLORS[candidate.type] ||
      !Number.isFinite(candidate.weight)
    ) {
      continue;
    }
    if (!dominant || candidate.weight > dominant.weight) dominant = candidate;
  }

  return dominant?.type || null;
}

function updateMemoryNodeSelection() {
  memoryNodes.forEach((node) => {
    const selected = node.userData.memoryId === selectedMemoryId;
    node.material.emissiveIntensity = selected ? 2.2 : 0.75;
    node.scale.setScalar(selected ? 1.18 : 1);
  });
  updateMemoryNodeLabel();
}

function updateMemoryNodeLabel() {
  if (!brainCamera || !selectedMemoryId) {
    memoryNodeLabel.hidden = true;
    return;
  }

  const node = memoryNodes.find(
    (candidate) => candidate.userData.memoryId === selectedMemoryId,
  );
  const memory = memories.find((item) => item.id === selectedMemoryId);
  if (!node || !memory) {
    memoryNodeLabel.hidden = true;
    return;
  }

  const position = node.getWorldPosition(new THREE.Vector3());
  position.project(brainCamera);
  const visible =
    position.z >= -1 &&
    position.z <= 1 &&
    position.x >= -1.15 &&
    position.x <= 1.15 &&
    position.y >= -1.15 &&
    position.y <= 1.15;

  memoryNodeLabel.hidden = !visible;
  if (!visible) return;

  const { width, height } = brainStage.getBoundingClientRect();
  memoryNodeLabel.textContent =
    memory.extraction?.summary || memory.summary || memory.text;
  memoryNodeLabel.style.transform = `translate(-50%, -100%) translate(${
    (position.x * 0.5 + 0.5) * width
  }px, ${(-position.y * 0.5 + 0.5) * height - 14}px)`;
}

function renderBrainModel() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  const renderer = new THREE.WebGLRenderer({
    canvas: brainCanvas,
    alpha: true,
    antialias: true,
  });
  const brain = new THREE.Group();

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  camera.position.set(0, 0, 7);
  brainCamera = camera;
  scene.add(brain);
  scene.add(new THREE.HemisphereLight(0xfff7e8, 0x4a3a36, 3));

  const controls = new OrbitControls(camera, brainCanvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 4;
  controls.maxDistance = 14;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 2.5;

  brainCanvas.addEventListener("mouseenter", () => {
    controls.autoRotate = false;
  });
  brainCanvas.addEventListener("mouseleave", () => {
    controls.autoRotate = true;
  });

  const keyLight = new THREE.DirectionalLight(0xffead8, 4);
  keyLight.position.set(-3, 4, 5);
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0xff4d21, 2.5);
  rimLight.position.set(4, -1, 2);
  scene.add(rimLight);

  new OBJLoader().load("brain.obj", (model) => {
    const material = new THREE.MeshStandardMaterial({
      color: 0xd6a08a,
      roughness: 0.58,
      metalness: 0,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    });

    model.traverse((child) => {
      if (child.isMesh) child.material = material;
    });

    const bounds = new THREE.Box3().setFromObject(model);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const brainContent = new THREE.Group();

    model.position.sub(center);
    brainContent.scale.setScalar(4.5 / Math.max(size.x, size.y, size.z));
    brainContent.rotation.set(-0.08, -0.45, -0.08);

    memoryNodeGroup = new THREE.Group();
    memoryNodeGroup.name = "memory-nodes";
    brainContent.add(model, createRegionAnchorGroup(), memoryNodeGroup);
    brain.add(brainContent);
    renderMemoryNodes();
  });

  function resize() {
    const { width, height } = brainStage.getBoundingClientRect();
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function animate() {
    controls.update();
    if (hasActiveRegionMarkers && !reduceMotion.matches) {
      const elapsed = performance.now() * 0.004;
      regionMarkers.forEach((marker) => {
        const { weight, markerScale } = marker.userData;
        if (!weight) return;
        const pulse = 1 + Math.sin(elapsed) * (0.04 + weight * 0.08);
        marker.scale.setScalar(markerScale * (0.7 + weight * 0.8) * pulse);
      });
    }
    updateMemoryNodeLabel();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  new ResizeObserver(resize).observe(brainStage);
  resize();
  animate();
}

renderBrainModel();
loadMemories();
