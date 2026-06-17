import { randomUUID } from "node:crypto";
import { retrieveExtractionContext } from "./extraction-context.js";

// Shared helpers used by both the MCP server (src/mcp-server.js) and the CLI
// (src/cli/) to execute the LLM extraction + dedupe + persist pipeline. Kept
// dependency-injected so tests can supply mocks for the LLM and vector store.

export function createMemoryDetails(dependencies) {
  return function getMemoryDetails(id) {
    const memory = dependencies.getMemory(id);
    if (!memory) return null;
    return {
      ...memory,
      extraction: dependencies.getLatestExtraction(id),
      entities: dependencies.getEntitiesForMemory(id),
      relationships: dependencies.getRelationshipsForMemory(id),
      regions: dependencies.getRegionActivations(id),
    };
  };
}

export function dominantType(types = []) {
  return [...types].sort(
    (left, right) =>
      right.weight - left.weight || left.type.localeCompare(right.type),
  )[0]?.type || "semantic";
}

function createDecision(reason, confidence = 0) {
  return {
    action: "create",
    matchedMemoryId: null,
    confidence,
    reason,
    replacementText: "",
  };
}

export async function decideSmartMemoryWrite({
  dependencies,
  getMemoryDetails,
  text,
  extraction,
  metadata,
}) {
  let candidates;
  try {
    const hits = await dependencies.searchMemoryVectors(text, { limit: 5 });
    candidates = hits
      .map(({ id }) => getMemoryDetails(id))
      .filter(Boolean);
  } catch (error) {
    console.error(`Could not find memory candidates: ${error.message}`);
    return createDecision("Memory candidate search was unavailable.");
  }

  if (candidates.length === 0) {
    return createDecision("No similar stored memory was found.", 1);
  }

  try {
    const decision = await dependencies.decideMemoryWrite(
      { text, summary: extraction.summary, ...metadata },
      candidates,
    );
    if (decision.action === "create") return decision;
    const validMatch = candidates.some(
      ({ id }) => id === decision.matchedMemoryId,
    );
    if (!validMatch || decision.confidence < 0.85) {
      return createDecision("The possible memory match was uncertain.");
    }
    return decision;
  } catch (error) {
    console.error(`Could not decide memory write action: ${error.message}`);
    return createDecision("Memory matching was inconclusive.");
  }
}

// Run the full add-memory pipeline: extract -> decide -> persist -> index.
// Returns an object in the same shape the MCP tool returns:
//   { memories: [{ action, memory, matchedMemoryId, confidence, reason }] }
export async function ingestMemory({
  dependencies,
  text,
  source = "cli",
  metadata = {},
  date = new Date().toISOString(),
}) {
  const getMemoryDetails = createMemoryDetails(dependencies);

  let similarMemories = [];
  try {
    similarMemories = await retrieveExtractionContext(text, dependencies);
  } catch {
    // Context retrieval is optional enrichment
  }

  const semanticExtraction = await dependencies.extractAtomicMemories(
    text,
    date,
    similarMemories,
  );

  const results = [];
  for (const atom of semanticExtraction.memories) {
    const id = `mem_${randomUUID().slice(0, 8)}`;
    const atomMetadata = {
      ...metadata,
      type: metadata.type || dominantType(atom.types),
      title: metadata.title || atom.summary || atom.text.slice(0, 50),
    };

    const decision = await decideSmartMemoryWrite({
      dependencies,
      getMemoryDetails,
      text: atom.text,
      extraction: atom,
      metadata: atomMetadata,
    });

    let memory;
    if (decision.action === "unchanged") {
      memory = getMemoryDetails(decision.matchedMemoryId);
    } else if (decision.action === "update") {
      const replacementText = decision.replacementText?.trim() || atom.text;
      let replacementExtraction;
      if (replacementText === atom.text) {
        replacementExtraction = atom;
      } else {
        let replacementContext = [];
        try {
          replacementContext = await retrieveExtractionContext(
            replacementText,
            dependencies,
          );
        } catch {
          // Context retrieval is optional
        }
        const replacementResult = await dependencies.extractAtomicMemories(
          replacementText,
          date,
          replacementContext,
        );
        if (!replacementResult.memories.length) {
          throw new Error("Replacement text did not produce a valid memory extraction");
        }
        replacementExtraction = replacementResult.memories[0];
      }
      dependencies.updateMemoryGraph({
        memoryId: decision.matchedMemoryId,
        rawText: replacementText,
        ingestionDate: date,
        extraction: replacementExtraction,
        model: await dependencies.getModel(),
        metadata: atomMetadata,
      });
      memory = getMemoryDetails(decision.matchedMemoryId);
      try {
        await dependencies.indexMemoryVector(memory);
      } catch (error) {
        console.error(
          `Could not reindex memory ${decision.matchedMemoryId}: ${error.message}`,
        );
      }
    } else {
      memory = dependencies.storeMemory(
        id,
        atom.text,
        date,
        atom,
        await dependencies.getModel(),
        source,
        atomMetadata,
      );
      try {
        await dependencies.indexMemoryVector(memory);
      } catch (error) {
        console.error(`Could not index memory ${id}: ${error.message}`);
      }
    }

    results.push({
      action: decision.action === "create" ? "created" : decision.action,
      memory: getMemoryDetails(memory.id),
      matchedMemoryId:
        decision.action === "create" ? null : decision.matchedMemoryId,
      confidence: decision.confidence,
      reason: decision.reason,
    });
  }

  return { memories: results };
}
