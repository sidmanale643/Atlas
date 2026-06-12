import * as THREE from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createMemoryNodeState } from "./memory-placement.js";
import { REGION_ANCHORS } from "./region-anchors.js";
import { getRegionContributions } from "./region-mapper.js";
import { CORE_BRAIN_REGIONS } from "./brain-regions.js";

const MAX_LENGTH = 180;
const SHOW_REGION_ANCHORS =
  new URLSearchParams(window.location.search).get("debugRegions") === "1";
const MIN_MEMORY_NODE_RADIUS = 0.09;
const MAX_MEMORY_NODE_RADIUS = 0.16;
const MIN_SUPPORT_NODE_RADIUS = 0.045;
const MAX_SUPPORT_NODE_RADIUS = 0.085;
const MIN_CONNECTION_RADIUS = 0.006;
const MAX_CONNECTION_RADIUS = 0.032;
const CONNECTION_SEGMENTS = 36;
const FLOW_PARTICLE_COUNT = 3;
const DEFAULT_MEMORY_COLOR = "#f4d8b4";
const MEMORY_TYPES = new Set([
  "episodic",
  "semantic",
  "procedural",
  "emotional",
  "spatial",
  "working",
]);
const EMOTION_AURAS = Object.freeze({
  happy: { color: "#ffd166", motion: "breathe" },
  sad: { color: "#4f8cff", motion: "drift" },
  anger: { color: "#ff2d2d", motion: "pulse" },
  fear: { color: "#dbe7ff", motion: "flicker" },
  neutral: { color: "#fffaf0", motion: "soft" },
});
const DEEP_BRAIN_REGIONS = new Set([
  "hippocampus",
  "amygdala",
  "basalGanglia",
]);

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
const memoryHoverPanel = document.querySelector("#memoryHoverPanel");
const clearSelectionButton = document.querySelector("#clearSelectionButton");

let memories = [];
let selectedMemoryId = null;
let hoveredMemoryId = null;
let extracting = false;
let regionMarkers = new Map();
let hasActiveRegionMarkers = false;
let memoryNodeState = new Map();
let memoryNodeGroup = null;
let memoryNodes = [];
let activationConnectionGroup = null;
let memoryConnections = [];
let brainCamera = null;
let brainControls = null;
let cameraFocus = null;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const pointerDown = new THREE.Vector2();
const DRAG_THRESHOLD = 5;
const CAMERA_FOCUS_DURATION = 450;

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

