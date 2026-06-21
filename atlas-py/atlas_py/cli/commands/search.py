"""atlas search command. Mirrors src/cli/commands/search.js."""

from __future__ import annotations

from ..format import format_memories_table, print_error, print_json

HELP = """Usage: atlas search <query> [options]

Find memories using hybrid search (semantic + keyword).

Options:
  --limit <n>          Max results, 1-100. Default: 20
  --threshold <f>      Minimum similarity score in -1..1.
  --strategy <name>    hybrid (default) | vector | bm25
  --json               Emit the raw hits.
"""

META = {
    "name": "search",
    "help": HELP,
    "options": ["limit", "threshold", "strategy", "json"],
}

STRATEGIES = {"hybrid", "vector", "bm25"}


def _is_finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


async def run(positional, flags, deps, json):
    query = " ".join(positional).strip()
    if not query:
        print_error("search requires a query. Try: atlas search \"coffee preference\"")
        return {"exitCode": 2}
    limit = flags["limit"] if _is_finite(flags.get("limit")) else 20
    if limit < 1 or limit > 100:
        print_error("--limit must be between 1 and 100")
        return {"exitCode": 2}
    strategy = flags.get("strategy") or "hybrid"
    if strategy not in STRATEGIES:
        print_error(f"--strategy must be one of: {', '.join(sorted(STRATEGIES))}")
        return {"exitCode": 2}
    score_threshold = flags["threshold"] if _is_finite(flags.get("threshold")) else None

    try:
        hits = await deps["hybridSearchMemories"](query, {
            "limit": limit,
            "scoreThreshold": score_threshold,
            "strategy": strategy,
        })
        memories = []
        for hit in hits:
            mem = deps["serializeMemory"](deps["getMemory"](hit["id"]))
            if mem and mem.get("id"):
                memories.append({**mem, "rrfScore": hit.get("score")})
        payload = {"query": query, "strategy": strategy, "memories": memories}
        if json:
            print_json(payload)
        else:
            print(format_memories_table(memories))
        return {"exitCode": 0}
    except Exception as error:
        print_error(f"Could not search memories: {error}")
        return {"exitCode": 1}
