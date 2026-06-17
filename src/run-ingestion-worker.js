#!/usr/bin/env node
import "dotenv/config";
import * as db from "./db.js";
import { defaultDependencies } from "./cli/deps.js";
import { createIngestionWorker } from "./ingestion-worker.js";

const { ingestionService } = defaultDependencies();
const worker = createIngestionWorker({ db, ingestionService });
const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => controller.abort());
}
await worker.run({ signal: controller.signal });
