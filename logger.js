const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

const activeLevel = LEVELS[process.env.LOG_LEVEL || "info"] ?? LEVELS.info;

function timestamp() {
  return new Date().toISOString();
}

function format(level, ctx, msg, data) {
  const base = `${timestamp()} ${level.toUpperCase().padEnd(5)} [${ctx}] ${msg}`;
  if (data !== undefined) {
    return `${base} ${typeof data === "string" ? data : JSON.stringify(data)}`;
  }
  return base;
}

function createLogger(context) {
  return {
    debug(msg, data) {
      if (activeLevel <= LEVELS.debug) console.debug(format("debug", context, msg, data));
    },
    info(msg, data) {
      if (activeLevel <= LEVELS.info) console.info(format("info", context, msg, data));
    },
    warn(msg, data) {
      if (activeLevel <= LEVELS.warn) console.warn(format("warn", context, msg, data));
    },
    error(msg, data) {
      if (activeLevel <= LEVELS.error) console.error(format("error", context, msg, data));
    },
  };
}

export default createLogger;
