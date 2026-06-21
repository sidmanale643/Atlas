"""atlas entity command. Mirrors src/cli/commands/entity.js."""

from __future__ import annotations

from ..format import format_memories_table, print_error, print_json

HELP = """Usage: atlas entity <id>

List every memory linked to a specific entity. Pass the numeric entity ID
returned by `atlas entities <query>`.

Options:
  --json    Emit the raw memory array.
"""

META = {
    "name": "entity",
    "help": HELP,
    "options": ["json"],
}


async def run(positional, flags, deps, json):
    if not positional:
        print_error("entity requires a numeric entity ID.")
        return {"exitCode": 2}
    raw = positional[0]
    try:
        entity_id = int(raw)
    except (TypeError, ValueError):
        entity_id = None
    if not isinstance(entity_id, int) or entity_id <= 0:
        print_error(f"entity ID must be a positive integer, got: {raw}")
        return {"exitCode": 2}

    try:
        memories = deps["getMemoriesForEntity"](entity_id)
        if json:
            print_json({"entityId": entity_id, "memories": memories})
        else:
            print(format_memories_table(memories))
        return {"exitCode": 0}
    except Exception as error:
        print_error(f"Could not get entity memories: {error}")
        return {"exitCode": 1}
