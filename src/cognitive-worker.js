import {
  REGION_MAPPING_VERSION,
  mapExtractionToRegions,
} from "./shared/region-mapper.js";

const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_STALE_AFTER_MS = 5 * 60_000;
const DEFAULT_BASE_RETRY_MS = 1_000;
const DEFAULT_MAX_RETRY_MS = 60_000;
const DEFAULT_MAX_ATTEMPTS = 5;

function requiredFunction(value, name) {
  if (typeof value !== "function") {
    throw new TypeError(`cognitive worker requires ${name}()`);
  }
  return value;
}

function optionalFunction(value) {
  return typeof value === "function" ? value : null;
}

function errorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function jobId(job) {
  return job.id ?? job.jobId ?? job.job_id;
}

function memoryId(job) {
  return job.memoryId ?? job.memory_id ?? job.memory?.id;
}

function attemptCount(job) {
  const value = Number(job.attempts ?? job.attemptCount ?? job.attempt_count);
  return Number.isInteger(value) && value > 0 ? value : 1;
}

function maximumAttempts(job, fallback) {
  const value = Number(
    job.maxAttempts ?? job.max_attempts ?? job.maximumAttempts,
  );
  return Number.isInteger(value) && value > 0
    ? Math.min(value, fallback)
    : fallback;
}

function semanticFrom(value) {
  if (!value) return null;
  return (
    value.semanticExtraction ??
    value.semantic_extraction ??
    value.extractionJson ??
    value.extraction_json ??
    value.extraction ??
    null
  );
}

function parseObject(value, label) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new TypeError(`${label} must contain valid JSON`);
  }
}

function validateOptions(options) {
  for (const [name, value] of [
    ["pollIntervalMs", options.pollIntervalMs],
    ["staleAfterMs", options.staleAfterMs],
    ["baseRetryMs", options.baseRetryMs],
    ["maxRetryMs", options.maxRetryMs],
  ]) {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`${name} must be a non-negative finite number`);
    }
  }
  if (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1) {
    throw new RangeError("maxAttempts must be a positive integer");
  }
  if (options.maxRetryMs < options.baseRetryMs) {
    throw new RangeError("maxRetryMs must be at least baseRetryMs");
  }
}

export function calculateRetryDelay(
  attempt,
  {
    baseRetryMs = DEFAULT_BASE_RETRY_MS,
    maxRetryMs = DEFAULT_MAX_RETRY_MS,
  } = {},
) {
  const exponent = Math.max(0, Number(attempt) - 1);
  return Math.min(maxRetryMs, baseRetryMs * 2 ** exponent);
}

