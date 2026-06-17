import { readFileSync, writeFileSync, existsSync } from "node:fs";

const LINE_RE = /^([A-Z_][A-Z0-9_]*)=(.*)$/;

export function readEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const content = readFileSync(filePath, "utf8");
  const records = {};
  for (const line of content.split("\n")) {
    const m = line.match(LINE_RE);
    if (m) {
      records[m[1]] = m[2];
    }
  }
  return records;
}

export function writeEnvFile(filePath, records) {
  const lines = Object.entries(records).map(([k, v]) => `${k}=${v}`);
  writeFileSync(filePath, lines.join("\n") + "\n", "utf8");
}

export function updateEnvValue(filePath, key, value) {
  const records = readEnvFile(filePath);
  if (value === "" || value === undefined || value === null) {
    delete records[key];
  } else {
    records[key] = value;
  }
  writeEnvFile(filePath, records);
  return records;
}

const SECRET_PATTERNS = [/KEY/i, /SECRET/i, /TOKEN/i, /PASSWORD/i];

export function isSecretKey(key) {
  return SECRET_PATTERNS.some((p) => p.test(key));
}

export function maskValue(val) {
  if (!val) return "";
  if (val.length <= 8) return "***";
  return val.slice(0, 3) + "***" + val.slice(-4);
}
