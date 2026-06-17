#!/usr/bin/env node
import "dotenv/config";
import * as db from "./db.js";
import { annotateMemory } from "./llm.js";
import { createCognitiveWorker } from "./cognitive-worker.js";

const worker = createCognitiveWorker({ db, annotateMemory });
const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => controller.abort());
}
await worker.run({ signal: controller.signal });
