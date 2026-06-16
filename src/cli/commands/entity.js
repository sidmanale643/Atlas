import {
  formatJson,
  formatMemoriesTable,
  printError,
  printJson,
} from "../format.js";

const HELP = `Usage: neurogram entity <id>

List every memory linked to a specific entity. Pass the numeric entity ID
returned by \`neurogram entities <query>\`.

Options:
  --json    Emit the raw memory array.
`;

export const meta = {
  name: "entity",
  help: HELP,
  options: ["json"],
};

export async function run({ positional, flags, deps, json }) {
  const [raw] = positional;
  if (!raw) {
    printError("entity requires a numeric entity ID.");
    return { exitCode: 2 };
  }
  const entityId = Number.parseInt(raw, 10);
  if (!Number.isInteger(entityId) || entityId <= 0) {
    printError(`entity ID must be a positive integer, got: ${raw}`);
    return { exitCode: 2 };
  }

  try {
    const memories = deps.getMemoriesForEntity(entityId);
    if (json) {
      printJson({ entityId, memories });
    } else {
      console.log(formatMemoriesTable(memories));
    }
    return { exitCode: 0 };
  } catch (error) {
    printError(`Could not get entity memories: ${error.message}`);
    return { exitCode: 1 };
  }
}