clearSelectionButton.addEventListener("click", clearSelection);
reduceMotion.addEventListener("change", () => {
  updateRegionMarkers();
  updateActivationConnections();
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
  if (
    hoveredMemoryId &&
    !memories.some((memory) => memory.id === hoveredMemoryId)
  ) {
    setHoveredMemory(null);
  }
  memoryNodeState = createMemoryNodeState(memories);
  memoryCount.textContent = memories.length;
  emptyState.hidden = memories.length > 0;
  renderMemoryList();
  renderDetail();
  renderMemoryNodes();
  updateRegionMarkers();
  updateActivationConnections();
  updateClearSelectionButton();
}

function selectMemory(id) {
  selectedMemoryId = id;
  renderDetail();
  updateMemoryListSelection();
  updateMemoryNodeSelection();
  updateRegionMarkers();
  updateActivationConnections();
  updateClearSelectionButton();
  focusSelectedMemory();
  document.querySelector(".atlas-panel").scrollIntoView({
    behavior: "smooth",
    block: "center",
  });
}

function clearSelection() {
  selectedMemoryId = null;
  cameraFocus = null;
  renderDetail();
  updateMemoryListSelection();
  updateMemoryNodeSelection();
  updateRegionMarkers();
  updateActivationConnections();
  updateClearSelectionButton();
}

function updateClearSelectionButton() {
  clearSelectionButton.hidden = selectedMemoryId == null;
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
  const copy = document.createElement("div");
  copy.className = "detail-copy";
  copy.append(createDetailLabel("RAW MEMORY"));
  const text = document.createElement("p");
  text.textContent = memory.text;
  copy.append(text);
  detail.append(index, copy);

  if (memory.extraction) {
    const ex = memory.extraction;

    if (ex.summary) {
      copy.append(createDetailLabel("SUMMARY"));
      const summary = document.createElement("p");
      summary.className = "detail-summary";
      summary.textContent = ex.summary;
      copy.append(summary);
    }

    if (ex.emotions?.length) {
      const emotions = document.createElement("div");
      emotions.className = "detail-section";
      emotions.innerHTML = '<span class="detail-label">EMOTIONS</span>';
      ex.emotions.forEach((e) => {
        const chip = document.createElement("span");
        chip.className = "tag tag-event";
        chip.textContent = e.label;
        const confidence = document.createElement("span");
        confidence.className = "detail-confidence";
        confidence.textContent = `Extraction confidence ${formatPercent(e.confidence)}`;
        emotions.append(chip, confidence);
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

  renderRegionExplanation(memory);
}

function createDetailLabel(text) {
  const label = document.createElement("span");
  label.className = "detail-label";
  label.textContent = text;
  return label;
}

function renderRegionExplanation(memory) {
  const section = document.createElement("section");
  section.className = "detail-section activation-detail";
  section.append(createDetailLabel("BRAIN REGION ACTIVATION"));

  const regions = [...memory.regions]
    .filter(({ region, weight }) =>
      REGION_ANCHORS[region] && Number.isFinite(weight) && weight > 0
    )
    .sort((a, b) => b.weight - a.weight || a.region.localeCompare(b.region));

  if (!regions.length) {
    const empty = document.createElement("p");
    empty.className = "activation-empty";
    empty.textContent =
      "No region data is stored for this memory. Re-extract it to calculate activation.";
    section.append(empty);
    detail.append(section);
    return;
  }

  const contributions = memory.extraction
    ? getRegionContributions(memory.extraction)
    : [];

  regions.forEach(({ region, weight }, index) => {
    const anchor = REGION_ANCHORS[region];
    const item = document.createElement("article");
    item.className = "activation-item";

    const heading = document.createElement("div");
    heading.className = "activation-heading";
    const name = document.createElement("span");
    name.className = "activation-name";
    const swatch = document.createElement("i");
    swatch.style.backgroundColor = anchor.color;
    const label = document.createElement("span");
    label.textContent = anchor.label;
    name.append(swatch, label);

    const percentage = document.createElement("strong");
    percentage.textContent = formatPercent(weight);
    heading.append(name, percentage);

    const meter = document.createElement("div");
    meter.className = "activation-meter";
    const fill = document.createElement("span");
    fill.style.width = formatPercent(weight);
    fill.style.backgroundColor = anchor.color;
    meter.append(fill);

    const reasons = document.createElement("ul");
    reasons.className = "activation-reasons";
    const regionContributions = contributions.filter(
      (contribution) => contribution.region === region && contribution.amount > 0
    );

    if (index === 0) {
      reasons.append(createReason("Highest normalized weight, so this is the dominant region."));
    }

    regionContributions.forEach((contribution) => {
      reasons.append(createContributionReason(contribution, anchor.label));
    });

    if (!regionContributions.length) {
      reasons.append(createReason("Stored activation; source breakdown is unavailable."));
    }

    item.append(heading, meter, reasons);
    section.append(item);
  });

  detail.append(section);
}

function createContributionReason(contribution, regionLabel) {
  if (contribution.source === "type") {
    return createReason(
      `${capitalize(contribution.type)} memory: ${formatPercent(
        contribution.typeWeight
      )} type weight \u00d7 ${formatPercent(
        contribution.ruleWeight
      )} ${regionLabel} rule.`
    );
  }

  if (contribution.source === "emotion") {
    const reason = createReason(
      `${capitalize(contribution.label)} emotion: ${formatPercent(
        contribution.intensity
      )} intensity \u00d7 ${formatPercent(contribution.arousal)} arousal.`
    );
    if (Number.isFinite(contribution.confidence)) {
      const confidence = document.createElement("span");
      confidence.className = "reason-confidence";
      confidence.textContent = `Extraction confidence ${formatPercent(
        contribution.confidence
      )}`;
      reason.append(confidence);
    }
    return reason;
  }

  return createReason(
    `Physical action "${contribution.action}" adds motor activation.`
  );
}

function createReason(text) {
  const reason = document.createElement("li");
  reason.textContent = text;
  return reason;
}

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
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
    card.dataset.memoryId = memory.id;
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-pressed", String(memory.id === selectedMemoryId));

    const tags = card.querySelector(".memory-tags");
    memory.fragments.forEach((item) => {
      const tag = document.createElement("span");
      tag.className = `tag tag-${item.type}`;
      tag.textContent = item.label;
      tags.append(tag);
    });

    card.addEventListener("click", () => selectMemory(memory.id));
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      selectMemory(memory.id);
    });
    memoryList.append(card);
  });
}

