import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createAnatomicalBrainRenderer } from "./anatomical-brain-renderer.js";
import { BRAIN_ATLAS_URL } from "./anatomy-manifest.js";
import { renderLegacyBrain } from "../brain-legacy/render.js";
import {
  ENTITY_KIND_COLORS,
  buildEntitySpokes,
  calculateEntityHubPosition,
  calculateRelationshipPreviewPosition,
  filterEntityGraphMemories,
  filterMemoryLinksForVisibleMemories,
  getRelationshipCounterpart,
  getRelationshipDirection,
  normalizeMemoryLinkResponse,
  pushNavigation,
  restoreNavigation,
} from "./entity-lens.js";
import { createMemoryNodeState } from "./memory-placement.js";
import { filterMemoriesForSearch } from "./memory-search.js";
import { REGION_ANCHORS } from "./region-anchors.js";
import { LEGACY_REGION_COLORS } from "../brain-legacy/region-colors.js";
import {
  getHippocampalLaterality,
  getRegionContributions,
} from "./region-mapper.js";

const MAX_LENGTH = 180;
const USE_LEGACY_BRAIN =
  new URLSearchParams(window.location.search).get("brain") !== "legacy";
const SHOW_REGION_ANCHORS =
  new URLSearchParams(window.location.search).get("debugRegions") === "1";
const MIN_MEMORY_NODE_RADIUS = 0.09;
const MAX_MEMORY_NODE_RADIUS = 0.16;
const MIN_CONNECTION_RADIUS = 0.004;
const MAX_CONNECTION_RADIUS = 0.02;
const CONNECTION_SEGMENTS = 36;
const FLOW_PARTICLE_COUNT = 3;
const DEFAULT_MEMORY_COLOR = "#f4d8b4";
const REGION_LABEL_MIN_GAP = 36;
const ENTITY_HUB_RADIUS = 0.2;
const ENTITY_PREVIEW_RADIUS = 0.14;
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
  "entorhinal",
]);
const SEARCH_DEBOUNCE_MS = 300;
const SEMANTIC_SCORE_THRESHOLD = 0.25;
const RELATED_MEMORY_LIMIT = 5;
const RELATED_MEMORY_SCORE_THRESHOLD = 0.65;
const RELATED_LINK_COLOR = "#9ae6f5";

function getRegionColor(region) {
  return USE_LEGACY_BRAIN
    ? LEGACY_REGION_COLORS[region]
    : REGION_ANCHORS[region]?.color;
}

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
const brainFullscreenButton = document.querySelector("#brainFullscreenButton");
const memoryHoverPanel = document.querySelector("#memoryHoverPanel");
const clearSelectionButton = document.querySelector("#clearSelectionButton");
const regionLabels = document.querySelector("#regionLabels");
const searchInput = document.querySelector("#memorySearch");
const searchStatus = document.querySelector("#memorySearchStatus");
const resetFiltersButton = document.querySelector("#resetFiltersButton");

if (USE_LEGACY_BRAIN) {
  brainStage.style.setProperty(
    "--legacy-prefrontal-color",
    LEGACY_REGION_COLORS.prefrontal,
  );
  brainStage.style.setProperty(
    "--legacy-association-color",
    LEGACY_REGION_COLORS.associationCortex,
  );
}

let memories = [];
let selectedMemoryId = null;
let hoveredMemoryId = null;
let selectedRegion = null;
let hoveredRegion = null;
let selectedRegionMemoryId = null;
let extracting = false;
let regionMarkers = new Map();
let regionScenePositions = new Map();
// Set whenever regionScenePositions changes; consumed by updateRegionMarkers()
// to re-anchor markers to the measured centers before they're shown.
let regionMarkerPositionsDirty = false;
let regionLabelButtons = new Map();
let anatomicalBrainRenderer = null;
let memoryNodeState = new Map();
let memoryNodeGroup = null;
let memoryNodes = [];
let activationConnectionGroup = null;
let memoryConnections = [];
let relatedMemoryLinkGroup = null;
let entityLensGroup = null;
let entityLensHitTargets = [];
let brainCamera = null;
let brainControls = null;
let cameraFocus = null;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const pointerDown = new THREE.Vector2();
const DRAG_THRESHOLD = 5;
const CAMERA_FOCUS_DURATION = 450;
let activeFilter = "all";
let searchQuery = "";
let semanticSearch = createEmptySemanticSearch();
let searchDebounceTimer = null;
let searchRequestController = null;
let entityLens = null;
let entityRequestController = null;
let navigationHistory = [];
const entityGraphCache = new Map();
const relatedMemoryCache = new Map();
let relatedMemoryRequestController = null;
let relatedMemoryState = createEmptyRelatedMemoryState();

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
      resetEntityTraversal();
      selectedMemoryId = memory.id;
      entityGraphCache.clear();
      relatedMemoryCache.clear();
      resetRelatedMemoryState();
      navigationHistory = pushNavigation(navigationHistory, {
        type: "memory",
        id: memory.id,
        label: getMemoryNavigationLabel(memory),
      });
      if (searchQuery.trim()) scheduleSemanticSearch({ immediate: true });
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
    await Promise.all([
      fetch("/api/memories", { method: "DELETE" }),
      fetch("/api/entities", { method: "DELETE" }),
    ]);
  } catch (err) {
    console.error("Failed to clear:", err);
  }

  memories = [];
  selectedMemoryId = null;
  entityGraphCache.clear();
  relatedMemoryCache.clear();
  resetRelatedMemoryState();
  resetEntityTraversal();
  if (searchQuery.trim()) scheduleSemanticSearch({ immediate: true });
  render();
});

clearSelectionButton.addEventListener("click", clearSelection);
brainFullscreenButton.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement === brainStage) {
      await document.exitFullscreen();
    } else {
      await brainStage.requestFullscreen();
    }
  } catch (error) {
    console.error("Could not change brain fullscreen mode:", error);
  }
});

document.addEventListener("fullscreenchange", () => {
  const isFullscreen = document.fullscreenElement === brainStage;
  brainFullscreenButton.setAttribute("aria-pressed", String(isFullscreen));
  brainFullscreenButton.setAttribute(
    "aria-label",
    isFullscreen ? "Exit brain fullscreen" : "View brain in fullscreen",
  );
  brainFullscreenButton.querySelector(".brain-fullscreen-label").textContent =
    isFullscreen ? "Exit fullscreen" : "Fullscreen";
});

searchInput.addEventListener("input", () => {
  searchQuery = searchInput.value;
  scheduleSemanticSearch();
  render();
});
searchInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || !searchQuery.trim()) return;
  event.preventDefault();
  scheduleSemanticSearch({ immediate: true });
  render();
});
resetFiltersButton.addEventListener("click", resetFilters);
reduceMotion.addEventListener("change", () => {
  updateRegionMarkers();
  updateActivationConnections();
});

document.querySelectorAll(".filter-button").forEach((btn) => {
  btn.addEventListener("click", () => setFilter(btn.dataset.filter));
});

function normalizeServerMemory(m) {
  return {
    id: m.id,
    text: m.raw_text,
    createdAt: m.created_at,
    ingestionDate: m.ingestion_date,
    summary: m.summary,
    source: m.source || "ui",
    extraction: m.extraction?.extraction_json || m.extraction || null,
    entities: m.entities || [],
    relationships: m.relationships || [],
    regions: m.regions || [],
    fragments: buildFragments(m),
    ...(Number.isFinite(m.similarity) ? { similarity: m.similarity } : {}),
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

function getFilteredMemories() {
  const normalizedQuery = searchQuery.trim();
  const hasCurrentSemanticResults =
    semanticSearch.status === "success" &&
    semanticSearch.query === normalizedQuery;

  return filterMemoriesForSearch(memories, {
    query: normalizedQuery,
    source: activeFilter,
    semanticIds: hasCurrentSemanticResults ? semanticSearch.ids : null,
  });
}

function setFilter(filter) {
  activeFilter = filter;
  render();
}

function resetFilters() {
  activeFilter = "all";
  searchQuery = "";
  searchInput.value = "";
  resetSemanticSearch();
  render();
  searchInput.focus();
}

function updateFilterControls() {
  document.querySelectorAll(".filter-button").forEach((btn) => {
    const active = btn.dataset.filter === activeFilter;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", String(active));
  });
  resetFiltersButton.hidden =
    activeFilter === "all" && searchQuery.trim().length === 0;

  const query = searchQuery.trim();
  const hasCurrentStatus = semanticSearch.query === query;
  searchInput.setAttribute(
    "aria-busy",
    String(hasCurrentStatus && semanticSearch.status === "loading"),
  );
  searchStatus.classList.toggle(
    "is-error",
    hasCurrentStatus && semanticSearch.status === "error",
  );

  if (!query || !hasCurrentStatus || semanticSearch.status === "idle") {
    searchStatus.hidden = true;
    searchStatus.textContent = "";
  } else if (semanticSearch.status === "loading") {
    searchStatus.hidden = false;
    searchStatus.textContent = "Searching memory meaning...";
  } else if (semanticSearch.status === "error") {
    searchStatus.hidden = false;
    searchStatus.textContent =
      "Semantic search unavailable. Showing text matches.";
  } else {
    const visibleCount = getFilteredMemories().length;
    searchStatus.hidden = false;
    searchStatus.textContent = `${visibleCount} semantic ${
      visibleCount === 1 ? "match" : "matches"
    }`;
  }
}

function createEmptySemanticSearch() {
  return {
    query: "",
    status: "idle",
    ids: [],
    scores: new Map(),
  };
}

function createEmptyRelatedMemoryState() {
  return {
    memoryId: null,
    status: "idle",
    links: [],
    semanticAvailable: true,
    error: null,
  };
}

function resetRelatedMemoryState() {
  relatedMemoryRequestController?.abort();
  relatedMemoryRequestController = null;
  relatedMemoryState = createEmptyRelatedMemoryState();
  renderRelatedMemoryLinks3D();
}

function resetSemanticSearch() {
  window.clearTimeout(searchDebounceTimer);
  searchDebounceTimer = null;
  searchRequestController?.abort();
  searchRequestController = null;
  semanticSearch = createEmptySemanticSearch();
}

function scheduleSemanticSearch({ immediate = false } = {}) {
  window.clearTimeout(searchDebounceTimer);
  searchRequestController?.abort();
  searchRequestController = null;

  const query = searchQuery.trim();
  if (!query) {
    semanticSearch = createEmptySemanticSearch();
    return;
  }

  semanticSearch = {
    query,
    status: "loading",
    ids: [],
    scores: new Map(),
  };
  searchDebounceTimer = window.setTimeout(
    () => runSemanticSearch(query),
    immediate ? 0 : SEARCH_DEBOUNCE_MS,
  );
}

async function runSemanticSearch(query) {
  const controller = new AbortController();
  searchRequestController = controller;

  try {
    const response = await fetch(
      `/api/memories/search?q=${encodeURIComponent(
        query,
      )}&limit=100&scoreThreshold=${SEMANTIC_SCORE_THRESHOLD}`,
      { signal: controller.signal },
    );
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.detail || body.error || "Search request failed");
    }

    const result = await response.json();
    if (controller.signal.aborted || searchQuery.trim() !== query) return;

    const resultMemories = result.memories.map(normalizeServerMemory);
    mergeSearchMemories(resultMemories);
    semanticSearch = {
      query,
      status: "success",
      ids: resultMemories.map((memory) => memory.id),
      scores: new Map(
        result.memories.map((memory) => [memory.id, memory.similarity]),
      ),
    };
  } catch (error) {
    if (error.name === "AbortError") return;
    if (searchQuery.trim() !== query) return;
    console.error("Semantic search failed:", error);
    semanticSearch = {
      query,
      status: "error",
      ids: [],
      scores: new Map(),
    };
  } finally {
    if (searchRequestController === controller) {
      searchRequestController = null;
    }
  }

  render();
}

