import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  printError,
  printJson,
} from "../format.js";
import {
  readEnvFile,
  updateEnvValue,
  maskValue,
  isSecretKey,
} from "../env-file.js";

const KNOWN_PROVIDERS = ["tokenrouter", "openrouter"];

const CONFIG_KEYS = [
  { key: "LLM_PROVIDER", description: "LLM backend", default: "tokenrouter" },
  { key: "LLM_MODEL", description: "Model override", default: "(provider default)" },
  { key: "TOKENROUTER_API_KEY", description: "TokenRouter API key" },
  { key: "OPENROUTER_API_KEY", description: "OpenRouter API key" },
  { key: "PORT", description: "HTTP server port", default: "3001" },
  { key: "LOG_LEVEL", description: "Log level", default: "info" },
  { key: "ENGRAM_DB_PATH", description: "SQLite database path", default: "./engram.db" },
  { key: "EMBEDDING_MODEL", description: "Embedding model", default: "Xenova/all-MiniLM-L6-v2" },
  { key: "EMBEDDING_DIMENSIONS", description: "Embedding dimensions", default: "384" },
  { key: "EMBEDDING_DTYPE", description: "Embedding quantization", default: "q8" },
  { key: "ATLAS_MODE", description: "Runtime mode", default: "local" },
  { key: "AUTH_ENABLED", description: "Auth enabled", default: "false" },
  { key: "SUPABASE_URL", description: "Supabase project URL" },
  { key: "SUPABASE_PUBLISHABLE_KEY", description: "Supabase anon key" },
];

const HELP = `Usage: atlas config [subcommand] [args]

View and edit Atlas configuration (.env file).

Subcommands:
  (none)               Show all current config values
  get <KEY>            Get a single config value
  set <KEY> <VALUE>    Set a config value in .env
  provider [name]      Show or switch LLM provider (tokenrouter|openrouter)
  model [name]         Show or set model override (LLM_MODEL)
  apikey <provider> <key>  Set API key for a provider

Examples:
  atlas config                    Show all config
  atlas config get LLM_PROVIDER   Get one value
  atlas config set PORT 4000      Change port
  atlas config provider openrouter Switch provider
  atlas config model gpt-4o       Override model
  atlas config apikey openrouter sk-or-v1-...  Set API key
`;

export const meta = {
  name: "config",
  help: HELP,
  options: ["json"],
};

function resolveEnvPath() {
  return resolve(process.cwd(), ".env");
}

function envPath() {
  const p = resolveEnvPath();
  return existsSync(p) ? p : null;
}

function showConfig(json) {
  const filePath = envPath();
  const fileRecords = filePath ? readEnvFile(filePath) : {};
  const rows = [];

  for (const def of CONFIG_KEYS) {
    const fileVal = fileRecords[def.key];
    const envVal = process.env[def.key];
    const raw = envVal || fileVal || "";
    const source = envVal ? "env" : fileVal ? ".env" : "default";
    const display = raw || def.default || "";
    const masked = isSecretKey(def.key) && raw ? maskValue(raw) : display;
    rows.push({ key: def.key, value: masked, raw, source, description: def.description });
  }

  if (json) {
    const out = {};
    for (const r of rows) {
      if (r.raw) out[r.key] = r.raw;
    }
    printJson(out);
    return;
  }

  if (!filePath) {
    console.log("No .env file found. Run 'atlas config set <KEY> <VALUE>' to create one.\n");
  }

  const keyW = Math.max(4, ...rows.map((r) => r.key.length));
  const valW = Math.max(5, ...rows.map((r) => r.value.length));

  const header = [
    "KEY".padEnd(keyW),
    "VALUE".padEnd(valW),
    "SOURCE",
  ].join("  ");
  console.log(header);
  console.log("─".repeat(header.length));

  for (const r of rows) {
    const display = isSecretKey(r.key) && r.raw
      ? `\x1b[2m${r.value}\x1b[0m`
      : r.value;
    const visibleLen = r.value.length;
    const padded = visibleLen < valW ? display + " ".repeat(valW - visibleLen) : display;
    console.log(`${r.key.padEnd(keyW)}  ${padded}  ${r.source}`);
  }
}

function getConfig(key, json) {
  const filePath = envPath();
  const fileRecords = filePath ? readEnvFile(filePath) : {};
  const value = process.env[key] || fileRecords[key] || "";
  if (json) {
    printJson({ key, value });
  } else if (value) {
    const display = isSecretKey(key) ? maskValue(value) : value;
    console.log(`${key}=${display}`);
  } else {
    console.log(`${key} (not set)`);
  }
}

function setConfig(key, value) {
  const filePath = envPath() || resolve(process.cwd(), ".env");
  updateEnvValue(filePath, key, value);
  if (value) {
    const display = isSecretKey(key) ? maskValue(value) : value;
    console.log(`Set ${key}=${display} in .env`);
  } else {
    console.log(`Removed ${key} from .env`);
  }
}

function switchProvider(name) {
  if (!name) {
    const current = process.env.LLM_PROVIDER || "tokenrouter";
    console.log(current);
    return;
  }
  if (!KNOWN_PROVIDERS.includes(name)) {
    printError(`Unknown provider "${name}". Valid: ${KNOWN_PROVIDERS.join(", ")}`);
    return;
  }
  setConfig("LLM_PROVIDER", name);
  console.log(`Restart the server to apply.`);
}

function setModel(name) {
  if (!name) {
    const current = process.env.LLM_MODEL || "(provider default)";
    console.log(current);
    return;
  }
  setConfig("LLM_MODEL", name);
  console.log(`Restart the server to apply.`);
}

function setApiKey(provider, key) {
  if (!provider || !key) {
    printError("Usage: atlas config apikey <provider> <key>");
    return;
  }
  if (!KNOWN_PROVIDERS.includes(provider)) {
    printError(`Unknown provider "${provider}". Valid: ${KNOWN_PROVIDERS.join(", ")}`);
    return;
  }
  const envKey = provider === "tokenrouter"
    ? "TOKENROUTER_API_KEY"
    : "OPENROUTER_API_KEY";
  setConfig(envKey, key);
}

export async function run({ positional, flags, json }) {
  const [sub, ...rest] = positional;

  if (!sub || sub === "show") {
    showConfig(json);
    return { exitCode: 0 };
  }

  if (sub === "get") {
    const key = rest[0];
    if (!key) {
      printError("Usage: atlas config get <KEY>");
      return { exitCode: 2 };
    }
    getConfig(key, json);
    return { exitCode: 0 };
  }

  if (sub === "set") {
    const key = rest[0];
    const value = rest[1];
    if (!key || value === undefined) {
      printError("Usage: atlas config set <KEY> <VALUE>");
      return { exitCode: 2 };
    }
    setConfig(key, value);
    return { exitCode: 0 };
  }

  if (sub === "provider") {
    switchProvider(rest[0]);
    return { exitCode: 0 };
  }

  if (sub === "model") {
    setModel(rest[0]);
    return { exitCode: 0 };
  }

  if (sub === "apikey") {
    setApiKey(rest[0], rest[1]);
    return { exitCode: 0 };
  }

  printError(`Unknown subcommand "${sub}". Run 'atlas config --help' for usage.`);
  return { exitCode: 2 };
}