function updateMemoryListSelection() {
  memoryList.querySelectorAll(".memory-card").forEach((card) => {
    card.setAttribute(
      "aria-pressed",
      String(card.dataset.memoryId === String(selectedMemoryId)),
    );
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
  const isCoreRegion = CORE_BRAIN_REGIONS.includes(region);
  const isDeepRegion = DEEP_BRAIN_REGIONS.has(region);
  const coreMaterial = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const glowMaterial = new THREE.SpriteMaterial({
    map: createActivationFieldTexture(),
    color,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const marker = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 24, 16),
    coreMaterial,
  );
  const glow = new THREE.Sprite(glowMaterial);
  glow.scale.setScalar(isDeepRegion ? 0.9 : 1.2);

  marker.name = `region-marker:${region}`;
  marker.visible = isCoreRegion;
  marker.scale.setScalar(definition.markerScale);
  marker.userData = {
    region,
    isDeepRegion,
    markerScale: definition.markerScale,
    weight: 0,
    coreMaterial,
    glowMaterial,
  };
  marker.add(core, glow);
  return marker;
}

function createActivationFieldTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, "rgba(255, 255, 255, 0.9)");
  gradient.addColorStop(0.18, "rgba(255, 255, 255, 0.55)");
  gradient.addColorStop(0.5, "rgba(255, 255, 255, 0.16)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  return new THREE.CanvasTexture(canvas);
}

function updateRegionMarkers() {
  regionMarkers.forEach((marker) => setRegionMarkerWeight(marker, 0));

  const activeMemoryId = hoveredMemoryId || selectedMemoryId;
  const memory = memories.find((item) => item.id === activeMemoryId);
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
  const { isDeepRegion, markerScale, coreMaterial, glowMaterial } =
    marker.userData;

  marker.userData.weight = weight;
  marker.scale.setScalar(
    markerScale * (isDeepRegion ? 1.1 + weight * 0.55 : 0.85 + weight * 0.75),
  );
  coreMaterial.opacity = weight * (isDeepRegion ? 0.42 : 0.28);
  glowMaterial.opacity = weight * (isDeepRegion ? 0.78 : 0.58);
}

function applyBrainMaterial(model) {
  model.traverse((child) => {
    if (!child.isMesh) return;

    child.material = new THREE.MeshPhysicalMaterial({
      color: "#f4eee2",
      emissive: "#9bb9bc",
      emissiveIntensity: 0.035,
      roughness: 0.22,
      metalness: 0,
      transmission: 0.32,
      thickness: 0.65,
      ior: 1.18,
      clearcoat: 1,
      clearcoatRoughness: 0.18,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  });
}

function updateActivationConnections() {
  if (!activationConnectionGroup) return;

  const activeMemoryId = hoveredMemoryId || selectedMemoryId;
  memoryConnections.forEach((connection) => {
    const active = connection.userData.memoryId === activeMemoryId;
    const { weight, tubeMaterial, glowMaterial, flowParticles } =
      connection.userData;
    const opacity = active
      ? THREE.MathUtils.lerp(0.42, 0.82, weight)
      : activeMemoryId == null
        ? THREE.MathUtils.lerp(0.035, 0.16, weight)
        : 0.012;

    tubeMaterial.opacity = opacity;
    glowMaterial.opacity = active ? opacity * 0.26 : opacity * 0.12;
    flowParticles.forEach((particle) => {
      particle.visible = active && !reduceMotion.matches;
    });
  });
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

  disposeGroupContents(memoryNodeGroup);
  disposeGroupContents(activationConnectionGroup);
  memoryNodeGroup.clear();
  activationConnectionGroup.clear();
  memoryNodes = [];
  memoryConnections = [];

  memories.forEach((memory, index) => {
    const state = memoryNodeState.get(memory.id);
    if (!state) return;

    const dominantType = getDominantMemoryType(memory.extraction?.types);
    const salience = THREE.MathUtils.clamp(
      Number(memory.extraction?.salience) || 0,
      0,
      1,
    );
    const auraRegion = state.nodes.some(({ region }) => region === "amygdala")
      ? "amygdala"
      : state.dominantRegion;

    state.nodes.forEach((activation, activationIndex) => {
      const color =
        REGION_ANCHORS[activation.region]?.color || DEFAULT_MEMORY_COLOR;
      const radius = activation.isPrimary
        ? THREE.MathUtils.lerp(
            MIN_MEMORY_NODE_RADIUS,
            MAX_MEMORY_NODE_RADIUS,
            salience,
          )
        : THREE.MathUtils.lerp(
            MIN_SUPPORT_NODE_RADIUS,
            MAX_SUPPORT_NODE_RADIUS,
            THREE.MathUtils.clamp(activation.weight * 1.5, 0, 1),
          );
      const material = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: activation.isPrimary ? 1.4 : 0.85,
        roughness: 0.16,
        metalness: 0,
        transparent: true,
        opacity: activation.isPrimary ? 0.96 : 0.82,
      });
      const geometry = activation.isPrimary
        ? createMemoryNodeGeometry(dominantType, radius)
        : new THREE.SphereGeometry(radius, 16, 12);
      const node = new THREE.Mesh(geometry, material);

      node.name = `memory-node:${memory.id}:${activation.region}`;
      node.position.set(...activation.position);
      node.userData = {
        memoryId: memory.id,
        region: activation.region,
        weight: activation.weight,
        isPrimary: activation.isPrimary,
        dominantType,
        salience,
        pulseOffset: index * 0.73 + activationIndex * 0.31,
        selectionScale: 1,
      };

      if (activation.region === auraRegion) {
        const aura = createEmotionAura(memory.extraction?.emotions, radius);
        if (aura) node.add(aura);
      }

      memoryNodeGroup.add(node);
      memoryNodes.push(node);
    });

    createConstellationConnections(memory.id, state);
  });

  updateMemoryNodeSelection();
  focusSelectedMemory();
}

function disposeGroupContents(group) {
  if (!group) return;

  group.traverse((object) => {
    if (object === group) return;
    object.geometry?.dispose();
    if (Array.isArray(object.material)) {
      object.material.forEach((material) => material.dispose());
    } else {
      object.material?.dispose();
    }
  });
}

function createConstellationConnections(memoryId, state) {
  const primary = state.nodes.find(({ isPrimary }) => isPrimary);
  if (!primary) return;

  const start = new THREE.Vector3(...primary.position);
  state.nodes
    .filter(({ isPrimary }) => !isPrimary)
    .forEach((activation) => {
      const end = new THREE.Vector3(...activation.position);
      const control = start
        .clone()
        .add(end)
        .multiplyScalar(0.5)
        .lerp(new THREE.Vector3(), 0.28);
      const curve = new THREE.QuadraticBezierCurve3(start, control, end);
      const color =
        REGION_ANCHORS[activation.region]?.color || DEFAULT_MEMORY_COLOR;
      const radius = THREE.MathUtils.lerp(
        MIN_CONNECTION_RADIUS,
        MAX_CONNECTION_RADIUS,
        Math.sqrt(THREE.MathUtils.clamp(activation.weight, 0, 1)),
      );
      const connection = new THREE.Group();
      const tubeMaterial = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: THREE.MathUtils.lerp(0.12, 0.28, activation.weight),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const glowMaterial = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.045,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.BackSide,
      });
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(
          curve,
          CONNECTION_SEGMENTS,
          radius,
          6,
          false,
        ),
        tubeMaterial,
      );
      const glow = new THREE.Mesh(
        new THREE.TubeGeometry(
          curve,
          CONNECTION_SEGMENTS,
          radius * 2.25,
          6,
          false,
        ),
        glowMaterial,
      );
      const flowParticles = Array.from(
        { length: FLOW_PARTICLE_COUNT },
        (_, index) => {
          const particle = new THREE.Mesh(
            new THREE.SphereGeometry(radius * 2.4, 10, 8),
            new THREE.MeshBasicMaterial({
              color,
              transparent: true,
              opacity: 0.92,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
            }),
          );
          particle.visible = false;
          particle.userData.phase = index / FLOW_PARTICLE_COUNT;
          connection.add(particle);
          return particle;
        },
      );

      connection.name = `memory-link:${memoryId}:${activation.region}`;
      connection.renderOrder = 1;
      connection.userData = {
        memoryId,
        region: activation.region,
        weight: activation.weight,
        curve,
        tubeMaterial,
        glowMaterial,
        flowParticles,
        flowSpeed: THREE.MathUtils.lerp(0.18, 0.42, activation.weight),
      };
      connection.add(glow, tube);
      activationConnectionGroup.add(connection);
      memoryConnections.push(connection);
    });
}