function mergeSearchMemories(searchMemories) {
  const knownIds = new Set(memories.map((memory) => memory.id));
  memories.push(
    ...searchMemories.filter((memory) => !knownIds.has(memory.id)),
  );
}

function syncRelatedMemoryRequest() {
  if (!selectedMemoryId) return;
  if (
    relatedMemoryState.memoryId === selectedMemoryId &&
    relatedMemoryState.status !== "idle"
  ) {
    return;
  }

  const cached = relatedMemoryCache.get(selectedMemoryId);
  if (cached) {
    relatedMemoryState = {
      ...cached,
      status: "success",
      error: null,
    };
    return;
  }

  requestRelatedMemories(selectedMemoryId);
}

async function requestRelatedMemories(memoryId, { force = false } = {}) {
  relatedMemoryRequestController?.abort();
  relatedMemoryRequestController = null;

  if (!force) {
    const cached = relatedMemoryCache.get(memoryId);
    if (cached) {
      relatedMemoryState = {
        ...cached,
        status: "success",
        error: null,
      };
      renderDetail();
      renderRelatedMemoryLinks3D();
      return;
    }
  }

  relatedMemoryState = {
    memoryId,
    status: "loading",
    links: [],
    semanticAvailable: true,
    error: null,
  };
  renderDetail();
  renderRelatedMemoryLinks3D();

  const controller = new AbortController();
  relatedMemoryRequestController = controller;
  try {
    const response = await fetch(
      `/api/memories/${encodeURIComponent(
        memoryId,
      )}/links?limit=${RELATED_MEMORY_LIMIT}&scoreThreshold=${
        RELATED_MEMORY_SCORE_THRESHOLD
      }`,
      { signal: controller.signal },
    );
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(
        body.detail ||
          body.error ||
          `Related memory request failed (${response.status})`,
      );
    }

    const normalized = normalizeMemoryLinkResponse(
      await response.json(),
      memoryId,
      RELATED_MEMORY_LIMIT,
    );
    if (controller.signal.aborted || selectedMemoryId !== memoryId) return;

    const linked = mergeRelatedMemories(normalized.links);
    const result = {
      memoryId,
      links: linked,
      semanticAvailable: normalized.semanticAvailable,
    };
    relatedMemoryCache.set(memoryId, result);
    relatedMemoryState = {
      ...result,
      status: "success",
      error: null,
    };
    render();
  } catch (error) {
    if (
      error.name === "AbortError" ||
      controller.signal.aborted ||
      selectedMemoryId !== memoryId
    ) {
      return;
    }
    console.error("Related memory lookup failed:", error);
    relatedMemoryState = {
      memoryId,
      status: "error",
      links: [],
      semanticAvailable: true,
      error: error.message,
    };
    renderDetail();
    renderRelatedMemoryLinks3D();
  } finally {
    if (relatedMemoryRequestController === controller) {
      relatedMemoryRequestController = null;
    }
  }
}

function mergeRelatedMemories(links) {
  const known = new Map(memories.map((memory) => [memory.id, memory]));

  return links.map((link) => {
    const normalized = normalizeServerMemory(link.memory);
    const existing = known.get(normalized.id);
    if (!existing) {
      memories.push(normalized);
      known.set(normalized.id, normalized);
    }
    return {
      ...link,
      memory: existing || normalized,
    };
  });
}

function render() {
  const filtered = getFilteredMemories();
  const visibleIds = new Set(filtered.map((memory) => memory.id));

  if (selectedMemoryId && !visibleIds.has(selectedMemoryId)) {
    resetRelatedMemoryState();
    selectedMemoryId = null;
    selectedRegion = null;
    hoveredRegion = null;
    cameraFocus = null;
  }
  if (
    hoveredMemoryId &&
    !visibleIds.has(hoveredMemoryId)
  ) {
    setHoveredMemory(null);
  }

  // The memory list, detail panel, and counts don't depend on measured region
  // positions, so they can update immediately on every render. Everything that
  // places nodes/connections/labels must wait for the GLTF atlas to report real
  // region centers — otherwise placement falls back to hardcoded anchors tuned
  // for the legacy OBJ brain and renders in the wrong location.
  syncRelatedMemoryRequest();
  syncSelectedRegion();
  updateFilterControls();
  memoryCount.textContent = filtered.length;
  emptyState.hidden = filtered.length > 0;
  renderMemoryList();
  renderDetail();
  updateClearSelectionButton();

  if (!regionScenePositions.size) return;

  memoryNodeState = createMemoryNodeState(filtered, regionScenePositions);
  renderMemoryNodes();
  updateRegionMarkers();
  updateActivationConnections();
  updateRegionLabels();
}

function selectMemory(
  id,
  { focusCamera = true, recordHistory = true } = {},
) {
  const memory = memories.find((item) => item.id === id);
  if (!memory) return;

  abortEntityRequest();
  entityLens = null;
  if (selectedMemoryId !== id) {
    resetRelatedMemoryState();
  }
  selectedMemoryId = id;
  hoveredRegion = null;
  selectedRegion = memoryNodeState.get(id)?.core.region || null;
  selectedRegionMemoryId = id;
  if (brainControls) brainControls.autoRotate = false;
  if (recordHistory) {
    navigationHistory = pushNavigation(navigationHistory, {
      type: "memory",
      id,
      label: getMemoryNavigationLabel(memory),
    });
  }
  renderDetail();
  updateMemoryListSelection();
  updateMemoryNodeSelection();
  renderEntityLens3D();
  syncRelatedMemoryRequest();
  renderRelatedMemoryLinks3D();
  updateRegionMarkers();
  updateActivationConnections();
  updateRegionLabels();
  updateClearSelectionButton();
  if (focusCamera) focusAnatomicalRegion(selectedRegion);
  const atlasPanel = document.querySelector(".atlas-panel");
  const scrollTarget = window.innerWidth <= 760 ? brainStage : atlasPanel;
  const atlasRect = scrollTarget.getBoundingClientRect();
  const inView = atlasRect.top >= 72 && atlasRect.bottom <= window.innerHeight;
  if (!inView) {
    scrollTarget.scrollIntoView({
      behavior: reduceMotion.matches ? "auto" : "smooth",
      block: window.innerWidth <= 760 ? "start" : "center",
    });
  }
}

function clearSelection() {
  resetEntityTraversal();
  resetRelatedMemoryState();
  selectedMemoryId = null;
  selectedRegion = null;
  selectedRegionMemoryId = null;
  hoveredRegion = null;
  cameraFocus = null;
  renderDetail();
  updateMemoryListSelection();
  updateMemoryNodeSelection();
  renderEntityLens3D();
  renderRelatedMemoryLinks3D();
  updateRegionMarkers();
  updateActivationConnections();
  updateRegionLabels();
  updateClearSelectionButton();
}

function syncSelectedRegion() {
  if (!selectedMemoryId) {
    selectedRegion = null;
    selectedRegionMemoryId = null;
    return;
  }

  // Region focus belongs to a memory selection, not to a render pass. Preserve
  // the user's pinned region while filters or background data updates rebuild
  // the scene; only choose a new default when the selected memory itself changes.
  if (selectedRegionMemoryId === selectedMemoryId) return;

  selectedRegionMemoryId = selectedMemoryId;
  const memory = memories.find(({ id }) => id === selectedMemoryId);
  selectedRegion = getSortedRegions(memory)[0]?.region || null;
}

function getActiveMemoryId() {
  if (entityLens) return hoveredMemoryId;
  return hoveredMemoryId || selectedMemoryId;
}

function getFocusedRegion() {
  if (entityLens) return null;
  if (hoveredRegion) return hoveredRegion;
  return getActiveMemoryId() === selectedMemoryId ? selectedRegion : null;
}

function setHoveredRegion(region) {
  if (hoveredRegion === region) return;
  hoveredRegion = region;
  updateRegionMarkers();
  updateActivationConnections();
  updateRegionInspectorSelection();
}

function selectRegion(region) {
  const state = memoryNodeState.get(selectedMemoryId);
  if (!state?.activations.some((activation) => activation.region === region)) {
    return;
  }

  selectedRegion = region;
  selectedRegionMemoryId = selectedMemoryId;
  hoveredRegion = null;
  updateRegionMarkers();
  updateActivationConnections();
  updateRegionInspectorSelection({ revealSelected: true });
  focusAnatomicalRegion(region);
}

function updateClearSelectionButton() {
  clearSelectionButton.hidden =
    selectedMemoryId == null && entityLens == null && navigationHistory.length === 0;
}

function resetEntityTraversal() {
  abortEntityRequest();
  entityLens = null;
  navigationHistory = [];
}

function abortEntityRequest() {
  entityRequestController?.abort();
  entityRequestController = null;
}

