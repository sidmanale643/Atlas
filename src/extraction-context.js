export const EXTRACTION_CONTEXT_LIMIT = 10;

export async function retrieveExtractionContext(
  text,
  { searchMemoryVectors, getMemory },
) {
  const hits = await searchMemoryVectors(text, {
    limit: EXTRACTION_CONTEXT_LIMIT,
  });

  return hits
    .slice(0, EXTRACTION_CONTEXT_LIMIT)
    .map(({ id, score }) => {
      const memory = getMemory(id);
      return memory ? { ...memory, similarity: score } : null;
    })
    .filter(Boolean);
}
