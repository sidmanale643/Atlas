"""Output formatters for the Atlas CLI. Mirrors src/cli/format.js."""

from __future__ import annotations

import json
import os
import re
import sys

RESET = "\x1b[0m"
DIM = "\x1b[2m"
BOLD = "\x1b[1m"
CYAN = "\x1b[36m"
YELLOW = "\x1b[33m"
RED = "\x1b[31m"
GREEN = "\x1b[32m"

try:
    _use_color = sys.stdout.isatty() and os.environ.get("NO_COLOR") is None
except Exception:
    _use_color = False


def _paint(color, text):
    return f"{color}{text}{RESET}" if _use_color else text


def _pad(value, width):
    s = "" if value is None else str(value)
    if len(s) >= width:
        return s
    return s + " " * (width - len(s))


def _truncate(value, max_len=80):
    s = "" if value is None else str(value)
    s = re.sub(r"\s+", " ", s).strip()
    if len(s) <= max_len:
        return s
    cut = max(0, max_len - 1)
    return s[:cut] + "\u2026"


def _format_score(score):
    if score is None:
        return "-"
    return f"{score:.3f}"


def _format_timestamp(value):
    if not value:
        return "-"
    s = str(value)
    s = s.replace("T", " ")
    s = re.sub(r"\.\d+Z$", "Z", s)
    return s


def _format_memory_row(memory):
    mid = memory.get("id") or memory.get("memory_id") or "-"
    mtype = memory.get("type") or "-"
    title = _truncate(memory.get("title") or memory.get("summary") or memory.get("raw_text") or "", 40)
    summary = _truncate(memory.get("summary") or memory.get("raw_text") or "", 80)
    score = memory.get("rrfScore")
    if score is None:
        score = memory.get("score")
    score_str = _format_score(score) if score is not None else "-"
    return {"id": mid, "type": mtype, "title": title, "summary": summary, "scoreStr": score_str}


def format_memories_table(memories):
    if not memories:
        return _paint(DIM, "(no memories)")
    rows = [_format_memory_row(m) for m in memories]
    widths = {
        "id": max(2, *(len(r["id"]) for r in rows)),
        "type": max(4, *(len(r["type"]) for r in rows)),
        "score": max(5, *(len(r["scoreStr"]) for r in rows)),
        "title": max(5, *(len(r["title"]) for r in rows)),
    }
    header = "  ".join([
        _paint(BOLD, _pad("ID", widths["id"])),
        _paint(BOLD, _pad("TYPE", widths["type"])),
        _paint(BOLD, _pad("SCORE", widths["score"])),
        _paint(BOLD, _pad("TITLE", widths["title"])),
        _paint(BOLD, "SUMMARY"),
    ])
    lines = [header, _paint(DIM, "\u2500" * min(120, len(header)))]
    for r in rows:
        lines.append("  ".join([
            _paint(CYAN, _pad(r["id"], widths["id"])),
            _paint(YELLOW, _pad(r["type"], widths["type"])),
            _pad(r["scoreStr"], widths["score"]),
            _pad(r["title"], widths["title"]),
            r["summary"],
        ]))
    return "\n".join(lines)


def format_memory_detail(memory):
    if not memory:
        return _paint(DIM, "(no memory)")
    lines = []
    lines.append(f"{_paint(BOLD, 'ID')}        {_paint(CYAN, memory.get('id') or '-')}")
    lines.append(f"{_paint(BOLD, 'Type')}      {memory.get('type') or '-'}")
    lines.append(f"{_paint(BOLD, 'Title')}     {memory.get('title') or '-'}")
    lines.append(f"{_paint(BOLD, 'Summary')}   {memory.get('summary') or '-'}")
    lines.append(f"{_paint(BOLD, 'Confidence')} {memory.get('confidence', '-')}")
    tags = memory.get("tags") or []
    if tags:
        lines.append(f"{_paint(BOLD, 'Tags')}      {', '.join(tags)}")
    lines.append(f"{_paint(BOLD, 'Created')}   {_format_timestamp(memory.get('created_at') or memory.get('createdAt'))}")
    lines.append(f"{_paint(BOLD, 'Updated')}   {_format_timestamp(memory.get('updated_at') or memory.get('updatedAt'))}")
    lines.append("")
    lines.append(_paint(BOLD, "Raw text"))
    lines.append(memory.get("raw_text") or "-")
    extraction = memory.get("extraction")
    if extraction:
        lines.append("")
        lines.append(_paint(BOLD, "Extraction"))
        if extraction.get("summary"):
            lines.append(f"  summary: {extraction['summary']}")
        types = extraction.get("types") or []
        if types:
            ts = ", ".join(
                f"{t.get('type') or t.get('name') or '?'}:{t.get('weight', '?')}" for t in types
            )
            lines.append(f"  types:   {ts}")
        entities = extraction.get("entities") or []
        if entities:
            lines.append(f"  entities ({len(entities)}):")
            for e in entities[:10]:
                lines.append(f"    - {e.get('name') or e.get('canonical_name') or e.get('text')} ({e.get('kind') or '?'})")
    entities = memory.get("entities") or []
    if entities:
        lines.append("")
        lines.append(_paint(BOLD, f"Entities ({len(entities)})"))
        for e in entities[:10]:
            lines.append(f"  - {e.get('canonical_name') or e.get('name')} ({e.get('kind') or '?'}) [{e.get('id')}]")
    rels = memory.get("relationships") or []
    if rels:
        lines.append("")
        lines.append(_paint(BOLD, f"Relationships ({len(rels)})"))
        for r in rels[:10]:
            source = (r.get("source") or {}).get("canonical_name") or r.get("source_name") or "?"
            target = (r.get("target") or {}).get("canonical_name") or r.get("target_name") or "?"
            lines.append(f"  - {source} {r.get('predicate') or '?'} {target}")
    regions = memory.get("regions") or []
    if regions:
        lines.append("")
        lines.append(_paint(BOLD, f"Regions ({len(regions)})"))
        for r in regions[:10]:
            lines.append(f"  - {r.get('region')}: {r.get('weight', '?')}")
    return "\n".join(lines)


