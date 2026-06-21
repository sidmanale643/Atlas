"""atlas list command. Mirrors src/cli/commands/list.js."""

from __future__ import annotations

from ..format import format_memories_table, print_error, print_json

HELP = """Usage: atlas list [options]

List recently stored memories, newest first.

Options:
  --limit <n>     Page size, 1-100. Default: 20
  --offset <n>    Pagination offset. Default: 0
  --source <s>    Filter by source: ui | mcp | cli
  --json          Emit the raw memory array.
"""

META = {
    "name": "list",
    "help": HELP,
    "options": ["limit", "offset", "source", "json"],
}


def _is_finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


async def run(positional, flags, deps, json):
    limit = flags["limit"] if _is_finite(flags.get("limit")) else 20
    offset = flags["offset"] if _is_finite(flags.get("offset")) else 0
    if limit < 1 or limit > 100:
        print_error("--limit must be between 1 and 100")
        return {"exitCode": 2}
    if offset < 0:
        print_error("--offset must be >= 0")
        return {"exitCode": 2}

    try:
        memories = deps["getMemories"]({
            "limit": limit,
            "offset": offset,
            "source": flags.get("source"),
        })
        if json:
            print_json(memories)
        else:
            print(format_memories_table(memories))
        return {"exitCode": 0}
    except Exception as error:
        print_error(f"Could not list memories: {error}")
        return {"exitCode": 1}