export function createCognitiveWorker({
  db,
  annotateMemory,
  mapRegions = mapExtractionToRegions,
  now = () => new Date(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
  baseRetryMs = DEFAULT_BASE_RETRY_MS,
  maxRetryMs = DEFAULT_MAX_RETRY_MS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  mappingVersion = REGION_MAPPING_VERSION,
  onError = () => {},
} = {}) {
  if (!db || typeof db !== "object") {
    throw new TypeError("cognitive worker requires a db adapter");
  }
  requiredFunction(annotateMemory, "annotateMemory");
  requiredFunction(mapRegions, "mapRegions");

  const options = {
    pollIntervalMs,
    staleAfterMs,
    baseRetryMs,
    maxRetryMs,
    maxAttempts,
  };
  validateOptions(options);

  const claimJob = requiredFunction(
    db.claimAnnotationJob ?? db.claimPendingAnnotationJob,
    "db.claimAnnotationJob",
  );
  const recoverJobs = requiredFunction(
    db.recoverAnnotationJobs ?? db.recoverStaleAnnotationJobs ??
      db.recoverStaleProcessingJobs,
    "db.recoverAnnotationJobs",
  );
  const getMemory = optionalFunction(
    db.getMemory ?? db.getMemoryForAnnotation,
  );
  const getSemantic = optionalFunction(
    db.getLatestExtraction ?? db.getSemanticExtraction ??
      db.getLatestSemanticExtraction,
  );
  const saveAnnotation = requiredFunction(
    db.saveCognitiveAnnotation ?? db.persistCognitiveAnnotation,
    "db.saveCognitiveAnnotation",
  );
  const saveActivations = requiredFunction(
    db.saveRegionActivations ?? db.replaceRegionActivations,
    "db.saveRegionActivations",
  );
  const completeJob = requiredFunction(
    db.completeAnnotationJob ?? db.markAnnotationJobCompleted,
    "db.completeAnnotationJob",
  );
  const retryJob = requiredFunction(
    db.retryAnnotationJob ?? db.rescheduleAnnotationJob,
    "db.retryAnnotationJob",
  );
  const failJob = optionalFunction(
    db.failAnnotationJob ?? db.markAnnotationJobFailed,
  );

  let timer = null;
  let resolvePoll = null;
  let loopPromise = null;
  let stopped = true;

  const currentDate = () => {
    const value = now();
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new TypeError("now() must return a valid Date or date value");
    }
    return date;
  };

  const loadMemory = async (job) => {
    const id = memoryId(job);
    if (job.memory) return job.memory;
    if (!id) throw new Error(`annotation job ${jobId(job)} has no memory id`);
    if (!getMemory) {
      throw new Error("annotation job has no memory and db.getMemory is absent");
    }
    const memory = await getMemory.call(db, id);
    if (!memory) throw new Error(`memory not found: ${id}`);
    return memory;
  };

  const loadSemantic = async (job, memory) => {
    const embedded = semanticFrom(job) ?? semanticFrom(memory);
    if (embedded) return parseObject(embedded, "semantic extraction");
    if (!getSemantic) {
      throw new Error(
        "annotation job has no semantic extraction and db.getSemanticExtraction is absent",
      );
    }
    const row = await getSemantic.call(db, memoryId(job) ?? memory.id);
    const semantic = semanticFrom(row) ?? row;
    if (!semantic) {
      throw new Error(`semantic extraction not found: ${memoryId(job) ?? memory.id}`);
    }
    return parseObject(semantic, "semantic extraction");
  };

  const reschedule = async (job, error) => {
    const attempts = attemptCount(job);
    const attemptLimit = maximumAttempts(job, maxAttempts);
    const id = jobId(job);
    const message = errorMessage(error);
    const failedAt = currentDate();

    if (attempts >= attemptLimit && failJob) {
      await failJob.call(db, id, {
        error: message,
        attempts,
        failedAt: failedAt.toISOString(),
      });
      return { status: "failed", job, error };
    }

    const delayMs = calculateRetryDelay(attempts, {
      baseRetryMs,
      maxRetryMs,
    });
    const retryAt = new Date(failedAt.getTime() + delayMs);
    await retryJob.call(db, {
      jobId: id,
      error: message,
      attempts,
      retryAt: retryAt.toISOString(),
      terminal: attempts >= attemptLimit,
      updatedAt: failedAt.toISOString(),
    });
    return {
      status: attempts >= attemptLimit ? "failed" : "retrying",
      job,
      error,
      retryAt,
      delayMs,
    };
  };

  const runOnce = async () => {
    const claimedAt = currentDate();
    const job = await claimJob.call(db, { now: claimedAt.toISOString() });
    if (!job) return { status: "idle" };

    try {
      const memory = await loadMemory(job);
      const semantic = await loadSemantic(job, memory);
      const semanticInput = {
        ...semantic,
        text: semantic.text ?? memory.raw_text ?? memory.text,
      };
      const annotation = await annotateMemory(semanticInput, {
        job,
        memory,
      });
      if (!annotation || typeof annotation !== "object") {
        throw new TypeError("annotateMemory() must return an annotation object");
      }

      const id = memoryId(job) ?? memory.id;
      await saveAnnotation.call(db, {
        memoryId: id,
        annotation,
        model: job.model,
        schemaVersion: job.schemaVersion ?? job.schema_version,
        jobId: jobId(job),
        attempts: attemptCount(job),
      });
      const activations = mapRegions({
        ...semantic,
        ...annotation,
      });
      await saveActivations.call(db, id, activations, mappingVersion);
      await completeJob.call(db, {
        jobId: jobId(job),
        completedAt: currentDate().toISOString(),
      });

      return { status: "completed", job, memory, annotation, activations };
    } catch (error) {
      return reschedule(job, error);
    }
  };

  const waitForPoll = () =>
    new Promise((resolve) => {
      resolvePoll = resolve;
      timer = setTimer(() => {
        timer = null;
        resolvePoll = null;
        resolve();
      }, pollIntervalMs);
    });

  const run = async ({ signal, recover = true } = {}) => {
    stopped = false;
    if (recover) {
      const recoveredAt = currentDate();
      await recoverJobs.call(db, {
        now: recoveredAt.toISOString(),
        retryAt: recoveredAt.toISOString(),
        staleBefore: new Date(
          recoveredAt.getTime() - staleAfterMs,
        ).toISOString(),
      });
    }

    while (!stopped && !signal?.aborted) {
      const result = await runOnce();
      if (result.status === "idle") await waitForPoll();
    }
  };

  const start = () => {
    if (loopPromise) return loopPromise;
    stopped = false;
    loopPromise = run()
      .catch((error) => {
        onError(error);
        throw error;
      })
      .finally(() => {
        loopPromise = null;
        stopped = true;
      });
    return loopPromise;
  };

  const stop = async () => {
    stopped = true;
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
      resolvePoll?.();
      resolvePoll = null;
    }
    await loopPromise;
  };

  return {
    start,
    run,
    runOnce,
    stop,
    get running() {
      return loopPromise !== null;
    },
  };
}

export async function runCognitiveWorkerCycle(dependencies) {
  return createCognitiveWorker(dependencies).runOnce();
}