def format_related_list(result):
    if not result or not isinstance(result.get("links"), list) or not result["links"]:
        return _paint(DIM, "(no related memories)")
    lines = [_paint(BOLD, f"Related to {result.get('memoryId')}"), ""]
    for idx, link in enumerate(result["links"]):
        mid = link.get("memoryId") or link.get("id") or "?"
        score = _format_score(link.get("score")) if link.get("score") is not None else "-"
        title = link.get("title") or link.get("summary") or link.get("rawText") or ""
        reasons = link.get("reasons") or []
        reasons_str = f" ({', '.join(reasons)})" if reasons else ""
        lines.append(f"{_paint(CYAN, f'{idx + 1}.')} {mid}  {_paint(DIM, score)}{reasons_str}")
        if title:
            lines.append(f"   {_truncate(title, 100)}")
    return "\n".join(lines)


def format_entities_table(entities):
    if not entities:
        return _paint(DIM, "(no matching entities)")
    rows = [
        {
            "id": str(e.get("id", "?")),
            "name": e.get("canonical_name") or e.get("name") or "?",
            "kind": e.get("kind") or "?",
            "aliases": len(e.get("aliases", [])) if isinstance(e.get("aliases"), list) else 0,
        }
        for e in entities
    ]
    widths = {
        "id": max(2, *(len(r["id"]) for r in rows)),
        "name": max(4, *(len(r["name"]) for r in rows)),
        "kind": max(4, *(len(r["kind"]) for r in rows)),
        "aliases": max(7, *(len(str(r["aliases"])) for r in rows)),
    }
    header = "  ".join([
        _paint(BOLD, _pad("ID", widths["id"])),
        _paint(BOLD, _pad("NAME", widths["name"])),
        _paint(BOLD, _pad("KIND", widths["kind"])),
        _paint(BOLD, _pad("ALIASES", widths["aliases"])),
    ])
    lines = [header, _paint(DIM, "\u2500" * len(header))]
    for r in rows:
        lines.append("  ".join([
            _paint(CYAN, _pad(r["id"], widths["id"])),
            _pad(r["name"], widths["name"]),
            _paint(YELLOW, _pad(r["kind"], widths["kind"])),
            _pad(str(r["aliases"]), widths["aliases"]),
        ]))
    return "\n".join(lines)


def format_add_summary(results):
    if not isinstance(results, list) or not results:
        return _paint(DIM, "(no memories)")
    lines = []
    for r in results:
        mid = "?"
        mem = r.get("memory") or {}
        if mem and mem.get("id"):
            mid = mem["id"]
        elif r.get("matchedMemoryId"):
            mid = r["matchedMemoryId"]
        action = r.get("action") or ""
        if action == "created":
            color = GREEN
        elif action == "updated":
            color = YELLOW
        else:
            color = DIM
        lines.append(
            f"{_paint(color, action.ljust(10))} {_paint(CYAN, mid)}  {_truncate(r.get('reason') or '', 80)}"
        )
    return "\n".join(lines)


def format_json(data):
    return json.dumps(data, indent=2)


def print_json(data):
    print(format_json(data))


def print_error(message):
    print(_paint(RED, f"Error: {message}"), file=sys.stderr)