function animateActivationConnections(elapsed) {
  if (reduceMotion.matches) return;

  const activeMemoryId = hoveredMemoryId || selectedMemoryId;
  memoryConnections.forEach((connection) => {
    if (connection.userData.memoryId !== activeMemoryId) return;

    const { curve, flowParticles, flowSpeed, weight } = connection.userData;
    flowParticles.forEach((particle) => {
      const progress =
        (elapsed * flowSpeed + particle.userData.phase) % 1;
      particle.position.copy(curve.getPointAt(progress));
      const pulse = 0.8 + Math.sin(progress * Math.PI) * (0.45 + weight * 0.3);
      particle.scale.setScalar(pulse);
      particle.material.opacity =
        0.45 + Math.sin(progress * Math.PI) * 0.5;
    });
  });
}

function getDominantMemoryType(types) {
  let dominant = null;

  for (const candidate of types || []) {
    if (
      !MEMORY_TYPES.has(candidate.type) ||
      !Number.isFinite(candidate.weight)
    ) {
      continue;
    }
    if (!dominant || candidate.weight > dominant.weight) dominant = candidate;
  }

  return dominant?.type || null;
}

function createMemoryNodeGeometry(type, radius) {
  if (type === "semantic") {
    return new THREE.OctahedronGeometry(radius * 1.12, 0);
  }
  if (type === "procedural") {
    return new THREE.TorusGeometry(radius * 0.82, radius * 0.28, 10, 24);
  }
  if (type === "spatial") {
    const geometry = new THREE.ConeGeometry(radius * 0.9, radius * 2.2, 3);
    geometry.rotateX(Math.PI);
    return geometry;
  }
  if (type === "working") {
    return new THREE.SphereGeometry(radius * 0.58, 16, 10);
  }
  return new THREE.SphereGeometry(radius, 20, 14);
}

