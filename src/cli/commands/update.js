import {
  formatJson,
  formatMemoryDetail,
  printError,
  printJson,
} from "../format.js";

const HELP = `Usage: neurogram update <id> --summary <text>

Replace the editable summary of an existing memory. The original raw text,
type, and extraction graph are preserved. The vector embedding is reindexed
after the update.

Options:
  --summary <str>   Replacement summary. Required.
  --json            Emit the refreshed memory object.
`;

export const meta = {
  name: "update",
  help: HELP,
  options: ["summary", "json"],
};

export async function run({ positional, flags, deps, json }) {
  const [id] = positional;
  if (!id) {
    printError("update requires a memory ID.");
    return { exitCode: 2 };
  }
  if (typeof flags.summary !== "string" || !flags.summary.trim()) {
    printError("update requires --summary <text>.");
    return { exitCode: 2 };
  }

  try {
    if (!deps.getMemory(id)) {
      printError(`Memory not found: ${id}`);
      return { exitCode: 1 };
    }
    deps.updateMemorySummary(id, flags.summary);
    try {
      await deps.indexMemoryVector(deps.getMemory(id));
    } catch (error) {
      printError(`Could not reindex memory ${id}: ${error.message}`);
    }
    const memory = deps.serializeMemory(deps.getMemory(id));
    if (json) {
      printJson(memory);
    } else {
      console.log(formatMemoryDetail(memory));
    }
    return { exitCode: 0 };
  } catch (error) {
    printError(`Could not update memory: ${error.message}`);
    return { exitCode: 1 };
  }
}
