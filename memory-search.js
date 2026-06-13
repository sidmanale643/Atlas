function normalizeSearchValue(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

function getEntitySearchValues(entity) {
  return [
    entity?.canonical_name,
    entity?.canonicalName,
    entity?.mention,
  ];
}

export function matchesMemorySearch(memory, query) {
  const terms = normalizeSearchValue(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;

  const extractionEntities = memory.extraction?.entities || [];
  const searchableText = normalizeSearchValue(
    [
      memory.text,
      memory.summary,
      ...(memory.entities || []).flatMap(getEntitySearchValues),
      ...extractionEntities.flatMap(getEntitySearchValues),
    ].join(" "),
  );

  return terms.every((term) => searchableText.includes(term));
}

export function filterMemoriesForSearch(
  memories,
  { query = "", source = "all", semanticIds = null } = {},
) {
  const sourceMatches = (memory) =>
    source === "all" || memory.source === source;
  const normalizedQuery = normalizeSearchValue(query);

  if (!normalizedQuery) return memories.filter(sourceMatches);

  if (Array.isArray(semanticIds)) {
    const memoriesById = new Map(
      memories.map((memory) => [String(memory.id), memory]),
    );
    return semanticIds.flatMap((id) => {
      const memory = memoriesById.get(String(id));
      return memory && sourceMatches(memory) ? [memory] : [];
    });
  }

  return memories.filter(
    (memory) =>
      sourceMatches(memory) && matchesMemorySearch(memory, normalizedQuery),
  );
}
