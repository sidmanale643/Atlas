"""atlas get command. Mirrors src/cli/commands/get.js."""

from __future__ import annotations

from ..format import format_memory_detail, print_error, print_json

HELP = """Usage: atlas get <id> [options]

Fetch one memory by ID with its full extraction (entities, relationships,
regions).

Options:
  --json    Emit the raw memory object.
"""

META = {
    "name": "get",
    "help": HELP,
    "options": ["json"],
}


async def run(positional, flags, deps, json):
    if not positional:
        print_error("get requires a memory ID. Try: atlas get mem_12ab34cd")
        return {"exitCode": 2}
    mid = positional[0]

    try:
        memory = deps["serializeMemory"](deps["getMemory"](mid))
        if not memory or not memory.get("id"):
            print_error(f"Memory not found: {mid}")
            return {"exitCode": 1}
        if json:
            print_json(memory)
        else:
            print(format_memory_detail(memory))
        return {"exitCode": 0}
    except Exception as error:
        print_error(f"Could not get memory: {error}")
        return {"exitCode": 1}
