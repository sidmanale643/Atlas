import {
  formatJson,
  formatMemoriesTable,
  printError,
  printJson,
} from "../format.js";

const HELP = `Usage: atlas search <query> [options]

Find memories using hybrid search (semantic + keyword).

Options:
  --limit <n>          Max results, 1-100. Default: 20
  --threshold <f>      Minimum similarity score in -1..1.
  --strategy <name>    hybrid (default) | vector | bm25
  --json               Emit the raw hits.
`;

export const meta = {
  name: "search",
  help: HELP,
  options: ["limit", "threshold", "strategy", "json"],
};

const STRATEGIES = new Set(["hybrid", "vector", "bm25"]);

export async function run({ positional, flags, deps, json }) {
  const query = positional.join(" ").trim();
  if (!query) {
    printError("search requires a query. Try: atlas search \"coffee preference\"");
    return { exitCode: 2 };
  }
  const limit = Number.isFinite(flags.limit) ? flags.limit : 20;
  if (limit < 1 || limit > 100) {
    printError("--limit must be between 1 and 100");
    return { exitCode: 2 };
  }
  const strategy = flags.strategy || "hybrid";
  if (!STRATEGIES.has(strategy)) {
    printError(`--strategy must be one of: ${[...STRATEGIES].join(", ")}`);
    return { exitCode: 2 };
  }
  const scoreThreshold = Number.isFinite(flags.threshold)
    ? flags.threshold
    : undefined;

  try {
    const hits = await deps.hybridSearchMemories(query, {
      limit,
      scoreThreshold,
      strategy,
    });
    const memories = hits.flatMap(({ id, score }) => {
      const memory = deps.serializeMemory(deps.getMemory(id));
      return memory && memory.id ? [{ ...memory, rrfScore: score }] : [];
    });
    const payload = { query, strategy, memories };
    if (json) {
      printJson(payload);
    } else {
      console.log(formatMemoriesTable(memories));
    }
    return { exitCode: 0 };
  } catch (error) {
    printError(`Could not search memories: ${error.message}`);
    return { exitCode: 1 };
  }
}
