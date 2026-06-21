"""atlas related command. Mirrors src/cli/commands/related.js."""

from __future__ import annotations

from ..format import format_related_list, print_error, print_json

HELP = """Usage: atlas related <id> [options]

Find memories connected to <id> through shared entities, relationships,
semantic similarity, and BM25 keyword matches.

Options:
  --limit <n>       Max results, 1-20. Default: 5
  --threshold <f>   Minimum similarity score in -1..1. Default: 0.65
  --json            Emit the raw result.
"""

META = {
    "name": "related",
    "help": HELP,
    "options": ["limit", "threshold", "json"],
}


def _is_finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


async def run(positional, flags, deps, json):
    if not positional:
        print_error("related requires a memory ID.")
        return {"exitCode": 2}
    mid = positional[0]
    limit = flags["limit"] if _is_finite(flags.get("limit")) else 5
    if limit < 1 or limit > 20:
        print_error("--limit must be between 1 and 20")
        return {"exitCode": 2}
    score_threshold = flags["threshold"] if _is_finite(flags.get("threshold")) else 0.65

    try:
        result = await deps["getRelatedMemories"](mid, {"limit": limit, "scoreThreshold": score_threshold})
        if not result:
            print_error(f"Memory not found: {mid}")
            return {"exitCode": 1}
        if json:
            print_json(result)
        else:
            print(format_related_list(result))
        return {"exitCode": 0}
    except Exception as error:
        print_error(f"Could not get related memories: {error}")
        return {"exitCode": 1}
