import { searchMemoriesFts } from "./db.js";
import { memoryEmbeddingText } from "./vector-store.js";

const ENTITY_SIGNAL_WEIGHTS = Object.freeze({
  person: 0.55,
  organization: 0.45,
  place: 0.4,
  concept: 0.3,
  object: 0.25,
});

const RELATIONSHIP_SIGNAL_WEIGHT = 0.55;
const BM25_SIGNAL_WEIGHT = 0.3;

export async function getRelatedMemories(
  memoryId,
  {
    getMemory,
    getStructuralMemoryLinks,
    searchMemoryVectors,
    searchMemoriesFts: searchFts,
    serializeMemory,
  },
  { limit = 5, scoreThreshold = 0.65 } = {},
) {
  const origin = getMemory(memoryId);
  if (!origin) return null;

  const structuralLinks = getStructuralMemoryLinks(memoryId) || [];
  let semanticAvailable = true;
  let semanticHits = [];

  try {
    semanticHits = await searchMemoryVectors(memoryEmbeddingText(origin), {
      limit: Math.max(limit * 4, 20),
      scoreThreshold,
    });
  } catch {
    semanticAvailable = false;
  }

  let bm25Available = true;
  let bm25Hits = [];
  try {
    const textForBm25 = [origin.title, origin.summary, origin.raw_text]
      .filter(Boolean)
      .join(" ");
    bm25Hits = searchFts
      ? searchFts(textForBm25, { limit: Math.max(limit * 4, 20) })
      : searchMemoriesFts(textForBm25, { limit: Math.max(limit * 4, 20) });
  } catch {
    bm25Available = false;
  }

  const candidates = new Map();
  for (const link of structuralLinks) {
    const candidateId = String(link.memory_id || link.memoryId || "");
    if (!candidateId || candidateId === String(memoryId)) continue;
    const candidate = ensureCandidate(candidates, candidateId);
    candidate.sharedEntities = uniqueEntities(
      link.shared_entities || link.sharedEntities || [],
    );
    candidate.sharedRelationships = uniqueRelationships(
      link.shared_relationships || link.sharedRelationships || [],
    );
  }

  for (const hit of semanticHits) {
    const candidateId = String(hit.id || "");
    const similarity = Number(hit.score);
    if (
      !candidateId ||
      candidateId === String(memoryId) ||
      !Number.isFinite(similarity) ||
      similarity < scoreThreshold
    ) {
      continue;
    }
    ensureCandidate(candidates, candidateId).semanticSimilarity = similarity;
  }

  const maxBm25Score = Math.max(...bm25Hits.map((h) => h.score), 0);
  for (const hit of bm25Hits) {
    const candidateId = String(hit.id || "");
    if (!candidateId || candidateId === String(memoryId)) continue;
    const normalizedScore = maxBm25Score === 0
      ? 0
      : Math.abs(hit.score) / Math.abs(maxBm25Score);
    ensureCandidate(candidates, candidateId).bm25Score = normalizedScore;
  }

  const links = [...candidates.values()]
    .flatMap((candidate) => {
      const memory = getMemory(candidate.memoryId);
      if (!memory) return [];
      const signals = [
        ...candidate.sharedEntities.map(
          (entity) => ENTITY_SIGNAL_WEIGHTS[entity.kind] || 0.2,
        ),
        ...candidate.sharedRelationships.map(
          () => RELATIONSHIP_SIGNAL_WEIGHT,
        ),
      ];
      if (candidate.semanticSimilarity != null) {
        signals.push(clamp(candidate.semanticSimilarity, 0, 1));
      }
      if (candidate.bm25Score != null) {
        signals.push(clamp(candidate.bm25Score, 0, 1) * BM25_SIGNAL_WEIGHT);
      }
      const score = combineSignals(signals);
      if (score <= 0) return [];

      return [{
        memory: serializeMemory(memory),
        score,
        reasons: buildReasons(candidate),
        sharedEntities: candidate.sharedEntities,
        sharedRelationships: candidate.sharedRelationships,
        semanticSimilarity: candidate.semanticSimilarity,
        bm25Score: candidate.bm25Score,
      }];
    })
    .sort(compareLinks)
    .slice(0, limit);

  return {
    memoryId: String(memoryId),
    links,
    semanticAvailable,
    bm25Available,
  };
}

export function combineSignals(signals) {
  return 1 - signals.reduce(
    (remaining, signal) => remaining * (1 - clamp(signal, 0, 1)),
    1,
  );
}

function ensureCandidate(candidates, memoryId) {
  if (!candidates.has(memoryId)) {
    candidates.set(memoryId, {
      memoryId,
      sharedEntities: [],
      sharedRelationships: [],
      semanticSimilarity: null,
      bm25Score: null,
    });
  }
  return candidates.get(memoryId);
}

function buildReasons(candidate) {
  const reasons = candidate.sharedEntities.map(
    (entity) => `Shared ${entity.kind}: ${entity.canonical_name}`,
  );
  reasons.push(
    ...candidate.sharedRelationships.map(
      (relationship) =>
        `Shared relationship: ${relationship.subject} `
        + `${relationship.predicate} ${relationship.object}`,
    ),
  );
  if (candidate.semanticSimilarity != null) {
    reasons.push(
      `Semantic similarity ${Math.round(candidate.semanticSimilarity * 100)}%`,
    );
  }
  if (candidate.bm25Score != null) {
    reasons.push(
      `Keyword relevance ${Math.round(candidate.bm25Score * 100)}%`,
    );
  }
  return reasons;
}

function uniqueEntities(entities) {
  const unique = new Map();
  for (const entity of entities) {
    const id = entity?.id ?? "";
    const name = String(
      entity?.canonical_name || entity?.canonicalName || entity?.name || "",
    ).trim();
    const kind = String(entity?.kind || "concept").trim();
    if (!name) continue;
    const key = id ? `id:${id}` : `${kind}:${name.toLocaleLowerCase()}`;
    if (!unique.has(key)) {
      unique.set(key, {
        ...(id !== "" ? { id } : {}),
        canonical_name: name,
        kind,
      });
    }
  }
  return [...unique.values()];
}

function uniqueRelationships(relationships) {
  const unique = new Map();
  for (const relationship of relationships) {
    const subject = String(
      relationship?.subject
      || relationship?.source_name
      || relationship?.source?.canonical_name
      || "",
    ).trim();
    const predicate = String(relationship?.predicate || "").trim();
    const object = String(
      relationship?.object
      || relationship?.target_name
      || relationship?.target?.canonical_name
      || "",
    ).trim();
    if (!subject || !predicate || !object) continue;
    const key = `${subject}\u0000${predicate}\u0000${object}`.toLocaleLowerCase();
    if (!unique.has(key)) unique.set(key, { subject, predicate, object });
  }
  return [...unique.values()];
}

function compareLinks(left, right) {
  if (right.score !== left.score) return right.score - left.score;
  const rightCreated = Date.parse(right.memory.created_at || "") || 0;
  const leftCreated = Date.parse(left.memory.created_at || "") || 0;
  if (rightCreated !== leftCreated) return rightCreated - leftCreated;
  return String(left.memory.id).localeCompare(String(right.memory.id));
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(Number(value) || 0, minimum), maximum);
}
