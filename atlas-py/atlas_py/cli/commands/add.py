"""atlas add command. Mirrors src/cli/commands/add.js."""

from __future__ import annotations

from ..format import format_add_summary, print_error, print_json
from ...schemas import AddInputSchema

HELP = """Usage: atlas add <text...> [options]

Save a NEW personal memory. The text is split into atomic memories, each
matched against existing memories, and either created, updated, or left
unchanged based on similarity. The LLM infers a per-atom type from the
extraction; --type is an optional caller-level fallback.

Options:
  --type <enum>        Optional fallback: relationship | preference | fact |
                       decision | learning | event | instruction | observation |
                       error
  --title <str>        Optional short title (max 50 chars).
  --confidence <0-1>   Optional confidence in the memory. Default: 0.6
  --tags a,b,c         Comma-separated tags. Repeat to add more.
  --json               Emit the raw result object instead of a summary.
"""

META = {
    "name": "add",
    "help": HELP,
    "options": ["type", "title", "confidence", "tags", "json"],
}


async def run(positional, flags, deps, json):
    text = " ".join(positional).strip()
    if not text:
        print_error("add requires text. Try: atlas add \"I prefer dark roast coffee\"")
        return {"exitCode": 2}

    payload = {"text": text}
    for key in ("type", "title", "confidence", "tags"):
        v = flags.get(key)
        if v is not None:
            payload[key] = v
    parsed = AddInputSchema.safe_parse(payload)
    if not parsed["ok"]:
        issues = parsed.get("issues") or []
        first = issues[0] if issues else {}
        path = ".".join(str(p) for p in first.get("loc", ())) or "input"
        print_error(f"{path}: {first.get('msg', 'invalid')}")
        return {"exitCode": 2}

    data = parsed["value"]
    metadata = {}
    if data.get("type") is not None:
        metadata["type"] = data["type"]
    if data.get("title") is not None:
        metadata["title"] = data["title"]
    if data.get("confidence") is not None:
        metadata["confidence"] = data["confidence"]
    if data.get("tags") is not None:
        metadata["tags"] = data["tags"]

    try:
        await deps["getModel"]()
        result = await deps["ingestionService"]["ingest"](
            {
                "text": data["text"],
                "source": "cli",
                "metadata": metadata,
            }
        )
        if json:
            print_json(result)
        else:
            print(format_add_summary(result["memories"]))
        return {"exitCode": 0}
    except Exception as error:
        print_error(f"Could not add memory: {error}")
        return {"exitCode": 1}