function createEmotionAura(emotions, radius) {
  const emotion = getDominantEmotion(emotions);
  if (!emotion) return null;

  const style = getEmotionAuraStyle(emotion.label);
  const intensity = THREE.MathUtils.clamp(Number(emotion.intensity) || 0, 0, 1);
  const material = new THREE.MeshBasicMaterial({
    color: style.color,
    transparent: true,
    opacity: 0.05 + intensity * 0.24,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const aura = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.75, 20, 14),
    material,
  );

  aura.name = `emotion-aura:${style.motion}`;
  aura.userData = {
    intensity,
    motion: style.motion,
    baseOpacity: material.opacity,
  };
  return aura;
}

function getDominantEmotion(emotions) {
  let dominant = null;

  for (const emotion of emotions || []) {
    if (!Number.isFinite(emotion.intensity)) continue;
    const strength =
      emotion.intensity *
      (Number.isFinite(emotion.confidence) ? emotion.confidence : 1);
    if (!dominant || strength > dominant.strength) {
      dominant = { ...emotion, strength };
    }
  }

  return dominant;
}

function getEmotionAuraStyle(label) {
  const normalized = String(label || "").toLowerCase();
  if (/happy|joy|delight|excite|content|love|warm/.test(normalized)) {
    return EMOTION_AURAS.happy;
  }
  if (/sad|grief|sorrow|lonely|melancholy|disappoint/.test(normalized)) {
    return EMOTION_AURAS.sad;
  }
  if (/anger|angry|rage|furious|irritat|frustrat/.test(normalized)) {
    return EMOTION_AURAS.anger;
  }
  if (/fear|afraid|anxi|panic|terror|worry|nervous/.test(normalized)) {
    return EMOTION_AURAS.fear;
  }
  return EMOTION_AURAS.neutral;
}

