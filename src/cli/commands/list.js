import {
  formatJson,
  formatMemoriesTable,
  printError,
  printJson,
} from "../format.js";

const HELP = `Usage: neurogram list [options]

List recently stored memories, newest first.

Options:
  --limit <n>     Page size, 1-100. Default: 20
  --offset <n>    Pagination offset. Default: 0
  --source <s>    Filter by source: ui | mcp | cli
  --json          Emit the raw memory array.
`;

export const meta = {
  name: "list",
  help: HELP,
  options: ["limit", "offset", "source", "json"],
};

export async function run({ positional, flags, deps, json }) {
  const limit = Number.isFinite(flags.limit) ? flags.limit : 20;
  const offset = Number.isFinite(flags.offset) ? flags.offset : 0;
  if (limit < 1 || limit > 100) {
    printError("--limit must be between 1 and 100");
    return { exitCode: 2 };
  }
  if (offset < 0) {
    printError("--offset must be >= 0");
    return { exitCode: 2 };
  }

  try {
    const memories = deps.getMemories({
      limit,
      offset,
      source: flags.source,
    });
    if (json) {
      printJson(memories);
    } else {
      console.log(formatMemoriesTable(memories));
    }
    return { exitCode: 0 };
  } catch (error) {
    printError(`Could not list memories: ${error.message}`);
    return { exitCode: 1 };
  }
}
