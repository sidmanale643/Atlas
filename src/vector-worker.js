const DEFAULT_MAX_ATTEMPTS = 8;

export function createVectorWorker({
  db,
  indexMemoryVector,
  now = () => new Date(),
  pollIntervalMs = 1_000,
  baseRetryMs = 1_000,
  maxRetryMs = 60_000,
} = {}) {
  if (!db || typeof db.claimVectorIndexJob !== "function") {
    throw new TypeError("vector worker requires a database job adapter");
  }
  if (typeof indexMemoryVector !== "function") {
    throw new TypeError("vector worker requires indexMemoryVector()");
  }
  let stopped = false;

  const runOnce = async () => {
    const claimedAt = now().toISOString();
    const job = db.claimVectorIndexJob({ now: claimedAt });
    if (!job) return { status: "idle" };
    try {
      const memory = db.getMemory(job.memory_id);
      if (!memory) throw new Error(`Memory not found: ${job.memory_id}`);
      if (memory.version === job.memory_version) await indexMemoryVector(memory);
      db.completeVectorIndexJob({ jobId: job.id, completedAt: now().toISOString() });
      return {
        status: memory.version === job.memory_version ? "completed" : "superseded",
        job,
      };
    } catch (error) {
      const attempts = Number(job.attempts) || 1;
      const terminal = attempts >= (job.max_attempts || DEFAULT_MAX_ATTEMPTS);
      const failedAt = now();
      if (terminal) {
        db.failVectorIndexJob(job.id, {
          error: error.message,
          failedAt: failedAt.toISOString(),
        });
        return { status: "failed", job, error };
      }
      const delay = Math.min(maxRetryMs, baseRetryMs * 2 ** (attempts - 1));
      db.retryVectorIndexJob({
        jobId: job.id,
        error: error.message,
        retryAt: new Date(failedAt.getTime() + delay).toISOString(),
        updatedAt: failedAt.toISOString(),
      });
      return { status: "retrying", job, error };
    }
  };

  const run = async ({ signal } = {}) => {
    stopped = false;
    const recoveredAt = now();
    db.recoverVectorIndexJobs({
      now: recoveredAt.toISOString(),
      retryAt: recoveredAt.toISOString(),
      staleBefore: new Date(recoveredAt.getTime() - 5 * 60_000).toISOString(),
    });
    while (!stopped && !signal?.aborted) {
      const result = await runOnce();
      if (result.status === "idle") {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
    }
  };

  return { run, runOnce, stop: () => { stopped = true; } };
}
