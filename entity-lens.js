export const ENTITY_KIND_COLORS = Object.freeze({
  person: "#9bbcff",
  place: "#7ee8d3",
  object: "#ffd38a",
  concept: "#e99fd1",
  organization: "#ffad8a",
});

const HUB_OUTWARD_OFFSET = 0.62;
const HUB_TANGENT_OFFSET = 0.12;
const PREVIEW_OUTWARD_OFFSET = 0.36;
const PREVIEW_TANGENT_OFFSET = 0.58;

export function calculateEntityHubPosition(originPosition, entityId) {
  const origin = toVector(originPosition);
  const outward = normalize(origin, [0, 0, 1]);
  const [tangentA, tangentB] = getTangents(outward);
  const angle = hashUnit(`entity:${entityId}:hub`) * Math.PI * 2;

  return addVectors(
    origin,
    scaleVector(outward, HUB_OUTWARD_OFFSET),
    scaleVector(tangentA, Math.cos(angle) * HUB_TANGENT_OFFSET),
    scaleVector(tangentB, Math.sin(angle) * HUB_TANGENT_OFFSET),
  );
}

export function calculateRelationshipPreviewPosition(
  hubPosition,
  counterpartEntityId,
  direction,
) {
  const hub = toVector(hubPosition);
  const outward = normalize(hub, [0, 0, 1]);
  const [tangentA, tangentB] = getTangents(outward);
  const directionOffset = direction === "incoming" ? Math.PI : 0;
  const angle =
    hashUnit(`entity:${counterpartEntityId}:preview`) * Math.PI * 2 +
    directionOffset;

  return addVectors(
    hub,
    scaleVector(outward, PREVIEW_OUTWARD_OFFSET),
    scaleVector(tangentA, Math.cos(angle) * PREVIEW_TANGENT_OFFSET),
    scaleVector(tangentB, Math.sin(angle) * PREVIEW_TANGENT_OFFSET),
  );
}

export function getRelationshipDirection(relationship, entityId) {
  const activeId = Number(entityId);
  if (Number(relationship?.source?.id) === activeId) return "outgoing";
  if (Number(relationship?.target?.id) === activeId) return "incoming";
  return null;
}

export function getRelationshipCounterpart(relationship, entityId) {
  const direction = getRelationshipDirection(relationship, entityId);
  if (direction === "outgoing") return relationship.target;
  if (direction === "incoming") return relationship.source;
  return null;
}

export function filterEntityGraphMemories(graph, visibleMemoryIds) {
  const visibleIds =
    visibleMemoryIds instanceof Set
      ? visibleMemoryIds
      : new Set(visibleMemoryIds || []);
  const unique = new Map();

  for (const memory of graph?.memories || []) {
    if (memory?.id && !unique.has(memory.id)) unique.set(memory.id, memory);
  }

  const memories = [...unique.values()];
  const visible = memories.filter((memory) => visibleIds.has(memory.id));
  return {
    visible,
    hidden: memories.length - visible.length,
    total: memories.length,
  };
}

export function buildEntitySpokes(graph, visibleMemoryIds) {
  const { visible, hidden, total } = filterEntityGraphMemories(
    graph,
    visibleMemoryIds,
  );
  return {
    spokes: visible.map((memory) => ({
      id: `${graph.entity.id}:${memory.id}`,
      entityId: graph.entity.id,
      memoryId: memory.id,
    })),
    hidden,
    total,
  };
}

export function pushNavigation(history, entry) {
  const current = history.at(-1);
  if (
    current?.type === entry?.type &&
    String(current?.id) === String(entry?.id)
  ) {
    return [...history];
  }
  return [...history, { ...entry }];
}

export function restoreNavigation(history, index) {
  if (!Number.isInteger(index) || index < 0 || index >= history.length) {
    return { history: [...history], current: null };
  }
  const restored = history.slice(0, index + 1).map((entry) => ({ ...entry }));
  return { history: restored, current: restored.at(-1) };
}

function toVector(value) {
  if (!Array.isArray(value) || value.length !== 3) return [0, 0, 0];
  return value.map((coordinate) =>
    Number.isFinite(Number(coordinate)) ? Number(coordinate) : 0,
  );
}

function normalize(vector, fallback) {
  const length = Math.hypot(...vector);
  return length > 1e-9
    ? vector.map((coordinate) => coordinate / length)
    : [...fallback];
}

function getTangents(outward) {
  const reference = Math.abs(outward[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const tangentA = normalize(cross(outward, reference), [1, 0, 0]);
  return [tangentA, normalize(cross(outward, tangentA), [0, 1, 0])];
}

function addVectors(...vectors) {
  return [0, 1, 2].map((index) =>
    vectors.reduce((sum, vector) => sum + vector[index], 0),
  );
}

function scaleVector(vector, scale) {
  return vector.map((coordinate) => coordinate * scale);
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function hashUnit(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}