function updateMemoryNodeSelection() {
  const activeMemoryId = hoveredMemoryId || selectedMemoryId;

  memoryNodes.forEach((node) => {
    const selected = node.userData.memoryId === selectedMemoryId;
    const hovered = node.userData.memoryId === hoveredMemoryId;
    const active = hovered || selected;
    const isPrimary = node.userData.isPrimary;

    node.material.emissiveIntensity = hovered
      ? isPrimary
        ? 1
        : 0.78
      : selected
        ? isPrimary
          ? 0.9
          : 0.65
        : isPrimary
          ? 0.24
          : 0.16;
    node.material.opacity =
      activeMemoryId != null && !active ? 0.28 : isPrimary ? 1 : 0.82;
    node.userData.selectionScale = hovered
      ? isPrimary
        ? 1.28
        : 1.42
      : selected
        ? isPrimary
          ? 1.2
          : 1.34
        : 1;
    node.scale.setScalar(node.userData.selectionScale);
  });
  updateActivationConnections();
}

function animateMemoryNodes(elapsed) {
  memoryNodes.forEach((node) => {
    const selectionScale = node.userData.selectionScale || 1;
    const workingPulse =
      node.userData.isPrimary && node.userData.dominantType === "working"
        ? 1 + Math.sin(elapsed * 4.8 + node.userData.pulseOffset) * 0.16
        : 1;
    node.scale.setScalar(selectionScale * workingPulse);

    const aura = node.children.find((child) =>
      child.name.startsWith("emotion-aura:"),
    );
    if (!aura) return;

    const { baseOpacity, intensity, motion } = aura.userData;
    let pulse = 0;
    if (motion === "breathe") pulse = Math.sin(elapsed * 1.4) * 0.16;
    if (motion === "drift") pulse = Math.sin(elapsed * 0.7) * 0.1;
    if (motion === "pulse") pulse = Math.max(0, Math.sin(elapsed * 3.2)) * 0.28;
    if (motion === "flicker") {
      pulse =
        Math.sin(elapsed * 11) > 0.72 ? 0.34 : Math.sin(elapsed * 4.5) * 0.05;
    }

    aura.material.opacity = baseOpacity * (1 + pulse);
    aura.scale.setScalar(1 + pulse * (0.35 + intensity * 0.2));
  });
}

function focusSelectedMemory() {
  if (!brainCamera || !brainControls || !selectedMemoryId) return;

  const node = getPrimaryMemoryNode(selectedMemoryId);
  if (!node) return;

  const target = node.getWorldPosition(new THREE.Vector3());
  const offset = brainCamera.position.clone().sub(brainControls.target);
  const distance = THREE.MathUtils.clamp(offset.length(), 4.5, 7);

  if (!offset.lengthSq()) offset.set(0, 0, 1);
  offset.setLength(distance);
  cameraFocus = {
    startedAt: performance.now(),
    fromPosition: brainCamera.position.clone(),
    toPosition: target.clone().add(offset),
    fromTarget: brainControls.target.clone(),
    toTarget: target,
  };
  brainControls.autoRotate = false;
}

