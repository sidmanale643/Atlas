"""atlas entities command. Mirrors src/cli/commands/entities.js."""

from __future__ import annotations

from ..format import format_entities_table, print_error, print_json

HELP = """Usage: atlas entities <query>

Look up canonical entities (people, places, objects, concepts, organizations)
by partial name. Use the returned numeric ID with `atlas entity <id>` to
list every memory linked to it.
"""

META = {
    "name": "entities",
    "help": HELP,
    "options": ["json"],
}


async def run(positional, flags, deps, json):
    query = " ".join(positional).strip()
    if not query:
        print_error("entities requires a query. Try: atlas entities Maya")
        return {"exitCode": 2}

    try:
        entities = deps["findEntities"](query)
        if json:
            print_json({"entities": entities})
        else:
            print(format_entities_table(entities))
        return {"exitCode": 0}
    except Exception as error:
        print_error(f"Could not find entities: {error}")
        return {"exitCode": 1}
