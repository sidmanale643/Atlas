// Handwritten argv parser. Returns { positional, flags } where flags is a plain
// object (booleans for `--name`/`--no-name`, strings for `--name value` or
// `--name=value`, comma-split arrays for repeatable flags via repeat()). Stops
// parsing flags after `--`. Reserved globals (`--json`, `--help`, `--version`)
// are not consumed here — the entry point reads them before delegating.

const REPEATABLE = new Set(["tag", "tags"]);

function isFlag(token) {
  return token.startsWith("--") && token.length > 2;
}

function splitFlag(token) {
  const eq = token.indexOf("=");
  if (eq === -1) return { name: token.slice(2), value: undefined };
  return { name: token.slice(2, eq), value: token.slice(eq + 1) };
}

function camelize(name) {
  return name.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
}

function coerceScalar(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  if (/^-?\d+\.\d+$/.test(value)) return Number(value);
  return value;
}

function assignFlag(flags, name, rawValue) {
  if (name.startsWith("no-") && rawValue === undefined) {
    flags[camelize(name.slice(3))] = false;
    return;
  }
  const value = rawValue === undefined ? true : coerceScalar(rawValue);
  if (REPEATABLE.has(name) && value !== true && value !== false) {
    const list = String(value)
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    const key = camelize(name);
    flags[key] = Array.isArray(flags[key]) ? [...flags[key], ...list] : list;
    return;
  }
  flags[camelize(name)] = value;
}

export function parseArgs(argv) {
  const positional = [];
  const flags = {};
  let i = 0;
  let stopFlags = false;
  while (i < argv.length) {
    const token = argv[i];
    if (stopFlags) {
      positional.push(token);
      i += 1;
      continue;
    }
    if (token === "--") {
      stopFlags = true;
      i += 1;
      continue;
    }
    if (isFlag(token)) {
      const { name, value } = splitFlag(token);
      if (value !== undefined) {
        assignFlag(flags, name, value);
        i += 1;
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !isFlag(next)) {
        assignFlag(flags, name, next);
        i += 2;
        continue;
      }
      assignFlag(flags, name, undefined);
      i += 1;
      continue;
    }
    positional.push(token);
    i += 1;
  }
  return { positional, flags };
}
