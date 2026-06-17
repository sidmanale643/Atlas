#!/usr/bin/env node

import "dotenv/config";
import { pathToFileURL } from "node:url";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseArgs } from "./cli/args.js";
import { defaultDependencies } from "./cli/deps.js";
import { assertAtlasModeSupported } from "./vector-store.js";

process.env.LOG_STREAM = "stderr";

import * as add from "./cli/commands/add.js";
import * as list from "./cli/commands/list.js";
import * as getCmd from "./cli/commands/get.js";
import * as search from "./cli/commands/search.js";
import * as related from "./cli/commands/related.js";
import * as entities from "./cli/commands/entities.js";
import * as entityCmd from "./cli/commands/entity.js";
import * as update from "./cli/commands/update.js";
import * as del from "./cli/commands/delete.js";
import * as config from "./cli/commands/config.js";

const COMMANDS = {
  add,
  list,
  get: getCmd,
  search,
  related,
  entities,
  entity: entityCmd,
  update,
  delete: del,
  config,
};

function loadVersion() {
  try {
    const here = dirname(realpathSync(fileURLToPath(import.meta.url)));
    let dir = here;
    for (let i = 0; i < 5; i += 1) {
      try {
        const pkg = JSON.parse(
          readFileSync(resolve(dir, "package.json"), "utf8"),
        );
        if (pkg.name === "atlas-mcp") return pkg.version;
      } catch {
        // keep climbing
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // fall through
  }
  return "0.0.0";
}

const VERSION = loadVersion();

const TOP_HELP = `atlas ${VERSION}

Store, recall, and inspect memories from the terminal. Mirrors the Atlas
MCP tools; uses the same data store and LLM pipeline as the web app.

Usage: atlas <command> [args] [flags]

Commands:
  add <text>            Save a new memory (runs the LLM extraction pipeline)
  list                  Browse recently stored memories
  get <id>              Fetch one memory with its full extraction
  search <query>        Find memories via hybrid search
  related <id>          Find memories connected to <id>
  entities <query>      Look up canonical entities by name
  entity <id>           List memories for one entity
  update <id>           Replace a memory's summary (reindexes the vector)
  delete <id>           Permanently delete a memory
  config                View and edit configuration

Global flags:
  --help, -h            Show this help (or per-command help: atlas <cmd> --help)
  --version, -v         Print the version

Examples:
  atlas add "I prefer dark roast coffee" --type preference --title "Coffee" --json
  atlas search "coffee" --strategy hybrid --json
  atlas get mem_12ab34cd --json | jq .extraction
  atlas delete mem_12ab34cd --yes
`;

function printUsageError(message) {
  console.error(`Error: ${message}\n`);
  console.error(`Run 'atlas --help' for a list of commands.`);
}

export async function runCli(argv = process.argv.slice(2), deps = defaultDependencies()) {
  const { positional, flags } = parseArgs(argv);
  const version = flags.version === true || flags.v === true;

  if (version) {
    console.log(VERSION);
    return { exitCode: 0 };
  }

  const [commandName, ...rest] = positional;

  if (!commandName) {
    console.log(TOP_HELP);
    return { exitCode: 0 };
  }

  const command = COMMANDS[commandName];
  if (!command) {
    printUsageError(`unknown command: ${commandName}`);
    return { exitCode: 2 };
  }

  // The top-level parse already separated positional from flags, so the
  // command receives the same flag set. We only re-parse `rest` (positional
  // args after the command name) to keep `sub.positional` available and to
  // detect per-command `--help` placed after the command name.
  const sub = parseArgs(rest);
  const helpFlag = sub.flags.help === true
    || sub.flags.h === true
    || flags.help === true
    || flags.h === true;
  if (helpFlag) {
    console.log(command.meta.help);
    return { exitCode: 0 };
  }

  const mergedFlags = { ...flags, ...sub.flags };
  const json = mergedFlags.json === true || mergedFlags.json === "true";

  try {
    const result = await command.run({
      positional: sub.positional,
      flags: mergedFlags,
      deps,
      json,
    });
    return result || { exitCode: 0 };
  } catch (error) {
    console.error(`Error: ${error.message}`);
    return { exitCode: 1 };
  }
}

function isInvokedAsMain() {
  if (!process.argv[1]) return false;
  try {
    const real = realpathSync(process.argv[1]);
    return import.meta.url === pathToFileURL(real).href;
  } catch {
    return false;
  }
}

const isMain = isInvokedAsMain();

if (isMain) {
  let deps;
  Promise.resolve()
    .then(() => {
      assertAtlasModeSupported();
      deps = defaultDependencies();
      return runCli(process.argv.slice(2), deps);
    })
    .then((result) => {
      if (result && Number.isInteger(result.exitCode)) {
        process.exitCode = result.exitCode;
      }
    })
    .catch((error) => {
      console.error(`Error: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(() => {
      try {
        deps?.closeDb();
      } catch {
        // Ignore: closeDb is idempotent and may not exist in tests.
      }
    });
}
