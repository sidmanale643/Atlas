"""atlas update command. Mirrors src/cli/commands/update.js."""

from __future__ import annotations

from ..format import format_memory_detail, print_error, print_json

HELP = """Usage: atlas update <id> --summary <text>

Replace the editable summary of an existing memory. The original raw text,
type, and extraction graph are preserved. The vector embedding is reindexed
after the update.

Options:
  --summary <str>   Replacement summary. Required.
  --json            Emit the refreshed memory object.
"""

META = {
    "name": "update",
    "help": HELP,
    "options": ["summary", "json"],
}


async def run(positional, flags, deps, json):
    if not positional:
        print_error("update requires a memory ID.")
        return {"exitCode": 2}
    mid = positional[0]
    summary = flags.get("summary")
    if not isinstance(summary, str) or not summary.strip():
        print_error("update requires --summary <text>.")
        return {"exitCode": 2}

    try:
        if not deps["getMemory"](mid):
            print_error(f"Memory not found: {mid}")
            return {"exitCode": 1}
        deps["updateMemorySummary"](mid, summary)
        try:
            await deps["indexMemoryVector"](deps["getMemory"](mid))
        except Exception as error:
            print_error(f"Could not reindex memory {mid}: {error}")
        memory = deps["serializeMemory"](deps["getMemory"](mid))
        if json:
            print_json(memory)
        else:
            print(format_memory_detail(memory))
        return {"exitCode": 0}
    except Exception as error:
        print_error(f"Could not update memory: {error}")
        return {"exitCode": 1}