function getPrimaryMemoryNode(memoryId) {
  return memoryNodes.find(
    (candidate) =>
      candidate.userData.memoryId === memoryId &&
      candidate.userData.isPrimary,
  );
}

function setHoveredMemory(memoryId, event) {
  const hoverChanged = hoveredMemoryId !== memoryId;
  if (hoverChanged) {
    hoveredMemoryId = memoryId;
    updateMemoryNodeSelection();
    updateRegionMarkers();
  }

  if (!memoryId) {
    memoryHoverPanel.hidden = true;
    brainCanvas.style.cursor = "";
    return;
  }

  const memory = memories.find((item) => item.id === memoryId);
  if (!memory) return;

  if (hoverChanged) renderMemoryHoverPanel(memory);
  memoryHoverPanel.hidden = false;
  positionMemoryHoverPanel(event);
  brainCanvas.style.cursor = "pointer";
}

function renderMemoryHoverPanel(memory) {
  const extraction = memory.extraction || {};
  const regions = [...memory.regions]
    .filter(({ region, weight }) => REGION_ANCHORS[region] && weight > 0)
    .sort((a, b) => b.weight - a.weight);
  const primaryRegion = regions[0]?.region;
  const dominantType = getDominantMemoryType(extraction.types);
  const dominantEmotion = getDominantEmotion(extraction.emotions);
  const rows = [
    ["Memory", memory.text],
    ["Type", dominantType ? capitalize(dominantType) : "Unclassified"],
    ["Emotion", formatEmotion(dominantEmotion)],
    [
      "Primary region",
      primaryRegion ? REGION_ANCHORS[primaryRegion].label : "Unmapped",
    ],
    [
      "Linked regions",
      regions
        .slice(1)
        .map(({ region }) => REGION_ANCHORS[region].label)
        .join(", ") || "None",
    ],
    ["Strength", formatStrength(extraction.salience)],
    ["Created", formatRelativeDate(memory.createdAt)],
  ];
  const list = document.createElement("dl");

  rows.forEach(([label, value]) => {
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = label;
    description.textContent = value;
    list.append(term, description);
  });
  memoryHoverPanel.replaceChildren(list);
}

function positionMemoryHoverPanel(event) {
  const bounds = brainStage.getBoundingClientRect();
  const panelWidth = 330;
  const panelHeight = memoryHoverPanel.offsetHeight || 230;
  const x = THREE.MathUtils.clamp(
    event.clientX - bounds.left + 16,
    14,
    Math.max(14, bounds.width - panelWidth - 14),
  );
  const y = THREE.MathUtils.clamp(
    event.clientY - bounds.top + 16,
    14,
    Math.max(14, bounds.height - panelHeight - 14),
  );
  memoryHoverPanel.style.transform = `translate(${x}px, ${y}px)`;
}

function formatEmotion(emotion) {
  if (!emotion) return "Neutral";
  if (emotion.valence > 0.2) return "Positive";
  if (emotion.valence < -0.2) return "Negative";
  return "Neutral";
}

function formatStrength(value) {
  const strength = Number(value);
  return Number.isFinite(strength) ? strength.toFixed(2) : "Unknown";
}

function formatRelativeDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";

  const elapsedDays = Math.round(
    (date.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
  );
  if (elapsedDays === 0) return "Today";
  if (elapsedDays === -1) return "Yesterday";
  if (elapsedDays > -7 && elapsedDays < 0) return `${-elapsedDays} days ago`;
  return formatDate(value);
}

