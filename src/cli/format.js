const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";

const useColor = process.stdout.isTTY && process.env.NO_COLOR === undefined;

function paint(color, text) {
  return useColor ? `${color}${text}${RESET}` : text;
}

function pad(value, width) {
  const str = String(value ?? "");
  if (str.length >= width) return str;
  return str + " ".repeat(width - str.length);
}

function truncate(str, max = 80) {
  const s = String(str ?? "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + "…";
}

function formatScore(score) {
  if (score === undefined || score === null) return "-";
  return score.toFixed(3);
}

function formatTimestamp(value) {
  if (!value) return "-";
  return String(value).replace("T", " ").replace(/\.\d+Z$/, "Z");
}

function formatMemoryRow(memory) {
  const id = memory.id || memory.memory_id || "-";
  const type = memory.type || "-";
  const title = truncate(memory.title || memory.summary || memory.raw_text || "", 40);
  const summary = truncate(memory.summary || memory.raw_text || "", 80);
  const score = memory.rrfScore ?? memory.score;
  const scoreStr = score !== undefined ? formatScore(score) : "-";
  return { id, type, title, summary, scoreStr };
}

function formatMemoriesTable(memories) {
  if (!memories || memories.length === 0) {
    return paint(DIM, "(no memories)");
  }
  const rows = memories.map(formatMemoryRow);
  const widths = {
    id: Math.max(2, ...rows.map((r) => r.id.length)),
    type: Math.max(4, ...rows.map((r) => r.type.length)),
    score: Math.max(5, ...rows.map((r) => r.scoreStr.length)),
    title: Math.max(5, ...rows.map((r) => r.title.length)),
  };
  const header = [
    paint(BOLD, pad("ID", widths.id)),
    paint(BOLD, pad("TYPE", widths.type)),
    paint(BOLD, pad("SCORE", widths.score)),
    paint(BOLD, pad("TITLE", widths.title)),
    paint(BOLD, "SUMMARY"),
  ].join("  ");
  const lines = [header, paint(DIM, "─".repeat(Math.min(120, header.length)))];
  for (const row of rows) {
    lines.push(
      [
        paint(CYAN, pad(row.id, widths.id)),
        paint(YELLOW, pad(row.type, widths.type)),
        pad(row.scoreStr, widths.score),
        pad(row.title, widths.title),
        row.summary,
      ].join("  "),
    );
  }
  return lines.join("\n");
}

function formatMemoryDetail(memory) {
  if (!memory) return paint(DIM, "(no memory)");
  const lines = [];
  lines.push(`${paint(BOLD, "ID")}        ${paint(CYAN, memory.id || "-")}`);
  lines.push(`${paint(BOLD, "Type")}      ${memory.type || "-"}`);
  lines.push(`${paint(BOLD, "Title")}     ${memory.title || "-"}`);
  lines.push(`${paint(BOLD, "Summary")}   ${memory.summary || "-"}`);
  lines.push(`${paint(BOLD, "Confidence")} ${memory.confidence ?? "-"}`);
  if (memory.tags && memory.tags.length) {
    lines.push(`${paint(BOLD, "Tags")}      ${memory.tags.join(", ")}`);
  }
  lines.push(
    `${paint(BOLD, "Created")}   ${formatTimestamp(memory.created_at || memory.createdAt)}`,
  );
  lines.push(
    `${paint(BOLD, "Updated")}   ${formatTimestamp(memory.updated_at || memory.updatedAt)}`,
  );
  lines.push("");
  lines.push(paint(BOLD, "Raw text"));
  lines.push(memory.raw_text || "-");

  if (memory.extraction) {
    lines.push("");
    lines.push(paint(BOLD, "Extraction"));
    if (memory.extraction.summary) {
      lines.push(`  summary: ${memory.extraction.summary}`);
    }
    if (Array.isArray(memory.extraction.types) && memory.extraction.types.length) {
      const ts = memory.extraction.types
        .map((t) => `${t.type || t.name || "?"}:${t.weight ?? "?"}`)
        .join(", ");
      lines.push(`  types:   ${ts}`);
    }
    if (Array.isArray(memory.extraction.entities) && memory.extraction.entities.length) {
      lines.push(`  entities (${memory.extraction.entities.length}):`);
      for (const e of memory.extraction.entities.slice(0, 10)) {
        lines.push(`    - ${e.name || e.canonical_name || e.text} (${e.kind || "?"})`);
      }
    }
  }

  if (Array.isArray(memory.entities) && memory.entities.length) {
    lines.push("");
    lines.push(paint(BOLD, `Entities (${memory.entities.length})`));
    for (const e of memory.entities.slice(0, 10)) {
      lines.push(`  - ${e.canonical_name || e.name} (${e.kind || "?"}) [${e.id}]`);
    }
  }

  if (Array.isArray(memory.relationships) && memory.relationships.length) {
    lines.push("");
    lines.push(paint(BOLD, `Relationships (${memory.relationships.length})`));
    for (const r of memory.relationships.slice(0, 10)) {
      const source = r.source?.canonical_name || r.source_name || "?";
      const target = r.target?.canonical_name || r.target_name || "?";
      lines.push(`  - ${source} ${r.predicate || "?"} ${target}`);
    }
  }

  if (Array.isArray(memory.regions) && memory.regions.length) {
    lines.push("");
    lines.push(paint(BOLD, `Regions (${memory.regions.length})`));
    for (const r of memory.regions.slice(0, 10)) {
      lines.push(`  - ${r.region}: ${r.weight ?? "?"}`);
    }
  }

  return lines.join("\n");
}

function formatRelatedList(result) {
  if (!result || !Array.isArray(result.links) || result.links.length === 0) {
    return paint(DIM, "(no related memories)");
  }
  const lines = [`${paint(BOLD, `Related to ${result.memoryId}`)}`, ""];
  result.links.forEach((link, index) => {
    const id = link.memoryId || link.id || "?";
    const score = link.score !== undefined ? formatScore(link.score) : "-";
    const title = link.title || link.summary || link.rawText || "";
    const reasons = Array.isArray(link.reasons) && link.reasons.length
      ? ` (${link.reasons.join(", ")})`
      : "";
    lines.push(
      `${paint(CYAN, `${index + 1}.`)} ${id}  ${paint(DIM, score)}${reasons}`,
    );
    if (title) lines.push(`   ${truncate(title, 100)}`);
  });
  return lines.join("\n");
}

function formatEntitiesTable(entities) {
  if (!entities || entities.length === 0) {
    return paint(DIM, "(no matching entities)");
  }
  const rows = entities.map((e) => ({
    id: String(e.id ?? "?"),
    name: e.canonical_name || e.name || "?",
    kind: e.kind || "?",
    aliases: Array.isArray(e.aliases) ? e.aliases.length : 0,
  }));
  const widths = {
    id: Math.max(2, ...rows.map((r) => r.id.length)),
    name: Math.max(4, ...rows.map((r) => r.name.length)),
    kind: Math.max(4, ...rows.map((r) => r.kind.length)),
    aliases: Math.max(7, ...rows.map((r) => String(r.aliases).length)),
  };
  const header = [
    paint(BOLD, pad("ID", widths.id)),
    paint(BOLD, pad("NAME", widths.name)),
    paint(BOLD, pad("KIND", widths.kind)),
    paint(BOLD, pad("ALIASES", widths.aliases)),
  ].join("  ");
  const lines = [header, paint(DIM, "─".repeat(header.length))];
  for (const row of rows) {
    lines.push(
      [
        paint(CYAN, pad(row.id, widths.id)),
        pad(row.name, widths.name),
        paint(YELLOW, pad(row.kind, widths.kind)),
        pad(String(row.aliases), widths.aliases),
      ].join("  "),
    );
  }
  return lines.join("\n");
}

function formatAddSummary(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return paint(DIM, "(no memories)");
  }
  const lines = [];
  for (const r of results) {
    const id = r.memory?.id || r.matchedMemoryId || "?";
    const color = r.action === "created"
      ? GREEN
      : r.action === "updated"
        ? YELLOW
        : DIM;
    lines.push(
      `${paint(color, r.action.padEnd(10))} ${paint(CYAN, id)}  ${truncate(r.reason || "", 80)}`,
    );
  }
  return lines.join("\n");
}

function formatJson(data) {
  return JSON.stringify(data, null, 2);
}

function printJson(data) {
  console.log(formatJson(data));
}

function printError(message) {
  console.error(paint(RED, `Error: ${message}`));
}

export {
  formatAddSummary,
  formatEntitiesTable,
  formatJson,
  formatMemoryDetail,
  formatMemoriesTable,
  formatRelatedList,
  printError,
  printJson,
};
