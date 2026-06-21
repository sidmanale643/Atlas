"""atlas delete command. Mirrors src/cli/commands/delete.js."""

from __future__ import annotations

import sys

from ..format import print_error, print_json

HELP = """Usage: atlas delete <id> [--yes]

Permanently delete a memory and its vector. Prompts for confirmation on a
TTY; use --yes to skip the prompt (recommended for scripts).
"""

META = {
    "name": "delete",
    "help": HELP,
    "options": ["yes"],
}


async def _confirm(mid):
    if not sys.stdout.isatty():
        return False
    sys.stdout.write(f"Delete memory {mid}? [y/N] ")
    sys.stdout.flush()
    line = sys.stdin.readline()
    answer = line.strip().lower() if line else ""
    return answer in ("y", "yes")


async def run(positional, flags, deps, json):
    if not positional:
        print_error("delete requires a memory ID.")
        return {"exitCode": 2}
    mid = positional[0]

    try:
        if not deps["getMemory"](mid):
            print_error(f"Memory not found: {mid}")
            return {"exitCode": 1}
        if not flags.get("yes"):
            ok = await _confirm(mid)
            if not ok:
                print("Aborted.")
                return {"exitCode": 0}
        deps["deleteMemory"](mid)
        try:
            await deps["deleteMemoryVector"](mid)
        except Exception as error:
            print_error(f"Could not delete vector for {mid}: {error}")
        result = {"ok": True, "deletedMemoryId": mid}
        if json:
            print_json(result)
        else:
            print(f"Deleted {mid}.")
        return {"exitCode": 0}
    except Exception as error:
        print_error(f"Could not delete memory: {error}")
        return {"exitCode": 1}
