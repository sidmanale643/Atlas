import {
  formatJson,
  formatMemoryDetail,
  printError,
  printJson,
} from "../format.js";

const HELP = `Usage: neurogram get <id> [options]

Fetch one memory by ID with its full extraction (entities, relationships,
regions).

Options:
  --json    Emit the raw memory object.
`;

export const meta = {
  name: "get",
  help: HELP,
  options: ["json"],
};

export async function run({ positional, flags, deps, json }) {
  const [id] = positional;
  if (!id) {
    printError("get requires a memory ID. Try: neurogram get mem_12ab34cd");
    return { exitCode: 2 };
  }

  try {
    const memory = deps.serializeMemory(deps.getMemory(id));
    if (!memory || !memory.id) {
      printError(`Memory not found: ${id}`);
      return { exitCode: 1 };
    }
    if (json) {
      printJson(memory);
    } else {
      console.log(formatMemoryDetail(memory));
    }
    return { exitCode: 0 };
  } catch (error) {
    printError(`Could not get memory: ${error.message}`);
    return { exitCode: 1 };
  }
}
