#!/usr/bin/env node
import "dotenv/config";
import * as db from "./db.js";
import { indexMemoryVector } from "./vector-store.js";
import { createVectorWorker } from "./vector-worker.js";

const worker = createVectorWorker({ db, indexMemoryVector });
const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => controller.abort());
}
await worker.run({ signal: controller.signal });
