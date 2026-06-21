"""Atlas CLI entry point. Mirrors src/cli.js."""

from __future__ import annotations

import os
import re
from pathlib import Path

from .args import parse_args
from .deps import default_dependencies
from .commands import add as add_cmd
from .commands import list as list_cmd
from .commands import get as get_cmd
from .commands import search as search_cmd
from .commands import related as related_cmd
from .commands import entities as entities_cmd
from .commands import entity as entity_cmd
from .commands import update as update_cmd
from .commands import delete as delete_cmd
from .commands import config as config_cmd

COMMANDS = {
    "add": add_cmd,
    "list": list_cmd,
    "get": get_cmd,
    "search": search_cmd,
    "related": related_cmd,
    "entities": entities_cmd,
    "entity": entity_cmd,
    "update": update_cmd,
    "delete": delete_cmd,
    "config": config_cmd,
}

_VERSION_CACHE = {}


def _load_version():
    if "value" in _VERSION_CACHE:
        return _VERSION_CACHE["value"]
    try:
        here = Path(__file__).resolve().parent
        for _ in range(6):
            try:
                pkg_path = here / "package.json"
                if pkg_path.exists():
                    import json
                    pkg = json.loads(pkg_path.read_text("utf8"))
                    if pkg.get("name") == "atlas-mcp":
                        _VERSION_CACHE["value"] = pkg["version"]
                        return pkg["version"]
            except Exception:
                pass
            parent = here.parent
            if parent == here:
                break
            here = parent
    except Exception:
        pass
    _VERSION_CACHE["value"] = "0.0.0"
    return "0.0.0"


VERSION = _load_version()

TOP_HELP = f"""atlas {VERSION}

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
"""


def _print_usage_error(message):
    print(f"Error: {message}\n", file=__import__("sys").stderr)
    print("Run 'atlas --help' for a list of commands.", file=__import__("sys").stderr)


async def run_cli(argv=None, deps=None):
    if argv is None:
        argv = []
    if deps is None:
        deps = default_dependencies()
    parsed = parse_args(argv)
    flags = parsed["flags"]
    positional = parsed["positional"]
    version = flags.get("version") is True or flags.get("v") is True

    if version:
        print(VERSION)
        return {"exitCode": 0}

    if not positional:
        print(TOP_HELP)
        return {"exitCode": 0}

    command_name, *rest = positional
    command = COMMANDS.get(command_name)
    if not command:
        _print_usage_error(f"unknown command: {command_name}")
        return {"exitCode": 2}

    sub = parse_args(rest)
    help_flag = (
        sub["flags"].get("help") is True
        or sub["flags"].get("h") is True
        or flags.get("help") is True
        or flags.get("h") is True
    )
    if help_flag:
        print(command.META["help"])
        return {"exitCode": 0}

    merged_flags = {**flags, **sub["flags"]}
    json_mode = merged_flags.get("json") is True or merged_flags.get("json") == "true"

    try:
        result = await command.run(sub["positional"], merged_flags, deps, json_mode)
        return result or {"exitCode": 0}
    except Exception as error:
        print(f"Error: {error}", file=__import__("sys").stderr)
        return {"exitCode": 1}


__all__ = ["run_cli", "COMMANDS", "VERSION", "TOP_HELP"]
