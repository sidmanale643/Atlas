import {
  formatJson,
  printError,
  printJson,
} from "../format.js";

const HELP = `Usage: neurogram delete <id> [--yes]

Permanently delete a memory and its vector. Prompts for confirmation on a
TTY; use --yes to skip the prompt (recommended for scripts).
`;

export const meta = {
  name: "delete",
  help: HELP,
  options: ["yes"],
};

async function confirm(id) {
  if (!process.stdout.isTTY) return false;
  process.stdout.write(`Delete memory ${id}? [y/N] `);
  return new Promise((resolve) => {
    let buffer = "";
    const onData = (chunk) => {
      buffer += chunk.toString();
      if (buffer.includes("\n")) {
        process.stdin.removeListener("data", onData);
        process.stdin.pause();
        const answer = buffer.trim().toLowerCase();
        resolve(answer === "y" || answer === "yes");
      }
    };
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", onData);
  });
}

export async function run({ positional, flags, deps, json }) {
  const [id] = positional;
  if (!id) {
    printError("delete requires a memory ID.");
    return { exitCode: 2 };
  }

  try {
    if (!deps.getMemory(id)) {
      printError(`Memory not found: ${id}`);
      return { exitCode: 1 };
    }
    if (!flags.yes) {
      const ok = await confirm(id);
      if (!ok) {
        console.log("Aborted.");
        return { exitCode: 0 };
      }
    }
    deps.deleteMemory(id);
    try {
      await deps.deleteMemoryVector(id);
    } catch (error) {
      printError(`Could not delete vector for ${id}: ${error.message}`);
    }
    const result = { ok: true, deletedMemoryId: id };
    if (json) {
      printJson(result);
    } else {
      console.log(`Deleted ${id}.`);
    }
    return { exitCode: 0 };
  } catch (error) {
    printError(`Could not delete memory: ${error.message}`);
    return { exitCode: 1 };
  }
}
