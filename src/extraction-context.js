export const EXTRACTION_CONTEXT_LIMIT = 5;
export const EXTRACTION_CONTEXT_THRESHOLD = 0.7;

export async function retrieveExtractionContext(
  text,
  { searchMemoryVectors, getEntitiesForMemory, getMemory, ownerHash },
) {
  const hits = await searchMemoryVectors(text, {
    limit: EXTRACTION_CONTEXT_LIMIT,
  });

  const entities = hits
    .filter(({ id }) => !ownerHash || getMemory?.(id)?.owner_hash === ownerHash)
    .filter(({ score }) => Number(score) >= EXTRACTION_CONTEXT_THRESHOLD)
    .slice(0, EXTRACTION_CONTEXT_LIMIT)
    .flatMap(({ id }) => getEntitiesForMemory?.(id) || [])
    .map((entity) => ({
      canonicalName: entity.canonical_name || entity.canonicalName,
      aliases: [entity.mention].filter(Boolean),
      kind: entity.kind,
    }));
  const unique = new Map();
  for (const entity of entities) {
    if (!entity.canonicalName || !entity.kind) continue;
    const key = `${entity.kind}:${entity.canonicalName.toLocaleLowerCase()}`;
    const current = unique.get(key);
    unique.set(key, current
      ? { ...current, aliases: [...new Set([...current.aliases, ...entity.aliases])] }
      : entity);
  }
  return { entities: [...unique.values()] };
}
