const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

const activeLevel = LEVELS[process.env.LOG_LEVEL || "info"] ?? LEVELS.info;
const useStderr = process.env.LOG_STREAM === "stderr";

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
  const write = (method, message) => {
    if (useStderr) {
      console.error(message);
      return;
    }
    console[method](message);
  };

  return {
    debug(msg, data) {
      if (activeLevel <= LEVELS.debug) {
        write("debug", format("debug", context, msg, data));
      }
    },
    info(msg, data) {
      if (activeLevel <= LEVELS.info) {
        write("info", format("info", context, msg, data));
      }
    },
    warn(msg, data) {
      if (activeLevel <= LEVELS.warn) {
        write("warn", format("warn", context, msg, data));
      }
    },
    error(msg, data) {
      if (activeLevel <= LEVELS.error) {
        write("error", format("error", context, msg, data));
      }
    },
  };
}

export default createLogger;
