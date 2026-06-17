import { calculateRetryDelay } from "./cognitive-worker.js";

const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_STALE_AFTER_MS = 5 * 60_000;
const DEFAULT_BASE_RETRY_MS = 1_000;
const DEFAULT_MAX_RETRY_MS = 60_000;
const DEFAULT_MAX_ATTEMPTS = 5;

function requiredFunction(value, name) {
  if (typeof value !== "function") {
    throw new TypeError(`ingestion worker requires ${name}()`);
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

function sourceId(job) {
  return job.sourceId ?? job.source_id ?? job.source?.id;
}

function attemptCount(job) {
  const value = Number(job.attempts ?? job.attemptCount ?? job.attempt_count);
  return Number.isInteger(value) && value > 0 ? value : 1;
}

function maximumAttempts(job, fallback) {
  const value = Number(job.maxAttempts ?? job.max_attempts ?? job.maximumAttempts);
  return Number.isInteger(value) && value > 0 ? Math.min(value, fallback) : fallback;
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

export function createIngestionWorker({
  db,
  ingestionService,
  now = () => new Date(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
  baseRetryMs = DEFAULT_BASE_RETRY_MS,
  maxRetryMs = DEFAULT_MAX_RETRY_MS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  onError = () => {},
} = {}) {
  if (!db || typeof db !== "object") {
    throw new TypeError("ingestion worker requires a db adapter");
  }
  if (!ingestionService || typeof ingestionService.runIngestion !== "function") {
    throw new TypeError("ingestion worker requires ingestionService.runIngestion()");
  }

  const options = { pollIntervalMs, staleAfterMs, baseRetryMs, maxRetryMs, maxAttempts };
  validateOptions(options);

  const claimJob = requiredFunction(db.claimIngestionJob, "db.claimIngestionJob");
  const recoverJobs = requiredFunction(db.recoverIngestionJobs, "db.recoverIngestionJobs");
  const completeJob = requiredFunction(db.completeIngestionJob, "db.completeIngestionJob");
  const retryJob = requiredFunction(db.retryIngestionJob, "db.retryIngestionJob");
  const failJob = optionalFunction(db.failIngestionJob);

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

    const delayMs = calculateRetryDelay(attempts, { baseRetryMs, maxRetryMs });
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
      const id = sourceId(job);
      if (!id) throw new Error(`ingestion job ${jobId(job)} has no source id`);
      const result = await ingestionService.runIngestion(id);
      await completeJob.call(db, {
        jobId: jobId(job),
        completedAt: currentDate().toISOString(),
      });
      return { status: "completed", job, result };
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
        staleBefore: new Date(recoveredAt.getTime() - staleAfterMs).toISOString(),
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

export async function runIngestionWorkerCycle(dependencies) {
  return createIngestionWorker(dependencies).runOnce();
}
