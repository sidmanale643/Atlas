"""Helpers for reading and writing .env files. Mirrors src/cli/env-file.js."""

from __future__ import annotations

import os
import re

_LINE_RE = re.compile(r"^([A-Z_][A-Z0-9_]*)=(.*)$")

SECRET_PATTERNS = [re.compile(p) for p in (r"KEY", r"SECRET", r"TOKEN", r"PASSWORD")]


def read_env_file(file_path):
    if not os.path.exists(file_path):
        return {}
    with open(file_path, "r", encoding="utf8") as f:
        content = f.read()
    records = {}
    for line in content.split("\n"):
        m = _LINE_RE.match(line)
        if m:
            records[m.group(1)] = m.group(2)
    return records


def write_env_file(file_path, records):
    lines = [f"{k}={v}" for k, v in records.items()]
    with open(file_path, "w", encoding="utf8") as f:
        f.write("\n".join(lines) + "\n")


def update_env_value(file_path, key, value):
    records = read_env_file(file_path)
    if value == "" or value is None:
        records.pop(key, None)
    else:
        records[key] = value
    write_env_file(file_path, records)
    return records


def is_secret_key(key):
    return any(p.search(key) for p in SECRET_PATTERNS)


def mask_value(val):
    if not val:
        return ""
    if len(val) <= 8:
        return "***"
    return val[:3] + "***" + val[-4:]
