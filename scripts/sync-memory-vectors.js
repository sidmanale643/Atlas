#!/usr/bin/env node

import "dotenv/config";
import { closeDb, getMemories } from "../src/db.js";
import {
  QDRANT_COLLECTION,
  createMemoryVectorStore,
  createQdrantCloudClient,
} from "../src/vector-store.js";

const PAGE_SIZE = 100;

async function syncMemoryVectors() {
  const store = createMemoryVectorStore({
    client: createQdrantCloudClient(),
  });
  let offset = 0;
  let synced = 0;

  while (true) {
    const memories = getMemories({ limit: PAGE_SIZE, offset });
    if (!memories.length) break;

    for (const memory of memories) {
      await store.indexMemory(memory);
      synced += 1;
      console.log(`Indexed ${synced}: ${memory.id}`);
    }

    offset += memories.length;
    if (memories.length < PAGE_SIZE) break;
  }

  console.log(
    `Synced ${synced} memories to Qdrant Cloud collection "${QDRANT_COLLECTION}".`,
  );
}

syncMemoryVectors()
  .catch((error) => {
    console.error(`Qdrant Cloud sync failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    closeDb();
  });
