"""Handwritten argv parser. Returns {positional, flags} where flags is a plain
object (booleans for --name/--no-name, strings for --name value or
--name=value, comma-split arrays for repeatable flags). Stops parsing flags
after --. Mirrors src/cli/args.js.
"""

from __future__ import annotations

import re

REPEATABLE = {"tag", "tags"}

_INT_RE = re.compile(r"^[+-]?\d+$")
_FLOAT_RE = re.compile(r"^[+-]?\d+\.\d+$")


def _is_flag(token):
    return token.startswith("--") and len(token) > 2


def _split_flag(token):
    eq = token.find("=")
    if eq == -1:
        return token[2:], None
    return token[2:eq], token[eq + 1:]


def _camelize(name):
    parts = name.split("-")
    return parts[0] + "".join(p[:1].upper() + p[1:] for p in parts[1:] if p)


def _coerce_scalar(value):
    if value == "true":
        return True
    if value == "false":
        return False
    if _INT_RE.match(value):
        return int(value)
    if _FLOAT_RE.match(value):
        return float(value)
    return value


def _assign_flag(flags, name, raw_value):
    if name.startswith("no-") and raw_value is None:
        flags[_camelize(name[3:])] = False
        return
    value = True if raw_value is None else _coerce_scalar(raw_value)
    if name in REPEATABLE and value is not True and value is not False:
        items = [v.strip() for v in str(value).split(",") if v.strip()]
        key = _camelize(name)
        existing = flags.get(key)
        if isinstance(existing, list):
            flags[key] = existing + items
        else:
            flags[key] = items
        return
    flags[_camelize(name)] = value


def parse_args(argv):
    """Parse argv tokens into positional + flags dict."""
    positional = []
    flags = {}
    i = 0
    stop_flags = False
    while i < len(argv):
        token = argv[i]
        if stop_flags:
            positional.append(token)
            i += 1
            continue
        if token == "--":
            stop_flags = True
            i += 1
            continue
        if _is_flag(token):
            name, value = _split_flag(token)
            if value is not None:
                _assign_flag(flags, name, value)
                i += 1
                continue
            nxt = argv[i + 1] if i + 1 < len(argv) else None
            if nxt is not None and not _is_flag(nxt):
                _assign_flag(flags, name, nxt)
                i += 2
                continue
            _assign_flag(flags, name, None)
            i += 1
            continue
        positional.append(token)
        i += 1
    return {"positional": positional, "flags": flags}
