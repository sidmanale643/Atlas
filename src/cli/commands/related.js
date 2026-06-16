import {
  formatJson,
  formatRelatedList,
  printError,
  printJson,
} from "../format.js";

const HELP = `Usage: neurogram related <id> [options]

Find memories connected to <id> through shared entities, relationships,
semantic similarity, and BM25 keyword matches.

Options:
  --limit <n>       Max results, 1-20. Default: 5
  --threshold <f>   Minimum similarity score in -1..1. Default: 0.65
  --json            Emit the raw result.
`;

export const meta = {
  name: "related",
  help: HELP,
  options: ["limit", "threshold", "json"],
};

export async function run({ positional, flags, deps, json }) {
  const [id] = positional;
  if (!id) {
    printError("related requires a memory ID.");
    return { exitCode: 2 };
  }
  const limit = Number.isFinite(flags.limit) ? flags.limit : 5;
  if (limit < 1 || limit > 20) {
    printError("--limit must be between 1 and 20");
    return { exitCode: 2 };
  }
  const scoreThreshold = Number.isFinite(flags.threshold)
    ? flags.threshold
    : 0.65;

  try {
    const result = await deps.getRelatedMemories(id, { limit, scoreThreshold });
    if (!result) {
      printError(`Memory not found: ${id}`);
      return { exitCode: 1 };
    }
    if (json) {
      printJson(result);
    } else {
      console.log(formatRelatedList(result));
    }
    return { exitCode: 0 };
  } catch (error) {
    printError(`Could not get related memories: ${error.message}`);
    return { exitCode: 1 };
  }
}