async function focusEntity(
  entityId,
  originMemoryId = selectedMemoryId,
  { entity: knownEntity = null, recordHistory = true } = {},
) {
  const id = Number(entityId);
  if (!Number.isInteger(id)) return;

  abortEntityRequest();
  selectedMemoryId = originMemoryId || selectedMemoryId;
  selectedRegion = null;
  hoveredRegion = null;
  hoveredMemoryId = null;
  entityLens = {
    entityId: id,
    originMemoryId: originMemoryId || selectedMemoryId,
    entity: knownEntity,
    graph: null,
    loading: true,
    error: null,
    previewRelationshipId: null,
    hasFocused: false,
  };
  renderRelatedMemoryLinks3D();
  if (recordHistory) {
    navigationHistory = pushNavigation(navigationHistory, {
      type: "entity",
      id,
      label: knownEntity?.canonical_name || `Entity ${id}`,
      kind: knownEntity?.kind || null,
      originMemoryId: entityLens.originMemoryId,
    });
  }
  render();

  const cached = entityGraphCache.get(id);
  if (cached) {
    applyEntityGraph(id, cached);
    return;
  }

  const controller = new AbortController();
  entityRequestController = controller;
  try {
    const response = await fetch(`/api/entities/${id}/graph`, {
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Entity request failed (${response.status})`);
    }
    const graph = normalizeEntityGraph(await response.json());
    entityGraphCache.set(id, graph);
    applyEntityGraph(id, graph);
  } catch (error) {
    if (error.name === "AbortError" || entityLens?.entityId !== id) return;
    entityLens = {
      ...entityLens,
      loading: false,
      error: error.message,
    };
    render();
  } finally {
    if (entityRequestController === controller) entityRequestController = null;
  }
}

function normalizeEntityGraph(graph) {
  return {
    ...graph,
    memories: (graph.memories || []).map(normalizeServerMemory),
    relationships: graph.relationships || [],
  };
}

function applyEntityGraph(entityId, graph) {
  if (entityLens?.entityId !== entityId) return;

  mergeEntityGraphMemories(graph.memories);
  entityLens = {
    ...entityLens,
    entity: graph.entity,
    graph,
    loading: false,
    error: null,
  };
  const last = navigationHistory.at(-1);
  if (last?.type === "entity" && Number(last.id) === entityId) {
    last.label = graph.entity.canonical_name;
    last.kind = graph.entity.kind;
  }
  render();
}

function mergeEntityGraphMemories(graphMemories) {
  const incoming = new Map(
    graphMemories.map((memory) => [memory.id, memory]),
  );
  memories = memories.map((memory) => incoming.get(memory.id) || memory);
  const knownIds = new Set(memories.map((memory) => memory.id));
  for (const memory of graphMemories) {
    if (!knownIds.has(memory.id)) memories.push(memory);
  }
}

function navigateToHistory(index) {
  const restored = restoreNavigation(navigationHistory, index);
  if (!restored.current) return;

  navigationHistory = restored.history;
  if (restored.current.type === "memory") {
    selectMemory(restored.current.id, { recordHistory: false });
    return;
  }
  focusEntity(
    restored.current.id,
    restored.current.originMemoryId,
    {
      entity: {
        id: Number(restored.current.id),
        canonical_name: restored.current.label,
        kind: restored.current.kind,
      },
      recordHistory: false,
    },
  );
}

function getMemoryNavigationLabel(memory) {
  const label = memory.summary || memory.text || memory.id;
  return label.length > 34 ? `${label.slice(0, 31)}...` : label;
}

function renderBreadcrumb() {
  if (!navigationHistory.length) return null;

  const nav = document.createElement("nav");
  nav.className = "detail-breadcrumb";
  nav.setAttribute("aria-label", "Traversal history");
  navigationHistory.forEach((entry, index) => {
    if (index > 0) {
      const separator = document.createElement("span");
      separator.textContent = "/";
      separator.setAttribute("aria-hidden", "true");
      nav.append(separator);
    }

    if (index === navigationHistory.length - 1) {
      const current = document.createElement("span");
      current.className = "breadcrumb-current";
      current.textContent = entry.label;
      nav.append(current);
      return;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = entry.label;
    button.addEventListener("click", () => navigateToHistory(index));
    nav.append(button);
  });
  return nav;
}

function renderDetail(sourceNode) {
  if (entityLens) {
    renderEntityDetail();
    return;
  }

  const memory = memories.find((item) => item.id === selectedMemoryId);
  detail.replaceChildren();

  if (!memory) {
    return;
  }

  const sourceLabel =
    sourceNode && sourceNode.type !== "event"
      ? `${sourceNode.type.toUpperCase()} / ${sourceNode.label}`
      : "MEMORY CORE";

  const header = document.createElement("div");
  header.className = "detail-header";
  const index = document.createElement("span");
  index.className = "detail-index";
  index.textContent = sourceLabel;
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "detail-close";
  closeBtn.setAttribute("aria-label", "Close detail panel");
  closeBtn.textContent = "\u2715";
  closeBtn.addEventListener("click", clearSelection);
  header.append(index, closeBtn);
  detail.append(header);

  const copy = document.createElement("div");
  copy.className = "detail-copy";
  copy.append(createDetailLabel("RAW MEMORY"));
  const text = document.createElement("p");
  text.textContent = memory.text;
  copy.append(text);

  const sidebar = document.createElement("div");
  sidebar.className = "detail-sidebar";

  if (memory.extraction) {
    const ex = memory.extraction;

    if (ex.summary) {
      copy.append(createDetailLabel("SUMMARY"));
      const summary = document.createElement("p");
      summary.className = "detail-summary";
      summary.textContent = ex.summary;
      copy.append(summary);
    }

    const storedEntities = memory.entities || [];
    if (storedEntities.length || ex.entities?.length) {
      const entities = document.createElement("div");
      entities.className = "detail-section";
      entities.innerHTML = '<span class="detail-label">ENTITIES</span>';
      if (storedEntities.length) {
        storedEntities.forEach((entity) => {
          entities.append(createEntityChip(entity, memory.id));
        });
      } else {
        ex.entities.forEach((entity) => {
          const chip = document.createElement("span");
          chip.className = `tag tag-${entity.kind}`;
          chip.textContent = `${entity.mention} [${entity.kind}]`;
          entities.append(chip);
        });
      }
      sidebar.append(entities);
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
      sidebar.append(rels);
    }
  }

  const body = document.createElement("div");
  body.className = "detail-body";
  body.append(copy, sidebar);
  detail.append(body);

  renderRegionExplanation(memory);
  renderRelatedMemoryDetail(memory);
}

function renderRelatedMemoryDetail(memory) {
  const section = document.createElement("section");
  section.className = "detail-section related-memory-section";
  section.append(createDetailLabel("RELATED MEMORIES"));

  if (
    relatedMemoryState.memoryId !== memory.id ||
    relatedMemoryState.status === "loading"
  ) {
    const loading = document.createElement("p");
    loading.className = "related-memory-status";
    loading.textContent = "Finding structural and semantic links...";
    section.append(loading);
    detail.append(section);
    return;
  }

  if (relatedMemoryState.status === "error") {
    const error = document.createElement("p");
    error.className = "related-memory-status related-memory-error";
    error.textContent = relatedMemoryState.error;
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "text-button";
    retry.textContent = "Retry";
    retry.addEventListener("click", () => {
      requestRelatedMemories(memory.id, { force: true });
    });
    section.append(error, retry);
    detail.append(section);
    return;
  }

  if (relatedMemoryState.status !== "success") {
    const idle = document.createElement("p");
    idle.className = "related-memory-status";
    idle.textContent = "Preparing related memories...";
    section.append(idle);
    detail.append(section);
    return;
  }

  if (!relatedMemoryState.semanticAvailable) {
    const unavailable = document.createElement("p");
    unavailable.className = "related-memory-status";
    unavailable.textContent =
      "Semantic lookup is unavailable; structural links are still shown.";
    section.append(unavailable);
  }

  const visibleIds = new Set(
    getFilteredMemories().map((candidate) => candidate.id),
  );
  const list = document.createElement("div");
  list.className = "related-memory-list";
  relatedMemoryState.links.forEach((link) => {
    const visible = visibleIds.has(link.memory.id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "related-memory-button";
    button.disabled = !visible;
    button.dataset.memoryId = link.memory.id;

    const heading = document.createElement("span");
    heading.className = "related-memory-heading";
    const title = document.createElement("strong");
    title.textContent =
      link.memory.summary || link.memory.text || `Memory ${link.memory.id}`;
    const score = document.createElement("span");
    score.className = "related-memory-score";
    score.textContent = `${formatPercent(link.score)} linked`;
    heading.append(title, score);
    button.append(heading);

    const reasons = buildRelatedMemoryReasons(link);
    if (reasons.length) {
      const reasonList = document.createElement("span");
      reasonList.className = "related-memory-reasons";
      reasons.forEach((reason) => {
        const item = document.createElement("span");
        item.textContent = reason;
        reasonList.append(item);
      });
      button.append(reasonList);
    }

    const metadata = document.createElement("span");
    metadata.className = "related-memory-metadata";
    metadata.textContent = visible
      ? getRelatedMemoryMetadata(link)
      : "Hidden by current filters";
    button.append(metadata);
    button.addEventListener("click", () => selectMemory(link.memory.id));
    list.append(button);
  });

  if (!relatedMemoryState.links.length) {
    const empty = document.createElement("p");
    empty.className = "related-memory-status";
    empty.textContent = "No related memories met the current score threshold.";
    list.append(empty);
  }
  section.append(list);
  detail.append(section);
}

function buildRelatedMemoryReasons(link) {
  const reasons = link.reasons
    .map((reason) => formatRelatedReason(reason))
    .filter(Boolean);
  if (link.sharedEntities.length) {
    reasons.push(
      `Shared entities: ${link.sharedEntities
        .map((entity) => getRelatedEntityLabel(entity))
        .filter(Boolean)
        .join(", ")}`,
    );
  }
  if (link.sharedRelationships.length) {
    reasons.push(
      `Shared relationships: ${link.sharedRelationships
        .map((relationship) => formatSharedRelationship(relationship))
        .filter(Boolean)
        .join("; ")}`,
    );
  }
  return [...new Set(reasons)];
}

function formatRelatedReason(reason) {
  if (typeof reason === "string") return reason;
  return reason?.label || reason?.reason || reason?.description || "";
}

function getRelatedEntityLabel(entity) {
  if (typeof entity === "string") return entity;
  return (
    entity?.canonical_name ||
    entity?.canonicalName ||
    entity?.name ||
    entity?.mention ||
    ""
  );
}

function formatSharedRelationship(relationship) {
  if (typeof relationship === "string") return relationship;
  const subject =
    relationship?.subject?.canonical_name ||
    relationship?.subject?.canonicalName ||
    relationship?.subject?.name ||
    relationship?.subject;
  const predicate = relationship?.predicate;
  const object =
    relationship?.object?.canonical_name ||
    relationship?.object?.canonicalName ||
    relationship?.object?.name ||
    relationship?.object;
  return [subject, predicate, object].filter(Boolean).join(" ");
}

function getRelatedMemoryMetadata(link) {
  const parts = [];
  if (link.semanticSimilarity != null) {
    parts.push(`${formatPercent(link.semanticSimilarity)} semantic similarity`);
  }
  parts.push(link.memory.source === "mcp" ? "Agent memory" : "User memory");
  return parts.join(" / ");
}

function createEntityChip(entity, originMemoryId) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = `tag entity-chip tag-${entity.kind}`;
  chip.textContent = `${entity.canonical_name} [${entity.kind}]`;
  chip.title =
    entity.mention && entity.mention !== entity.canonical_name
      ? `Mentioned as "${entity.mention}"`
      : `Explore ${entity.canonical_name}`;
  chip.addEventListener("click", () => {
    focusEntity(entity.id, originMemoryId, { entity });
  });
  return chip;
}

function renderEntityDetail() {
  detail.replaceChildren();
  const breadcrumb = renderBreadcrumb();
  if (breadcrumb) detail.append(breadcrumb);

  const header = document.createElement("div");
  header.className = "detail-header";
  const index = document.createElement("span");
  index.className = "detail-index";
  index.textContent = "ENTITY LENS";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "detail-close";
  closeBtn.setAttribute("aria-label", "Close detail panel");
  closeBtn.textContent = "\u2715";
  closeBtn.addEventListener("click", clearSelection);
  header.append(index, closeBtn);
  detail.append(header);

  const body = document.createElement("div");
  body.className = "detail-body";
  const copy = document.createElement("div");
  copy.className = "detail-copy entity-copy";
  body.append(copy);
  detail.append(body);

  if (entityLens.loading) {
    const loading = document.createElement("p");
    loading.className = "entity-status";
    loading.textContent = "Loading linked memories and relationships...";
    copy.append(loading);
    return;
  }

  if (entityLens.error) {
    const error = document.createElement("p");
    error.className = "entity-status entity-error";
    error.textContent = entityLens.error;
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "text-button";
    retry.textContent = "Retry";
    retry.addEventListener("click", () => {
      focusEntity(entityLens.entityId, entityLens.originMemoryId, {
        entity: entityLens.entity,
        recordHistory: false,
      });
    });
    copy.append(error, retry);
    return;
  }

  const graph = entityLens.graph;
  const entity = graph.entity;
  const visibleIds = new Set(
    getFilteredMemories().map((memory) => memory.id),
  );
  const visibility = filterEntityGraphMemories(graph, visibleIds);
  const heading = document.createElement("div");
  heading.className = "entity-heading";
  heading.style.setProperty(
    "--entity-color",
    ENTITY_KIND_COLORS[entity.kind] || DEFAULT_MEMORY_COLOR,
  );
  const marker = document.createElement("i");
  marker.setAttribute("aria-hidden", "true");
  const name = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = entity.canonical_name;
  const kind = document.createElement("span");
  kind.textContent = entity.kind;
  name.append(title, kind);
  heading.append(marker, name);

  const count = document.createElement("p");
  count.className = "entity-count";
  count.textContent = `${visibility.visible.length} visible of ${
    visibility.total
  } linked ${visibility.total === 1 ? "memory" : "memories"}`;
  copy.append(heading, count);

  const memoriesSection = document.createElement("section");
  memoriesSection.className = "detail-section entity-memory-section";
  memoriesSection.append(createDetailLabel("LINKED MEMORIES"));
  const memoryListElement = document.createElement("div");
  memoryListElement.className = "entity-memory-list";

  graph.memories.forEach((memory) => {
    const visible = visibleIds.has(memory.id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "entity-memory-button";
    button.dataset.memoryId = memory.id;
    button.disabled = !visible;
    const label = document.createElement("strong");
    label.textContent = memory.summary || memory.text;
    const meta = document.createElement("span");
    meta.textContent = visible
      ? `${memory.source === "mcp" ? "Agent" : "User"} memory`
      : "Hidden by current filters";
    button.append(label, meta);
    button.addEventListener("click", () => selectMemory(memory.id));
    memoryListElement.append(button);
  });
  if (!graph.memories.length) {
    const empty = document.createElement("p");
    empty.className = "entity-status";
    empty.textContent = "No memories are linked to this entity.";
    memoryListElement.append(empty);
  }
  memoriesSection.append(memoryListElement);
  detail.append(memoriesSection);

  const relationshipsSection = document.createElement("section");
  relationshipsSection.className = "detail-section relationship-section";
  relationshipsSection.append(createDetailLabel("EXPLICIT RELATIONSHIPS"));
  const relationshipsList = document.createElement("div");
  relationshipsList.className = "relationship-list";
  graph.relationships.forEach((relationship) => {
    relationshipsList.append(
      createRelationshipRow(relationship, visibleIds),
    );
  });
  if (!graph.relationships.length) {
    const empty = document.createElement("p");
    empty.className = "entity-status";
    empty.textContent = "No explicit relationships were extracted.";
    relationshipsList.append(empty);
  }
  relationshipsSection.append(relationshipsList);
  detail.append(relationshipsSection);
}

function createRelationshipRow(relationship, visibleIds) {
  const row = document.createElement("article");
  row.className = "relationship-row";
  row.tabIndex = 0;
  row.dataset.relationshipId = relationship.id;

  const sentence = document.createElement("div");
  sentence.className = "relationship-sentence";
  sentence.append(
    createRelationshipEntityControl(relationship.source, relationship),
  );
  const predicate = document.createElement("span");
  predicate.className = "relationship-predicate";
  predicate.textContent = `\u2192 ${relationship.predicate} \u2192`;
  sentence.append(
    predicate,
    createRelationshipEntityControl(relationship.target, relationship),
  );

  const metadata = document.createElement("div");
  metadata.className = "relationship-metadata";
  const confidence = document.createElement("span");
  confidence.textContent = `${formatPercent(
    relationship.confidence,
  )} confidence`;
  const evidenceMemory = entityLens.graph.memories.find(
    (memory) => memory.id === relationship.memory_id,
  );
  const evidenceButton = document.createElement("button");
  evidenceButton.type = "button";
  evidenceButton.disabled = !visibleIds.has(relationship.memory_id);
  evidenceButton.textContent = evidenceMemory
    ? `Evidence: ${getMemoryNavigationLabel(evidenceMemory)}`
    : "Evidence memory unavailable";
  evidenceButton.addEventListener("click", () => {
    selectMemory(relationship.memory_id);
  });
  metadata.append(confidence, evidenceButton);

  row.append(sentence, metadata);
  if (relationship.evidence) {
    const evidence = document.createElement("blockquote");
    evidence.textContent = relationship.evidence;
    row.append(evidence);
  }

  row.addEventListener("pointerenter", () => {
    setRelationshipPreview(relationship.id);
  });
  row.addEventListener("pointerleave", () => setRelationshipPreview(null));
  row.addEventListener("focusin", () => {
    setRelationshipPreview(relationship.id);
  });
  row.addEventListener("focusout", (event) => {
    if (!row.contains(event.relatedTarget)) setRelationshipPreview(null);
  });
  return row;
}

function createRelationshipEntityControl(entity, relationship) {
  if (Number(entity.id) === entityLens.entityId) {
    const current = document.createElement("span");
    current.className = `relationship-entity tag-${entity.kind}`;
    current.textContent = entity.canonical_name;
    return current;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = `relationship-entity tag-${entity.kind}`;
  button.textContent = entity.canonical_name;
  button.addEventListener("click", () => {
    focusEntity(entity.id, relationship.memory_id, { entity });
  });
  return button;
}

function setRelationshipPreview(relationshipId) {
  if (!entityLens || entityLens.previewRelationshipId === relationshipId) {
    return;
  }
  entityLens.previewRelationshipId = relationshipId;
  renderEntityLens3D();
  updateMemoryNodeSelection();
  updateMemoryListEntityState();
}

function createDetailLabel(text) {
  const label = document.createElement("span");
  label.className = "detail-label";
  label.textContent = text;
  return label;
}

function createRegionRoleTable(memory) {
  const regions = getSortedRegions(memory);
  if (!regions.length) return null;

  const table = document.createElement("table");
  table.className = "region-role-table memory-region-table";
  table.setAttribute("aria-label", "Selected brain areas and their roles");
  const tableHead = document.createElement("thead");
  tableHead.innerHTML = "<tr><th>Area</th><th>Role</th></tr>";
  const tableBody = document.createElement("tbody");

  regions.forEach(({ region }) => {
    const anchor = REGION_ANCHORS[region];
    const row = document.createElement("tr");
    row.dataset.region = region;
    const areaCell = document.createElement("th");
    areaCell.scope = "row";
    const areaButton = document.createElement("button");
    areaButton.type = "button";
    areaButton.style.setProperty("--region-color", getRegionColor(region));
    areaButton.textContent = anchor.label;
    areaButton.addEventListener("click", () => selectRegion(region));
    areaCell.append(areaButton);
    const roleCell = document.createElement("td");
    roleCell.textContent = anchor.role;
    row.append(areaCell, roleCell);
    tableBody.append(row);
  });

  table.append(tableHead, tableBody);
  return table;
}

function renderRegionExplanation(memory) {
  const section = document.createElement("section");
  section.className = "detail-section activation-detail";
  section.append(createDetailLabel("BRAIN REGIONS"));

  const regions = getSortedRegions(memory);

  if (!regions.length) {
    const empty = document.createElement("p");
    empty.className = "activation-empty";
    empty.textContent =
      "No region data is stored for this memory. Re-extract it to calculate activation.";
    section.append(empty);
    detail.append(section);
    return;
  }

  const summary = document.createElement("div");
  summary.className = "activation-summary";
  const count = document.createElement("strong");
  count.textContent = `1 memory \u00b7 ${regions.length} active ${
    regions.length === 1 ? "region" : "regions"
  }`;
  const clarification = document.createElement("p");
  clarification.textContent =
    "Why these areas? The atlas maps extracted memory type, emotion, and physical actions to brain regions. Scores are relative, not measured activity.";
  summary.append(count, clarification);
  section.append(summary);

  const activationList = document.createElement("div");
  activationList.className = "activation-list";

  const contributions = memory.extraction
    ? getRegionContributions(memory.extraction)
    : [];

  regions.forEach((activation, index) => {
    const { region, weight } = activation;
    const anchor = REGION_ANCHORS[region];
    const item = document.createElement("article");
    item.className = "activation-item";
    item.dataset.region = region;
    item.addEventListener("pointerenter", () => setHoveredRegion(region));
    item.addEventListener("pointerleave", () => setHoveredRegion(null));

    const heading = document.createElement("button");
    heading.type = "button";
    heading.className = "activation-heading";
    heading.setAttribute(
      "aria-label",
      `Focus ${anchor.label}, ${formatPercent(weight)} relative activation`,
    );
    heading.addEventListener("focus", () => setHoveredRegion(region));
    heading.addEventListener("blur", () => setHoveredRegion(null));
    heading.addEventListener("click", () => selectRegion(region));
    const name = document.createElement("span");
    name.className = "activation-name";
    const swatch = document.createElement("i");
    swatch.style.backgroundColor = getRegionColor(region);
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
    fill.style.backgroundColor = getRegionColor(region);
    meter.append(fill);

    const reasons = document.createElement("ul");
    reasons.className = "activation-reasons";
    const explanation = document.createElement("details");
    explanation.className = "activation-explanation";
    explanation.open = region === selectedRegion;
    const explanationToggle = document.createElement("summary");
    explanationToggle.textContent = "Why this area?";
    explanation.addEventListener("toggle", () => {
      if (explanation.open && selectedRegion !== region) {
        selectRegion(region);
      }
    });
    const regionContributions = contributions.filter(
      (contribution) => contribution.region === region && contribution.amount > 0
    );

    if (index === 0) {
      reasons.append(
        createReason(
          "This area has the highest combined score, so the memory node is placed nearest to it.",
        ),
      );
    }

    regionContributions.forEach((contribution) => {
      reasons.append(createContributionReason(contribution, anchor.label));
    });

    if (!regionContributions.length) {
      reasons.append(createReason("Stored activation; source breakdown is unavailable."));
    }

    explanation.append(explanationToggle);
    if (region === "hippocampus" && activation.hemispheres) {
      explanation.append(
        createHippocampalLateralityDetail(memory, activation),
      );
    }
    explanation.append(reasons);
    item.append(heading, meter, explanation);
    activationList.append(item);
  });

  section.append(activationList);
  detail.append(section);
  updateRegionInspectorSelection({ revealSelected: true });
}

function createHippocampalLateralityDetail(memory, activation) {
  const total = activation.hemispheres.left + activation.hemispheres.right;
  const leftShare = total > 0 ? activation.hemispheres.left / total : 0.5;
  const rightShare = total > 0 ? activation.hemispheres.right / total : 0.5;
  const difference = Math.abs(leftShare - rightShare);
  const laterality = getHippocampalLaterality(memory.extraction || {});
  const detailBlock = document.createElement("div");
  detailBlock.className = "hippocampal-laterality";

  const heading = document.createElement("div");
  heading.className = "laterality-heading";
  const title = document.createElement("strong");
  title.textContent = "Share of hippocampal activation";
  const status = document.createElement("span");
  status.textContent = difference < 0.06
    ? "Bilateral"
    : leftShare > rightShare
      ? "Left-weighted"
      : "Right-weighted";
  heading.append(title, status);

  const meter = document.createElement("div");
  meter.className = "laterality-meter";
  meter.setAttribute(
    "aria-label",
    `Left ${formatPercent(leftShare)}, right ${formatPercent(rightShare)}`,
  );
  const leftFill = document.createElement("span");
  leftFill.className = "laterality-left";
  leftFill.style.width = formatPercent(leftShare);
  const rightFill = document.createElement("span");
  rightFill.className = "laterality-right";
  rightFill.style.width = formatPercent(rightShare);
  meter.append(leftFill, rightFill);

  const labels = document.createElement("div");
  labels.className = "laterality-labels";
  const leftLabel = document.createElement("span");
  leftLabel.textContent = `Left ${formatPercent(leftShare)}`;
  const rightLabel = document.createElement("span");
  rightLabel.textContent = `Right ${formatPercent(rightShare)}`;
  labels.append(leftLabel, rightLabel);

  const evidence = document.createElement("ul");
  evidence.className = "laterality-evidence";
  laterality.cues.forEach((cue) => {
    const item = document.createElement("li");
    item.textContent =
      `${capitalize(cue.kind)} cue: "${cue.evidence}" `
      + `(${formatPercent(cue.weight)} weight, `
      + `${formatPercent(cue.confidence)} confidence).`;
    evidence.append(item);
  });
  if (!laterality.cues.length) {
    const item = document.createElement("li");
    item.textContent = laterality.spatialSignal > 0
      ? "The extracted spatial memory type supplies the modest rightward bias."
      : "No lateralizing content cue was extracted, so the split remains balanced.";
    evidence.append(item);
  }

  const clarification = document.createElement("p");
  clarification.textContent =
    "This is an explanatory heuristic, not measured neural activity or a storage location.";
  detailBlock.append(heading, meter, labels, evidence, clarification);
  return detailBlock;
}

function getSortedRegions(memory) {
  return [...(memory?.regions || [])]
    .filter(
      ({ region, weight }) =>
        REGION_ANCHORS[region] && Number.isFinite(weight) && weight > 0,
    )
    .sort((a, b) => b.weight - a.weight || a.region.localeCompare(b.region));
}

function updateRegionInspectorSelection({ revealSelected = false } = {}) {
  const focusedRegion = getFocusedRegion();

  // The activation rows and role table in the detail panel are rendered for the
  // SELECTED memory (see renderDetail). Only apply is-focused when the focused
  // region is actually one of that memory's activations — otherwise hovering a
  // different memory's region on the brain would highlight a row whose region
  // belongs to a foreign memory, producing the "highlighting is elsewhere"
  // mismatch between the inspector and the 3D view.
  const selectedMemory = memories.find((item) => item.id === selectedMemoryId);
  const inspectorRegions = new Set(
    selectedMemory?.regions
      ?.filter(({ weight }) => Number(weight) > 0)
      .map(({ region }) => region) || [],
  );
  const inspectorFocused = getActiveMemoryId() === selectedMemoryId
    && focusedRegion
    && inspectorRegions.has(focusedRegion)
    ? focusedRegion
    : null;

  detail.querySelectorAll(".activation-item").forEach((item) => {
    const focused = item.dataset.region === inspectorFocused;
    const selected = item.dataset.region === selectedRegion;
    item.classList.toggle("is-focused", focused);
    item.querySelector(".activation-heading")?.setAttribute(
      "aria-pressed",
      String(selected),
    );
    if (revealSelected) {
      const explanation = item.querySelector(".activation-explanation");
      if (explanation) explanation.open = selected;
    }
  });

  detail.querySelectorAll(".region-role-table tr[data-region]").forEach((row) => {
    const focused = row.dataset.region === inspectorFocused;
    const selected = row.dataset.region === selectedRegion;
    row.classList.toggle("is-focused", focused);
    row.classList.toggle("is-selected", selected);
  });

  // The on-stage region label buttons belong to the active (hovered-or-
  // selected) memory and mirror the 3D brain, so they always follow the live
  // focus without the per-memory guard above.
  regionLabelButtons.forEach((button, region) => {
    const focused = region === focusedRegion;
    button.classList.toggle("is-focused", focused);
    button.setAttribute("aria-pressed", String(region === selectedRegion));
  });
}

function createContributionReason(contribution, regionLabel) {
  if (contribution.source === "type") {
    return createReason(
      `The memory was classified as ${contribution.type} (${formatPercent(
        contribution.typeWeight
      )} weight). The atlas maps ${formatPercent(
        contribution.ruleWeight
      )} of that memory-type signal to ${regionLabel}.`
    );
  }

  if (contribution.source === "emotion") {
    const reason = createReason(
      `The extracted "${contribution.label}" emotion has ${formatPercent(
        contribution.intensity
      )} intensity and ${formatPercent(
        contribution.arousal,
      )} arousal. The atlas maps ${formatPercent(
        contribution.ruleWeight,
      )} of that emotional signal to ${regionLabel}.`
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
    `The physical action "${contribution.action}" adds a motor signal, which selects Motor cortex.`
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
  const filtered = getFilteredMemories();
  const hasSemanticResults =
    semanticSearch.status === "success" &&
    semanticSearch.query === searchQuery.trim();

  if (!filtered.length) {
    const empty = document.createElement("p");
    empty.className = "memory-empty";
    if (semanticSearch.status === "loading" && searchQuery.trim()) {
      empty.textContent = "Searching memory meaning...";
    } else {
      empty.textContent = memories.length
        ? "No memories match the current search and filters."
        : "No traces yet. Record a moment to begin the atlas.";
    }
    memoryList.append(empty);
    return;
  }

  filtered.forEach((memory, index) => {
    const card = cardTemplate.content.firstElementChild.cloneNode(true);
    card.querySelector(".memory-number").textContent = hasSemanticResults
      ? `MATCH ${String(index + 1).padStart(2, "0")}`
      : `TRACE ${String(filtered.length - index).padStart(2, "0")}`;
    card.querySelector("time").textContent = formatDate(memory.createdAt);
    card.querySelector(".memory-text").textContent = memory.text;
    card.dataset.memoryId = memory.id;
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-pressed", String(memory.id === selectedMemoryId));

    const similarity = semanticSearch.scores.get(memory.id);
    if (hasSemanticResults && Number.isFinite(similarity)) {
      const score = document.createElement("span");
      score.className = "memory-similarity";
      score.textContent = `${Math.round(
        THREE.MathUtils.clamp(similarity, 0, 1) * 100,
      )}% semantic`;
      card.querySelector(".memory-card-top").insertBefore(
        score,
        card.querySelector("time"),
      );
    }

    const tags = card.querySelector(".memory-tags");
    memory.fragments.forEach((item) => {
      const tag = document.createElement("span");
      tag.className = `tag tag-${item.type}`;
      tag.textContent = item.label;
      tags.append(tag);
    });

    card.addEventListener("click", () =>
      selectMemory(memory.id, { focusCamera: false }),
    );
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      selectMemory(memory.id, { focusCamera: false });
    });
    memoryList.append(card);
  });
  updateMemoryListEntityState();
}

function updateMemoryListSelection() {
  memoryList.querySelectorAll(".memory-card").forEach((card) => {
    card.setAttribute(
      "aria-pressed",
      String(card.dataset.memoryId === String(selectedMemoryId)),
    );
  });
  updateMemoryListEntityState();
}

function updateMemoryListEntityState() {
  const relatedIds = new Set(
    entityLens?.graph?.memories.map((memory) => memory.id) || [],
  );
  const evidenceMemoryId = getPreviewRelationship()?.memory_id || null;

  memoryList.querySelectorAll(".memory-card").forEach((card) => {
    card.classList.toggle(
      "is-entity-related",
      relatedIds.has(card.dataset.memoryId),
    );
    card.classList.toggle(
      "is-relationship-evidence",
      card.dataset.memoryId === evidenceMemoryId,
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

    anchor.visible = false;
    regionMarkers.set(region, anchor);

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

function updateRegionMarkers() {
  // Always re-anchor markers to the latest measured positions before showing
  // them. The GLTF load callback populates regionScenePositions once; this
  // guarantees markers can never drift from the real anatomy even if the
  // model reloads or the brainContent transform changes after boot.
  syncRegionMarkerPositions();

  regionMarkers.forEach((marker) => { marker.visible = false; });

  if (anatomicalBrainRenderer && !regionScenePositions.size) {
    anatomicalBrainRenderer.clearActivations();
    anatomicalBrainRenderer.setSelectedRegion(null).setHoveredRegion(null);
    return;
  }

  if (entityLens) {
    anatomicalBrainRenderer?.clearActivations();
    anatomicalBrainRenderer?.setSelectedRegion(null).setHoveredRegion(null);
    return;
  }

  const activeMemoryId = getActiveMemoryId();
  const memory = memories.find((item) => item.id === activeMemoryId);
  if (!memory) {
    anatomicalBrainRenderer?.clearActivations();
    anatomicalBrainRenderer?.setSelectedRegion(null).setHoveredRegion(null);
    return;
  }

  memory.regions.forEach(({ region, weight }) => {
    const marker = regionMarkers.get(region);
    if (marker) marker.visible = Number(weight) > 0;
  });

  anatomicalBrainRenderer?.setMemoryActivations(memory.regions);
  anatomicalBrainRenderer?.setSelectedRegion(
    activeMemoryId === selectedMemoryId ? selectedRegion : null,
  );
  anatomicalBrainRenderer?.setHoveredRegion(hoveredRegion);
}

// Re-position region markers from the measured atlas centers. Called on every
// updateRegionMarkers() but only does work when positions are dirty, so it's
// cheap on the steady-state hover/select path. This is the single source of
// truth for marker position after load — previously markers were positioned
// exactly once in the GLTF onLoad callback and could go stale.
function syncRegionMarkerPositions() {
  if (!regionMarkerPositionsDirty || !regionScenePositions.size) return;
  regionMarkerPositionsDirty = false;
  for (const [region, measured] of regionScenePositions) {
    const marker = regionMarkers.get(region);
    if (!marker || !measured?.center) continue;
    marker.position.fromArray(measured.center);
  }
}

function updateActivationConnections() {
  if (!activationConnectionGroup) return;

  if (anatomicalBrainRenderer && !regionScenePositions.size) {
    memoryConnections.forEach((connection) => {
      connection.userData.tubeMaterial.opacity = 0;
      connection.userData.glowMaterial.opacity = 0;
      connection.userData.flowParticles.forEach((particle) => {
        particle.visible = false;
      });
    });
    return;
  }

  if (entityLens) {
    memoryConnections.forEach((connection) => {
      connection.userData.tubeMaterial.opacity = 0;
      connection.userData.glowMaterial.opacity = 0;
      connection.userData.flowParticles.forEach((particle) => {
        particle.visible = false;
      });
    });
    return;
  }

  const activeMemoryId = getActiveMemoryId();
  const focusedRegion = getFocusedRegion();
  memoryConnections.forEach((connection) => {
    const active = connection.userData.memoryId === activeMemoryId;
    const { weight, tubeMaterial, glowMaterial, flowParticles } =
      connection.userData;
    const focused = connection.userData.region === focusedRegion;
    // A selected memory shows its complete activation fan-out. Focusing a
    // region strengthens that path without erasing the surrounding network.
    const visible = active;
    const opacity = !visible
      ? 0
      : focused
        ? THREE.MathUtils.lerp(0.72, 0.85, weight)
        : THREE.MathUtils.lerp(0.6, 0.72, weight);

    tubeMaterial.opacity = Math.min(opacity, 1);
    glowMaterial.opacity = Math.min(opacity * (focused ? 0.38 : 0.24), 1);
    flowParticles.forEach((particle) => {
      particle.visible =
        visible && !reduceMotion.matches;
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

function updateRegionLabels() {
  if (anatomicalBrainRenderer && !regionScenePositions.size) {
    regionLabels.replaceChildren();
    regionLabelButtons = new Map();
    regionLabels.dataset.memoryId = "";
    regionLabels.hidden = true;
    return;
  }

  if (entityLens) {
    regionLabels.replaceChildren();
    regionLabelButtons = new Map();
    regionLabels.dataset.memoryId = "";
    regionLabels.hidden = true;
    return;
  }

  // Labels must track the same memory the 3D brain highlights. Previously this
  // used a narrower check that excluded the hovered memory unless it matched
  // the selected one, so hovering memory B lit up B's regions on the brain
  // while the on-stage labels still belonged to (or were hidden for) memory A.
  // Using getActiveMemoryId() keeps the brain and the label rail in sync.
  const visibleMemoryId = getActiveMemoryId();
  const memory = memories.find((item) => item.id === visibleMemoryId);

  if (!memory) {
    regionLabels.replaceChildren();
    regionLabelButtons = new Map();
    regionLabels.dataset.memoryId = "";
    regionLabels.hidden = true;
    return;
  }

  if (regionLabels.dataset.memoryId === memory.id) {
    regionLabels.hidden = false;
    updateRegionInspectorSelection();
    return;
  }

  regionLabels.replaceChildren();
  regionLabelButtons = new Map();
  regionLabels.dataset.memoryId = memory.id;
  regionLabels.hidden = false;

  getSortedRegions(memory).forEach(({ region, weight }) => {
    const anchor = REGION_ANCHORS[region];
    const button = document.createElement("button");
    const swatch = document.createElement("i");
    const label = document.createElement("span");
    const percentage = document.createElement("strong");

    button.type = "button";
    button.className = "region-label";
    button.dataset.region = region;
    button.dataset.role = anchor.role;
    if (DEEP_BRAIN_REGIONS.has(region)) button.dataset.deep = "true";
    button.style.setProperty("--region-color", getRegionColor(region));
    button.style.setProperty(
      "--region-weight",
      THREE.MathUtils.clamp(Number(weight) || 0, 0, 1).toFixed(3),
    );
    button.setAttribute(
      "aria-label",
      `Focus ${anchor.label}, ${formatPercent(weight)} activation`,
    );
    swatch.setAttribute("aria-hidden", "true");
    label.textContent = anchor.label;
    percentage.textContent = formatPercent(weight);
    button.append(swatch, label, percentage);

    button.addEventListener("pointerenter", () => setHoveredRegion(region));
    button.addEventListener("pointerleave", () => setHoveredRegion(null));
    button.addEventListener("focus", () => setHoveredRegion(region));
    button.addEventListener("blur", () => setHoveredRegion(null));
    button.addEventListener("click", () => selectRegion(region));

    regionLabels.append(button);
    regionLabelButtons.set(region, button);
  });

  updateRegionInspectorSelection();
}

function updateRegionLabelPositions(camera) {
  if (anatomicalBrainRenderer && !regionScenePositions.size) return;
  if (regionLabels.hidden || !regionLabelButtons.size) return;

  const { width, height } = brainStage.getBoundingClientRect();
  const marginX = Math.min(100, Math.max(62, width * 0.12));
  const marginY = 34;
  const projected = new THREE.Vector3();
  const sides = { left: [], right: [] };

  regionLabelButtons.forEach((button, region) => {
    const marker = regionMarkers.get(region);
    if (!marker?.visible) {
      button.hidden = true;
      return;
    }

    marker.getWorldPosition(projected);
    projected.project(camera);
    if (projected.z < -1 || projected.z > 1) {
      button.hidden = true;
      return;
    }

    button.hidden = false;
    const screenX = (projected.x * 0.5 + 0.5) * width;
    const side = screenX < width / 2 ? "left" : "right";
    sides[side].push({
      button,
      x: THREE.MathUtils.clamp(
        screenX + (side === "left" ? -28 : 28),
        marginX,
        width - marginX,
      ),
      y: THREE.MathUtils.clamp(
        (-projected.y * 0.5 + 0.5) * height,
        marginY,
        height - marginY,
      ),
    });
  });

  Object.values(sides).forEach((items) => {
    items.sort((a, b) => a.y - b.y);
    for (let index = 1; index < items.length; index += 1) {
      items[index].y = Math.max(
        items[index].y,
        items[index - 1].y + REGION_LABEL_MIN_GAP,
      );
    }

    const overflow = items.at(-1)?.y - (height - marginY);
    if (overflow > 0) {
      items.forEach((item) => {
        item.y -= overflow;
      });
    }

    items.forEach(({ button, x, y }) => {
      button.style.left = `${x}px`;
      button.style.top = `${THREE.MathUtils.clamp(y, marginY, height - marginY)}px`;
    });
  });
}

function renderMemoryNodes() {
  if (!memoryNodeGroup) return;
  if (anatomicalBrainRenderer && !regionScenePositions.size) return;

  disposeGroupContents(memoryNodeGroup);
  disposeGroupContents(activationConnectionGroup);
  memoryNodeGroup.clear();
  activationConnectionGroup.clear();
  memoryNodes = [];
  memoryConnections = [];

  const filtered = getFilteredMemories();
  filtered.forEach((memory, index) => {
    const state = memoryNodeState.get(memory.id);
    if (!state) return;

    const dominantType = getDominantMemoryType(memory.extraction?.types);
    const salience = THREE.MathUtils.clamp(
      Number(memory.extraction?.salience) || 0,
      0,
      1,
    );
    const radius = THREE.MathUtils.lerp(
      MIN_MEMORY_NODE_RADIUS,
      MAX_MEMORY_NODE_RADIUS,
      salience,
    );
    const material = new THREE.MeshStandardMaterial({
      color: DEFAULT_MEMORY_COLOR,
      emissive: DEFAULT_MEMORY_COLOR,
      emissiveIntensity: 0.55,
      roughness: 0.16,
      metalness: 0,
      transparent: true,
      opacity: 0.95,
      // depthTest:false lets each memory glow through the solid brain shell so
      // memories inside the volume stay visible instead of being occluded.
      depthTest: false,
      depthWrite: false,
    });
    const node = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 20, 14),
      material,
    );

    node.name = `memory-core:${memory.id}`;
    node.position.set(...state.core.position);
    // Render after the shell so memories always draw on top and read clearly
    // through the surface from any angle.
    node.renderOrder = 10;
    node.userData = {
      memoryId: memory.id,
      region: state.core.region,
      weight: state.core.weight,
      dominantType,
      salience,
      pulseOffset: index * 0.73,
      selectionScale: 1,
    };

    const aura = createEmotionAura(memory.extraction?.emotions, radius);
    if (aura) node.add(aura);

    memoryNodeGroup.add(node);
    memoryNodes.push(node);
    createActivationConnections(memory.id, state);
  });

  updateMemoryNodeSelection();
  updateRegionMarkers();
  updateRegionLabels();
  renderEntityLens3D();
  renderRelatedMemoryLinks3D();
}

function renderRelatedMemoryLinks3D() {
  if (!relatedMemoryLinkGroup) return;

  disposeGroupContents(relatedMemoryLinkGroup);
  relatedMemoryLinkGroup.clear();
  relatedMemoryLinkGroup.visible = !entityLens;
  if (
    entityLens ||
    !selectedMemoryId ||
    relatedMemoryState.memoryId !== selectedMemoryId ||
    relatedMemoryState.status !== "success"
  ) {
    return;
  }

  const visibleIds = new Set(
    getFilteredMemories().map((memory) => memory.id),
  );
  const links = filterMemoryLinksForVisibleMemories(
    relatedMemoryState.links,
    visibleIds,
    RELATED_MEMORY_LIMIT,
  );
  const source = getMemoryCore(selectedMemoryId);
  if (!source) return;

  links.forEach((link) => {
    const target = getMemoryCore(link.memory.id);
    if (!target) return;
    relatedMemoryLinkGroup.add(
      createRelatedMemoryLink(
        source.position,
        target.position,
        link.memory.id,
        link.score,
      ),
    );
  });
}

function createRelatedMemoryLink(startPosition, endPosition, memoryId, score) {
  const start = startPosition.clone();
  const end = endPosition.clone();
  const midpoint = start
    .clone()
    .add(end)
    .multiplyScalar(0.5);
  const outward = midpoint.lengthSq()
    ? midpoint.clone().normalize()
    : new THREE.Vector3(0, 0, 1);
  const distance = start.distanceTo(end);
  const control = midpoint.add(
    outward.multiplyScalar(0.16 + Math.min(distance, 2.4) * 0.12),
  );
  const curve = new THREE.QuadraticBezierCurve3(start, control, end);
  const strength = THREE.MathUtils.clamp(Number(score) || 0, 0, 1);
  const radius = THREE.MathUtils.lerp(0.004, 0.01, strength);
  const material = new THREE.MeshBasicMaterial({
    color: RELATED_LINK_COLOR,
    transparent: true,
    opacity: THREE.MathUtils.lerp(0.6, 0.85, strength),
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  });
  const link = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 30, radius, 6, false),
    material,
  );
  link.name = `related-memory-link:${selectedMemoryId}:${memoryId}`;
  link.renderOrder = 9;
  link.userData = {
    memoryId,
    score: strength,
  };
  return link;
}

function disposeGroupContents(group) {
  if (!group) return;

  group.traverse((object) => {
    if (object === group) return;
    object.geometry?.dispose();
    if (Array.isArray(object.material)) {
      object.material.forEach((material) => {
        material.map?.dispose();
        material.dispose();
      });
    } else {
      object.material?.map?.dispose();
      object.material?.dispose();
    }
  });
}

function createActivationConnections(memoryId, state) {
  if (anatomicalBrainRenderer && !regionScenePositions.size) return;

  const start = new THREE.Vector3(...state.core.position);
  state.activations.forEach((activation) => {
    const anchor = REGION_ANCHORS[activation.region];
    if (!anchor) return;
    const anatomicalPositions = regionScenePositions.get(activation.region);

    const targets =
      activation.region === "hippocampus" && anchor.hemispherePositions
        ? Object.entries(anchor.hemispherePositions).map(
            ([hemisphere, position]) => ({
              hemisphere,
              position: anatomicalPositions?.[hemisphere] || position,
              weight:
                activation.hemispheres?.[hemisphere] ?? activation.weight / 2,
            }),
          )
        : [{
            hemisphere: null,
            position: anatomicalPositions?.center || anchor.position,
            weight: activation.weight,
          }];

    targets.forEach((target) => {
      // Eliminate paths that terminate in empty space: only draw a connection
      // when a real anatomical position resolved for this region/hemisphere.
      if (!target.position) return;
      createActivationConnection(memoryId, activation.region, start, {
        ...target,
        color: getRegionColor(activation.region),
      });
    });
  });
}

function createActivationConnection(
  memoryId,
  region,
  start,
  { color, hemisphere, position, weight },
) {
  const end = new THREE.Vector3(...position);
  const control = start
    .clone()
    .add(end)
    .multiplyScalar(0.5)
    .lerp(new THREE.Vector3(), 0.28);
  const curve = new THREE.QuadraticBezierCurve3(start, control, end);
  const radius = THREE.MathUtils.lerp(
    MIN_CONNECTION_RADIUS,
    MAX_CONNECTION_RADIUS,
    Math.sqrt(THREE.MathUtils.clamp(weight, 0, 1)),
  );
  const connection = new THREE.Group();
  const tubeMaterial = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  });
  const glowMaterial = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    side: THREE.BackSide,
  });
  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(curve, CONNECTION_SEGMENTS, radius, 6, false),
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
          depthTest: false,
          depthWrite: false,
        }),
      );
      particle.visible = false;
      particle.userData.phase = index / FLOW_PARTICLE_COUNT;
      connection.add(particle);
      return particle;
    },
  );

  connection.name =
    `memory-link:${memoryId}:${region}${hemisphere ? `:${hemisphere}` : ""}`;
  connection.renderOrder = 1;
  connection.userData = {
    memoryId,
    region,
    hemisphere,
    weight,
    curve,
    tubeMaterial,
    glowMaterial,
    flowParticles,
    flowSpeed: THREE.MathUtils.lerp(0.18, 0.42, weight),
  };
  connection.add(glow, tube);
  activationConnectionGroup.add(connection);
  memoryConnections.push(connection);
}

function animateActivationConnections(elapsed) {
  if (reduceMotion.matches) return;

  const activeMemoryId = getActiveMemoryId();
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

function getPreviewRelationship() {
  if (!entityLens?.graph || entityLens.previewRelationshipId == null) {
    return null;
  }
  return entityLens.graph.relationships.find(
    (relationship) =>
      String(relationship.id) ===
      String(entityLens.previewRelationshipId),
  );
}

function renderEntityLens3D() {
  if (!entityLensGroup) return;

  disposeGroupContents(entityLensGroup);
  entityLensGroup.clear();
  entityLensHitTargets = [];
  if (!entityLens?.graph) return;

  const visibleIds = new Set(
    getFilteredMemories().map((memory) => memory.id),
  );
  const { spokes } = buildEntitySpokes(entityLens.graph, visibleIds);
  const originSpoke =
    spokes.find(
      (spoke) => spoke.memoryId === entityLens.originMemoryId,
    ) || spokes[0];
  const originNode = originSpoke
    ? getMemoryCore(originSpoke.memoryId)
    : null;
  if (!originNode) return;

  const entity = entityLens.graph.entity;
  const color = ENTITY_KIND_COLORS[entity.kind] || DEFAULT_MEMORY_COLOR;
  const hubPosition = calculateEntityHubPosition(
    originNode.position.toArray(),
    entity.id,
  );
  const hub = createEntityNode(
    entity,
    hubPosition,
    ENTITY_HUB_RADIUS,
    false,
    entityLens.originMemoryId,
  );
  entityLensGroup.add(hub);

  spokes.forEach((spoke) => {
    const memoryNode = getMemoryCore(spoke.memoryId);
    if (!memoryNode) return;
    entityLensGroup.add(
      createEntitySpoke(
        new THREE.Vector3(...hubPosition),
        memoryNode.position,
        color,
      ),
    );
  });

  const relationship = getPreviewRelationship();
  const counterpart = relationship
    ? getRelationshipCounterpart(relationship, entity.id)
    : null;
  const direction = relationship
    ? getRelationshipDirection(relationship, entity.id)
    : null;
  if (counterpart && direction) {
    const previewPosition = calculateRelationshipPreviewPosition(
      hubPosition,
      counterpart.id,
      direction,
    );
    const preview = createEntityNode(
      counterpart,
      previewPosition,
      ENTITY_PREVIEW_RADIUS,
      true,
      relationship.memory_id,
    );
    const hubVector = new THREE.Vector3(...hubPosition);
    const previewVector = new THREE.Vector3(...previewPosition);
    const start = direction === "outgoing" ? hubVector : previewVector;
    const end = direction === "outgoing" ? previewVector : hubVector;
    entityLensGroup.add(
      createRelationshipArrow(
        start,
        end,
        ENTITY_KIND_COLORS[counterpart.kind] || color,
      ),
      preview,
    );
  }

  if (!entityLens.hasFocused) {
    hub.updateWorldMatrix(true, false);
    focusCameraOnPoint(hub.getWorldPosition(new THREE.Vector3()));
    entityLens.hasFocused = true;
  }
}

function createEntityNode(
  entity,
  position,
  radius,
  isCounterpart,
  originMemoryId,
) {
  const color = ENTITY_KIND_COLORS[entity.kind] || DEFAULT_MEMORY_COLOR;
  const node = new THREE.Mesh(
    new THREE.OctahedronGeometry(radius, 0),
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: isCounterpart ? 0.8 : 1.05,
      roughness: 0.18,
      transparent: true,
      opacity: 0.98,
      depthWrite: false,
    }),
  );
  const shell = new THREE.Mesh(
    new THREE.OctahedronGeometry(radius * 1.34, 0),
    new THREE.MeshBasicMaterial({
      color,
      wireframe: true,
      transparent: true,
      opacity: isCounterpart ? 0.36 : 0.52,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );

  node.name = isCounterpart
    ? `entity-preview:${entity.id}`
    : `entity-hub:${entity.id}`;
  node.position.set(...position);
  node.renderOrder = 8;
  node.userData = {
    entity,
    entityId: entity.id,
    isEntityLensNode: true,
    isCounterpart,
    originMemoryId,
  };
  node.add(shell, createEntityLabelSprite(entity, color));
  entityLensHitTargets.push(node);
  return node;
}

function createEntityLabelSprite(entity, color) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 96;
  const context = canvas.getContext("2d");
  context.font = "500 28px DM Mono, monospace";
  context.textAlign = "center";
  context.fillStyle = "rgba(9, 14, 15, 0.82)";
  context.fillRect(0, 14, canvas.width, 64);
  context.strokeStyle = color;
  context.strokeRect(1, 15, canvas.width - 2, 62);
  context.fillStyle = color;
  context.fillText(
    `${entity.canonical_name} / ${entity.kind}`.toUpperCase(),
    canvas.width / 2,
    55,
  );

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(canvas),
      transparent: true,
      depthTest: false,
      depthWrite: false,
    }),
  );
  sprite.position.set(0, 0.34, 0);
  sprite.scale.set(1.8, 0.34, 1);
  sprite.renderOrder = 9;
  return sprite;
}

function createEntitySpoke(start, end, color) {
  const midpoint = start.clone().add(end).multiplyScalar(0.5);
  if (midpoint.lengthSq()) midpoint.add(midpoint.clone().normalize().multiplyScalar(0.2));
  const curve = new THREE.QuadraticBezierCurve3(
    start.clone(),
    midpoint,
    end.clone(),
  );
  const group = new THREE.Group();
  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 28, 0.012, 6, false),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.58,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  const glow = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 28, 0.027, 6, false),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.12,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide,
    }),
  );
  group.add(glow, tube);
  return group;
}

function createRelationshipArrow(start, end, color) {
  const direction = end.clone().sub(start);
  const length = direction.length();
  const arrow = new THREE.ArrowHelper(
    direction.normalize(),
    start,
    length,
    color,
    Math.min(0.18, length * 0.28),
    0.1,
  );
  arrow.line.material.transparent = true;
  arrow.line.material.opacity = 0.88;
  arrow.line.material.depthWrite = false;
  arrow.cone.material.transparent = true;
  arrow.cone.material.opacity = 0.95;
  arrow.cone.material.depthWrite = false;
  arrow.renderOrder = 8;
  return arrow;
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
  const activeMemoryId = getActiveMemoryId();
  const linkedIds = new Set(
    entityLens?.graph?.memories.map((memory) => memory.id) || [],
  );
  const evidenceMemoryId = getPreviewRelationship()?.memory_id || null;

  memoryNodes.forEach((node) => {
    const selected = node.userData.memoryId === selectedMemoryId;
    const hovered = node.userData.memoryId === hoveredMemoryId;
    const active = hovered || selected;

    if (entityLens) {
      const linked = linkedIds.has(node.userData.memoryId);
      const evidence = node.userData.memoryId === evidenceMemoryId;
      node.material.emissiveIntensity = evidence
        ? 1.25
        : hovered
          ? 1
          : linked
            ? 0.68
            : 0.08;
      node.material.opacity = evidence
        ? 1
        : linked
          ? evidenceMemoryId
            ? 0.42
            : 0.92
          : 0.1;
      node.userData.selectionScale = evidence
        ? 1.35
        : hovered
          ? 1.25
          : selected
            ? 1.14
            : 1;
    } else {
      if (hovered) {
        node.material.emissiveIntensity = 1;
        node.material.opacity = 1;
        node.userData.selectionScale = 1.28;
      } else if (selected) {
        node.material.emissiveIntensity = 0.9;
        node.material.opacity = 1;
        node.userData.selectionScale = 1.2;
      } else if (activeMemoryId != null) {
        // A memory is active but this isn't it: keep it subdued.
        node.material.emissiveIntensity = 0.2;
        node.material.opacity = 0.38;
        node.userData.selectionScale = 1;
      } else {
        // The anatomical shell is opaque, so idle memories need enough
        // emissive contrast to remain legible through its overlay pass.
        node.material.emissiveIntensity = 0.52;
        node.material.opacity = 0.82;
        node.userData.selectionScale = 1;
      }
    }
    node.scale.setScalar(node.userData.selectionScale);
  });
  updateActivationConnections();
}

function animateMemoryNodes(elapsed) {
  memoryNodes.forEach((node) => {
    const selectionScale = node.userData.selectionScale || 1;
    const workingPulse =
      node.userData.dominantType === "working"
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

function focusAnatomicalRegion(region) {
  if (!regionScenePositions.size || !region || !brainCamera || !brainControls || !anatomicalBrainRenderer) return;
  const focus = anatomicalBrainRenderer.focusRegion(region, {
    camera: brainCamera,
    padding: 2.2,
  });
  if (!focus) return;

  const viewDirection = brainCamera.position.clone().sub(brainControls.target);
  if (!viewDirection.lengthSq()) viewDirection.set(0, 0, 1);
  viewDirection.setLength(DEEP_BRAIN_REGIONS.has(region) ? 6.4 : 7);
  const cameraPosition = focus.target.clone().add(viewDirection);

  brainControls.autoRotate = false;
  if (reduceMotion.matches) {
    brainCamera.position.copy(cameraPosition);
    brainControls.target.copy(focus.target);
    cameraFocus = null;
    return;
  }

  cameraFocus = {
    startedAt: performance.now(),
    fromPosition: brainCamera.position.clone(),
    toPosition: cameraPosition,
    fromTarget: brainControls.target.clone(),
    toTarget: focus.target,
  };
}

function focusCameraOnPoint(target) {
  if (!brainCamera || !brainControls) return;

  const offset = brainCamera.position.clone().sub(brainControls.target);
  const distance = THREE.MathUtils.clamp(offset.length(), 4.5, 7);

  if (!offset.lengthSq()) offset.set(0, 0, 1);
  offset.setLength(distance);
  if (reduceMotion.matches) {
    brainCamera.position.copy(target).add(offset);
    brainControls.target.copy(target);
    brainControls.autoRotate = false;
    cameraFocus = null;
    return;
  }
  cameraFocus = {
    startedAt: performance.now(),
    fromPosition: brainCamera.position.clone(),
    toPosition: target.clone().add(offset),
    fromTarget: brainControls.target.clone(),
    toTarget: target,
  };
  brainControls.autoRotate = false;
}

function getMemoryCore(memoryId) {
  return memoryNodes.find(
    (candidate) => candidate.userData.memoryId === memoryId,
  );
}

function setHoveredMemory(memoryId, event) {
  const hoverChanged = hoveredMemoryId !== memoryId;
  if (hoverChanged) {
    hoveredMemoryId = memoryId;
    hoveredRegion = null;
    updateMemoryNodeSelection();
    updateRegionMarkers();
    updateActivationConnections();
    updateRegionLabels();
    updateRegionInspectorSelection();
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
    [
      "Activation",
      `1 memory \u00b7 ${regions.length} active ${
        regions.length === 1 ? "region" : "regions"
      }`,
    ],
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
  if (USE_LEGACY_BRAIN) {
    renderLegacyBrain({
      canvas: brainCanvas,
      stage: brainStage,
      getMemories: getFilteredMemories,
      getActiveMemoryId,
      getFocusedRegion,
      setHoveredMemory,
      setHoveredRegion,
      selectMemory,
      selectRegion,
      clearSelection,
      focusEntity,
      reduceMotion,
      onReady: ({ camera, controls }) => {
        brainCamera = camera;
        brainControls = controls;
      },
    });
    return;
  }

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0a0d12, 0.02);
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
  renderer.toneMappingExposure = 1;
  camera.position.set(0, 0, 7);
  brainCamera = camera;
  scene.add(brain);
  scene.add(new THREE.HemisphereLight(0xcdd6e2, 0x0d1117, 0.6));

  const controls = new OrbitControls(camera, brainCanvas);
  brainControls = controls;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 5;
  controls.maxDistance = 12;
  controls.autoRotate = !reduceMotion.matches;
  controls.autoRotateSpeed = 0.5;
  controls.addEventListener("start", () => {
    cameraFocus = null;
    controls.autoRotate = false;
  });

  brainCanvas.addEventListener(
    "wheel",
    (event) => event.preventDefault(),
    { passive: false },
  );

  brainCanvas.addEventListener("mouseenter", () => {
    controls.autoRotate = false;
  });
  brainCanvas.addEventListener("mouseleave", () => {
    setHoveredMemory(null);
    setHoveredRegion(null);
    controls.autoRotate =
      !reduceMotion.matches && selectedMemoryId == null && entityLens == null;
  });
  brainCanvas.addEventListener("pointercancel", () => {
    setHoveredMemory(null);
    setHoveredRegion(null);
  });

  brainCanvas.addEventListener("pointermove", (event) => {
    const bounds = brainCanvas.getBoundingClientRect();
    pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const [entityHit] = raycaster.intersectObjects(
      entityLensHitTargets,
      false,
    );
    if (entityHit) {
      setHoveredMemory(null);
      setHoveredRegion(null);
      brainCanvas.style.cursor = entityHit.object.userData.isCounterpart
        ? "pointer"
        : "default";
      return;
    }

    const [memoryHit] = raycaster.intersectObjects(memoryNodes, false);
    if (memoryHit) {
      setHoveredRegion(null);
      setHoveredMemory(memoryHit.object.userData.memoryId, event);
      return;
    }

    const activeMarkerTargets = selectedMemoryId
      ? anatomicalBrainRenderer?.getRegionHitTargets() || []
      : [];
    const [regionHit] = raycaster.intersectObjects(activeMarkerTargets, false);
    if (regionHit) {
      setHoveredMemory(null);
      setHoveredRegion(regionHit.object.userData.anatomicalRegion);
      brainCanvas.style.cursor = "pointer";
      return;
    }

    setHoveredMemory(null);
    setHoveredRegion(null);
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
    const [entityHit] = raycaster.intersectObjects(
      entityLensHitTargets,
      false,
    );
    if (entityHit) {
      const { entity, isCounterpart, originMemoryId } =
        entityHit.object.userData;
      if (isCounterpart) {
        focusEntity(entity.id, originMemoryId, { entity });
      }
      return;
    }

    const [memoryHit] = raycaster.intersectObjects(memoryNodes, false);
    if (memoryHit) {
      selectMemory(memoryHit.object.userData.memoryId, {
        focusCamera: false,
      });
      return;
    }

    const activeMarkerTargets = selectedMemoryId
      ? anatomicalBrainRenderer?.getRegionHitTargets() || []
      : [];
    const [regionHit] = raycaster.intersectObjects(activeMarkerTargets, false);
    if (regionHit) selectRegion(regionHit.object.userData.anatomicalRegion);
    else clearSelection();
  });

  const keyLight = new THREE.DirectionalLight(0xf2ece0, 1.6);
  keyLight.position.set(-3, 4, 5);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0x9fb0c6, 0.45);
  fillLight.position.set(3, -1, 2);
  scene.add(fillLight);

  const rimLight = new THREE.DirectionalLight(0xcdd6e2, 0.35);
  rimLight.position.set(0, 2, -6);
  scene.add(rimLight);

  const modelStatus = document.createElement("p");
  modelStatus.className = "brain-model-status";
  modelStatus.textContent = "Loading anatomical brain model…";
  modelStatus.setAttribute("role", "status");
  brainStage.append(modelStatus);

  const brainContent = new THREE.Group();
  brainContent.name = "brain-content";
  brainContent.rotation.set(-0.08, -0.45, -0.08);
  memoryNodeGroup = new THREE.Group();
  memoryNodeGroup.name = "memory-nodes";
  memoryNodeGroup.renderOrder = 10;
  activationConnectionGroup = new THREE.Group();
  activationConnectionGroup.name = "activation-connections";
  activationConnectionGroup.renderOrder = 8;
  relatedMemoryLinkGroup = new THREE.Group();
  relatedMemoryLinkGroup.name = "related-memory-links";
  relatedMemoryLinkGroup.renderOrder = 9;
  entityLensGroup = new THREE.Group();
  entityLensGroup.name = "entity-lens";
  entityLensGroup.renderOrder = 11;
  const regionAnchorGroup = createRegionAnchorGroup();
  brainContent.add(
    regionAnchorGroup,
    activationConnectionGroup,
    relatedMemoryLinkGroup,
    entityLensGroup,
    memoryNodeGroup,
  );
  brain.add(brainContent);

  anatomicalBrainRenderer = createAnatomicalBrainRenderer({
    url: BRAIN_ATLAS_URL,
    parent: brainContent,
    camera,
    onLoading: () => {
      brainStage.dataset.modelState = "loading";
    },
    onLoad: ({ object, center, size, missingRegions }) => {
      if (missingRegions.length) {
        throw new Error(`Anatomical model is missing: ${missingRegions.join(", ")}`);
      }
      const scale = 4.0 / Math.max(size.x, size.y, size.z);
      const localCenter = brainContent.worldToLocal(center.clone());
      object.scale.setScalar(scale);
      object.position.copy(localCenter).multiplyScalar(-scale);
      object.updateMatrixWorld(true);

      regionScenePositions = new Map();
      for (const region of Object.keys(REGION_ANCHORS)) {
        const centerWorld = anatomicalBrainRenderer.getRegionCenter(region);
        if (!centerWorld) continue;
        const centerLocal = brainContent.worldToLocal(centerWorld.clone());
        const radiusWorld = anatomicalBrainRenderer.getRegionRadius(region);
        // Scale the measured radius into the same scene-local space the memory
        // nodes live in (the model object is uniformly scaled by `scale`).
        const radiusLocal = radiusWorld ? radiusWorld * scale : null;
        regionScenePositions.set(region, {
          center: centerLocal.toArray(),
          ...(radiusLocal ? { radius: radiusLocal } : {}),
        });
        const leftWorld = anatomicalBrainRenderer.getRegionCenter(region, "left");
        const rightWorld = anatomicalBrainRenderer.getRegionCenter(region, "right");
        if (leftWorld) {
          regionScenePositions.get(region).left = brainContent
            .worldToLocal(leftWorld.clone()).toArray();
        }
        if (rightWorld) {
          regionScenePositions.get(region).right = brainContent
            .worldToLocal(rightWorld.clone()).toArray();
        }
      }

      // Measured positions are now authoritative. Re-anchor markers before any
      // labels or activation paths can project from them.
      regionMarkerPositionsDirty = true;
      syncRegionMarkerPositions();

      modelStatus.hidden = true;
      brainStage.dataset.modelState = "ready";
      // Re-run placement with the measured centers/radii so nodes, connections,
      // labels, and markers all sit on the real anatomy. render() performs the
      // full guarded rebuild (memoryNodeState + nodes + markers + connections +
      // labels) and will early-return if called again before this point.
      render();
    },
    onError: (error) => {
      console.error("Failed to load anatomical brain model:", error);
      brainStage.dataset.modelState = "error";
      modelStatus.textContent = "Anatomical brain model unavailable. Region details remain accessible below.";
      modelStatus.setAttribute("role", "alert");
    },
  });
  anatomicalBrainRenderer.ready.catch(() => {});

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
    if (!reduceMotion.matches) {
      const elapsed = performance.now() * 0.001;
      animateMemoryNodes(elapsed);
      animateActivationConnections(elapsed);
    }
    updateRegionLabelPositions(camera);
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  new ResizeObserver(resize).observe(brainStage);
  resize();
  animate();
}

renderBrainModel();
loadMemories();
