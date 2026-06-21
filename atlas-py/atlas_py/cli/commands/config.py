"""atlas config command. Mirrors src/cli/commands/config.js."""

from __future__ import annotations

import os
from pathlib import Path

from ..format import print_error, print_json
from ..env_file import (
    is_secret_key,
    mask_value,
    read_env_file,
    update_env_value,
)

KNOWN_PROVIDERS = ["tokenrouter", "openrouter"]

CONFIG_KEYS = [
    {"key": "LLM_PROVIDER", "description": "LLM backend", "default": "tokenrouter"},
    {"key": "LLM_MODEL", "description": "Model override", "default": "(provider default)"},
    {"key": "TOKENROUTER_API_KEY", "description": "TokenRouter API key"},
    {"key": "OPENROUTER_API_KEY", "description": "OpenRouter API key"},
    {"key": "PORT", "description": "HTTP server port", "default": "3000"},
    {"key": "LOG_LEVEL", "description": "Log level", "default": "info"},
    {"key": "ENGRAM_DB_PATH", "description": "SQLite database path", "default": "./engram.db"},
    {"key": "EMBEDDING_MODEL", "description": "Embedding model", "default": "Xenova/all-MiniLM-L6-v2"},
    {"key": "EMBEDDING_DIMENSIONS", "description": "Embedding dimensions", "default": "384"},
    {"key": "EMBEDDING_DTYPE", "description": "Embedding quantization", "default": "q8"},
    {"key": "ATLAS_MODE", "description": "Runtime mode", "default": "local"},
    {"key": "AUTH_ENABLED", "description": "Auth enabled", "default": "false"},
    {"key": "SUPABASE_URL", "description": "Supabase project URL"},
    {"key": "SUPABASE_PUBLISHABLE_KEY", "description": "Supabase anon key"},
]

HELP = """Usage: atlas config [subcommand] [args]

View and edit Atlas configuration (.env file).

Subcommands:
  (none)               Show all current config values
  get <KEY>            Get a single config value
  set <KEY> <VALUE>    Set a config value in .env
  provider [name]      Show or switch LLM provider (tokenrouter|openrouter)
  model [name]         Show or set model override (LLM_MODEL)
  apikey <provider> <key>  Set API key for a provider

Examples:
  atlas config                    Show all config
  atlas config get LLM_PROVIDER   Get one value
  atlas config set PORT 4000      Change port
  atlas config provider openrouter Switch provider
  atlas config model gpt-4o       Override model
  atlas config apikey openrouter sk-or-v1-...  Set API key
"""

META = {
    "name": "config",
    "help": HELP,
    "options": ["json"],
}


def _env_path():
    return str(Path(os.getcwd()) / ".env")


def _show_config(json_mode):
    p = _env_path()
    file_records = read_env_file(p) if os.path.exists(p) else {}
    rows = []
    for defn in CONFIG_KEYS:
        file_val = file_records.get(defn["key"], "")
        env_val = os.environ.get(defn["key"], "")
        raw = env_val or file_val or ""
        source = "env" if env_val else (".env" if file_val else "default")
        display = raw or defn.get("default") or ""
        masked = mask_value(raw) if (is_secret_key(defn["key"]) and raw) else display
        rows.append({
            "key": defn["key"],
            "value": masked,
            "raw": raw,
            "source": source,
            "description": defn.get("description", ""),
        })

    if json_mode:
        out = {}
        for r in rows:
            if r["raw"]:
                out[r["key"]] = r["raw"]
        print_json(out)
        return

    if not os.path.exists(p):
        print("No .env file found. Run 'atlas config set <KEY> <VALUE>' to create one.\n")

    key_w = max(4, *(len(r["key"]) for r in rows))
    val_w = max(5, *(len(r["value"]) for r in rows))
    header = f"{'KEY'.ljust(key_w)}  {'VALUE'.ljust(val_w)}  SOURCE"
    print(header)
    print("\u2500" * len(header))
    for r in rows:
        visible_len = len(r["value"])
        padded = r["value"].ljust(val_w) if visible_len < val_w else r["value"]
        print(f"{r['key'].ljust(key_w)}  {padded}  {r['source']}")


def _get_config(key, json_mode):
    p = _env_path()
    file_records = read_env_file(p) if os.path.exists(p) else {}
    value = os.environ.get(key) or file_records.get(key) or ""
    if json_mode:
        print_json({"key": key, "value": value})
    elif value:
        display = mask_value(value) if is_secret_key(key) else value
        print(f"{key}={display}")
    else:
        print(f"{key} (not set)")


def _set_config(key, value):
    p = _env_path() if os.path.exists(_env_path()) else str(Path(os.getcwd()) / ".env")
    update_env_value(p, key, value)
    if value:
        display = mask_value(value) if is_secret_key(key) else value
        print(f"Set {key}={display} in .env")
    else:
        print(f"Removed {key} from .env")


def _switch_provider(name):
    if not name:
        current = os.environ.get("LLM_PROVIDER", "tokenrouter")
        print(current)
        return
    if name not in KNOWN_PROVIDERS:
        print_error(f'Unknown provider "{name}". Valid: {", ".join(KNOWN_PROVIDERS)}')
        return
    _set_config("LLM_PROVIDER", name)
    print("Restart the server to apply.")


def _set_model(name):
    if not name:
        current = os.environ.get("LLM_MODEL", "(provider default)")
        print(current)
        return
    _set_config("LLM_MODEL", name)
    print("Restart the server to apply.")


def _set_api_key(provider, key):
    if not provider or not key:
        print_error("Usage: atlas config apikey <provider> <key>")
        return
    if provider not in KNOWN_PROVIDERS:
        print_error(f'Unknown provider "{provider}". Valid: {", ".join(KNOWN_PROVIDERS)}')
        return
    env_key = "TOKENROUTER_API_KEY" if provider == "tokenrouter" else "OPENROUTER_API_KEY"
    _set_config(env_key, key)


async def run(positional, flags, json):
    if not positional:
        _show_config(json)
        return {"exitCode": 0}
    sub = positional[0]
    rest = positional[1:]

    if sub == "show":
        _show_config(json)
        return {"exitCode": 0}
    if sub == "get":
        key = rest[0] if rest else None
        if not key:
            print_error("Usage: atlas config get <KEY>")
            return {"exitCode": 2}
        _get_config(key, json)
        return {"exitCode": 0}
    if sub == "set":
        key = rest[0] if rest else None
        value = rest[1] if len(rest) > 1 else None
        if not key or value is None:
            print_error("Usage: atlas config set <KEY> <VALUE>")
            return {"exitCode": 2}
        _set_config(key, value)
        return {"exitCode": 0}
    if sub == "provider":
        _switch_provider(rest[0] if rest else None)
        return {"exitCode": 0}
    if sub == "model":
        _set_model(rest[0] if rest else None)
        return {"exitCode": 0}
    if sub == "apikey":
        _set_api_key(rest[0] if rest else None, rest[1] if len(rest) > 1 else None)
        return {"exitCode": 0}
    print_error(f'Unknown subcommand "{sub}". Run \'atlas config --help\' for usage.')
    return {"exitCode": 2}