function renderBrainModel() {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x121718, 0.055);
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  const renderer = new THREE.WebGLRenderer({
    canvas: brainCanvas,
    alpha: true,
    antialias: true,
  });
  const brain = new THREE.Group();

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;
  camera.position.set(0, 0, 7);
  brainCamera = camera;
  scene.add(brain);
  scene.add(new THREE.HemisphereLight(0xfff8e9, 0x172527, 2.4));

  const controls = new OrbitControls(camera, brainCanvas);
  brainControls = controls;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 4;
  controls.maxDistance = 14;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 2.5;
  controls.addEventListener("start", () => {
    cameraFocus = null;
    controls.autoRotate = false;
  });

  brainCanvas.addEventListener("mouseenter", () => {
    controls.autoRotate = false;
  });
  brainCanvas.addEventListener("mouseleave", () => {
    setHoveredMemory(null);
    controls.autoRotate = selectedMemoryId == null;
  });
  brainCanvas.addEventListener("pointercancel", () => {
    setHoveredMemory(null);
  });

  brainCanvas.addEventListener("pointermove", (event) => {
    const bounds = brainCanvas.getBoundingClientRect();
    pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const [hit] = raycaster.intersectObjects(memoryNodes, false);
    setHoveredMemory(hit?.object.userData.memoryId || null, event);
  });

  brainCanvas.addEventListener("pointerdown", (event) => {
    pointerDown.set(event.clientX, event.clientY);
  });
  brainCanvas.addEventListener("pointerup", (event) => {
    if (event.button !== 0) return;
    const distance = pointerDown.distanceTo(
      pointer.set(event.clientX, event.clientY),
    );
    if (distance > DRAG_THRESHOLD) return;

    const bounds = brainCanvas.getBoundingClientRect();
    pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const [hit] = raycaster.intersectObjects(memoryNodes, false);
    if (hit) selectMemory(hit.object.userData.memoryId);
  });

  const keyLight = new THREE.DirectionalLight(0xfff3df, 5.2);
  keyLight.position.set(-3, 4, 5);
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0x8ee7ff, 3.2);
  rimLight.position.set(4, -1, 2);
  scene.add(rimLight);

  const lowerLight = new THREE.PointLight(0xb7a4ff, 2.8, 12);
  lowerLight.position.set(-2.5, -3, 3);
  scene.add(lowerLight);

  new OBJLoader().load("brain.obj", (model) => {
    const bounds = new THREE.Box3().setFromObject(model);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const brainContent = new THREE.Group();

    applyBrainMaterial(model);
    model.position.sub(center);
    brainContent.scale.setScalar(4.5 / Math.max(size.x, size.y, size.z));
    brainContent.rotation.set(-0.08, -0.45, -0.08);

    memoryNodeGroup = new THREE.Group();
    memoryNodeGroup.name = "memory-nodes";
    activationConnectionGroup = new THREE.Group();
    activationConnectionGroup.name = "activation-connections";
    brainContent.add(
      model,
      createRegionAnchorGroup(),
      activationConnectionGroup,
      memoryNodeGroup,
    );
    brain.add(brainContent);
    renderMemoryNodes();
    updateActivationConnections();
  });

  function resize() {
    const { width, height } = brainStage.getBoundingClientRect();
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function animate() {
    if (cameraFocus) {
      const progress = THREE.MathUtils.clamp(
        (performance.now() - cameraFocus.startedAt) / CAMERA_FOCUS_DURATION,
        0,
        1,
      );
      const eased = 1 - (1 - progress) ** 3;
      camera.position.lerpVectors(
        cameraFocus.fromPosition,
        cameraFocus.toPosition,
        eased,
      );
      controls.target.lerpVectors(
        cameraFocus.fromTarget,
        cameraFocus.toTarget,
        eased,
      );
      if (progress === 1) cameraFocus = null;
    }
    controls.update();
    if (hasActiveRegionMarkers && !reduceMotion.matches) {
      const elapsed = performance.now() * 0.004;
      regionMarkers.forEach((marker) => {
        const { isDeepRegion, weight, markerScale } = marker.userData;
        if (!weight) return;
        const pulse = 1 + Math.sin(elapsed) * (0.03 + weight * 0.05);
        marker.scale.setScalar(
          markerScale *
            (isDeepRegion ? 1.1 + weight * 0.55 : 0.85 + weight * 0.75) *
            pulse,
        );
      });
    }
    if (!reduceMotion.matches) {
      const elapsed = performance.now() * 0.001;
      animateMemoryNodes(elapsed);
      animateActivationConnections(elapsed);
    }
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  new ResizeObserver(resize).observe(brainStage);
  resize();
  animate();
}

renderBrainModel();
loadMemories();
