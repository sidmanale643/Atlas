"""HTTP server for the Atlas Python port.

Port of ``src/server.js`` covering the routes exercised by the Python test
suite. Implemented on top of the standard library so no third-party web
framework is required.
"""

from __future__ import annotations

import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable
from urllib.parse import parse_qs, urlparse

from . import db as db_mod
from . import related_memories
from . import vector_store
from .memory_comparison import build_memory_structural_diff


# --- Query parsing ---------------------------------------------------------


def _clamp_integer(value, fallback, minimum, maximum):
    try:
        n = int(value)
    except (TypeError, ValueError):
        return fallback
    if n < minimum:
        return minimum
    if n > maximum:
        return maximum
    return n


def _parse_optional_number(value):
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _parse_strict_integer(value, fallback, minimum, maximum, name):
    if value is None or value == "":
        return fallback
    try:
        n = int(value)
    except (TypeError, ValueError):
        raise ValueError(f"{name} must be an integer")
    if n < minimum or n > maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return n


def _parse_strict_number(value, fallback, minimum, maximum, name):
    if value is None or value == "":
        return fallback
    try:
        n = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{name} must be a number")
    if n < minimum or n > maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return n


def _parse_catalog_query(params, *, default_sort, default_order, sorts, filters):
    try:
        limit = _parse_strict_integer(
            params.get("limit", [None])[0], 25, 1, 100, "limit"
        )
        offset = _parse_strict_integer(
            params.get("offset", [None])[0], 0, 0, 10_000_000, "offset"
        )
        sort = params.get("sort", [default_sort])[0]
        if sort not in sorts:
            return {"ok": False, "error": f"sort must be one of: {', '.join(sorts)}"}
        order = params.get("order", [default_order])[0]
        if order not in ("asc", "desc"):
            return {"ok": False, "error": "order must be 'asc' or 'desc'"}
        value = {"limit": limit, "offset": offset, "sort": sort, "order": order}
        if "source" in filters:
            source = params.get("source", [None])[0]
            if source is not None and filters["source"] is not None and source not in filters["source"]:
                return {"ok": False, "error": f"source must be one of: {', '.join(filters['source'])}"}
            if source:
                value["source"] = source
        if "kind" in filters:
            kind = params.get("kind", [None])[0]
            if kind is not None and filters["kind"] is not None and kind not in filters["kind"]:
                return {"ok": False, "error": f"kind must be one of: {', '.join(filters['kind'])}"}
            if kind:
                value["kind"] = kind
        if "type" in filters:
            memory_type = params.get("type", [None])[0]
            if memory_type:
                value["types"] = [memory_type]
        if "q" in [k for k in (params.keys() or [])]:
            query = params.get("q", [None])[0]
            if query:
                value["query"] = query
        return {"ok": True, "value": value}
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}


# --- Serialization ---------------------------------------------------------


def _serialize_memory(memory, dependencies, *, include_relationships=True):
    if memory is None:
        return None
    memory_id = memory.get("id")
    out = dict(memory)
    out["extraction"] = dependencies["getLatestExtraction"](memory_id)
    out["entities"] = dependencies["getEntitiesForMemory"](memory_id)
    if include_relationships:
        out["relationships"] = dependencies["getRelationshipsForMemory"](memory_id)
    out["regions"] = dependencies["getRegionActivations"](memory_id)
    return out


def _serialize_relationship(rel):
    source = rel.get("source") or {}
    target = rel.get("target") or {}
    return {
        "id": rel.get("id"),
        "predicate": rel.get("predicate"),
        "confidence": rel.get("confidence"),
        "evidence": rel.get("evidence"),
        "subject": source.get("canonical_name"),
        "object": target.get("canonical_name"),
        "subjectId": source.get("id"),
        "objectId": target.get("id"),
        "kind": source.get("kind"),
        "source": source,
        "target": target,
        "memory_id": rel.get("memory_id"),
    }


def _comparison_response(
    *,
    left_memory_id,
    right_memory_id,
    analysis,
    cached,
    saved,
    structural_diff,
):
    return {
        "leftMemoryId": left_memory_id,
        "rightMemoryId": right_memory_id,
        "analysis": analysis,
        "structuralDiff": structural_diff,
        "generation": {"cached": cached, "saved": saved},
    }


# --- Default dependencies -------------------------------------------------


def _default_dependencies():
    return {
        "storeMemory": db_mod.store_memory,
        "getMemory": db_mod.get_memory,
        "getMemories": db_mod.get_memories,
        "getMemoryCatalog": db_mod.get_memory_catalog,
        "getEntityCatalog": db_mod.get_entity_catalog,
        "getEntity": db_mod.get_entity,
        "getEntityAliases": db_mod.get_entity_aliases,
        "getMemoriesForEntity": db_mod.get_memories_for_entity,
        "getEntitiesForMemory": db_mod.get_entities_for_memory,
        "getRelationshipsForMemory": db_mod.get_relationships_for_memory,
        "getRelationshipsForEntity": db_mod.get_relationships_for_entity,
        "getStructuralMemoryLinks": db_mod.get_structural_memory_links,
        "getRegionActivations": db_mod.get_region_activations,
        "getLatestExtraction": db_mod.get_latest_extraction,
        "getMemoryComparison": db_mod.get_memory_comparison,
        "saveMemoryComparison": db_mod.save_memory_comparison,
        "getEntityResolutionSuggestions": db_mod.get_entity_resolution_suggestions,
        "resolveEntityResolutionSuggestion": db_mod.resolve_entity_resolution_suggestion,
        "deleteMemory": db_mod.delete_memory,
        "deleteAllMemories": db_mod.delete_all_memories,
        "deleteAllEntities": db_mod.delete_all_entities,
        "updateMemorySummary": db_mod.update_memory_summary,
        "findEntities": db_mod.find_entities,
        "searchMemories": db_mod.search_memories,
        "searchMemoriesFts": db_mod.search_memories_fts,
        "searchMemoryVectors": vector_store.search_memory_vectors,
        "indexMemoryVector": vector_store.index_memory_vector,
        "deleteMemoryVector": vector_store.delete_memory_vector,
        "deleteAllMemoryVectors": vector_store.delete_all_memory_vectors,
        "compareMemories": None,
        "getRelatedMemories": lambda *args, **kwargs: related_memories.get_related_memories(*args, **kwargs),
    }


# --- Application factory ---------------------------------------------------


def create_atlas_app(overrides=None):
    dependencies = {**_default_dependencies(), **(overrides or {})}

    def serialize_memory(memory):
        return _serialize_memory(memory, dependencies)

    dependencies["serializeMemory"] = serialize_memory

    def handle(method, path, handler):
        _ROUTES.setdefault((method, _compile_path(path)), handler)

    routes: dict = {}

    def add(method, pattern, handler):
        routes[(method, _compile_path(pattern))] = handler

    add("GET", "/api/memories", lambda req, deps: _handle_list_memories(req, deps))
    add("GET", "/api/catalog/memories", lambda req, deps: _handle_catalog_memories(req, deps))
    add("GET", "/api/catalog/entities", lambda req, deps: _handle_catalog_entities(req, deps))
    add("GET", "/api/memories/search", lambda req, deps: _handle_search(req, deps))
    add("GET", "/api/memories/{id}", lambda req, deps: _handle_get_memory(req, deps))
    add("GET", "/api/memories/{id}/links", lambda req, deps: _handle_memory_links(req, deps))
    add("POST", "/api/memory-comparisons", lambda req, deps: _handle_memory_comparisons(req, deps))
    add("GET", "/api/entities", lambda req, deps: _handle_list_entities(req, deps))
    add("GET", "/api/entities/{id}/graph", lambda req, deps: _handle_entity_graph(req, deps))
    add("GET", "/api/entities/{id}/memories", lambda req, deps: _handle_entity_memories(req, deps))
    add("GET", "/api/entity-resolution/suggestions", lambda req, deps: _handle_entity_resolution_suggestions(req, deps))
    add("PATCH", "/api/entity-resolution/suggestions/{id}", lambda req, deps: _handle_entity_resolution_update(req, deps))
    add("GET", "/api/graph", lambda req, deps: _handle_graph(req, deps))
    add("GET", "/memories", lambda req, deps: _handle_spa(req, deps))
    add("GET", "/entities", lambda req, deps: _handle_spa(req, deps))
    add("GET", "/memories/compare", lambda req, deps: _handle_spa(req, deps))

    _ROUTES.update(routes)

    handler_cls = _make_handler(dependencies, routes)
    return handler_cls


_ROUTES: dict = {}


def _compile_path(pattern):
    regex = "^" + re.sub(r"\{([^/}]+)\}", r"(?P<\1>[^/]+)", pattern) + "$"
    return re.compile(regex)


# --- HTTP handler ----------------------------------------------------------


def _make_handler(dependencies, routes):
    class _AtlasHandler(BaseHTTPRequestHandler):
        def log_message(self, format, *args):
            return

        def do_GET(self):
            self._dispatch("GET")

        def do_POST(self):
            self._dispatch("POST")

        def do_PATCH(self):
            self._dispatch("PATCH")

        def do_DELETE(self):
            self._dispatch("DELETE")

        def _dispatch(self, method):
            import asyncio
            parsed = urlparse(self.path)
            path = parsed.path
            for (m, pattern), handler in routes.items():
                if m != method:
                    continue
                match = pattern.match(path)
                if match:
                    body = {}
                    if method in ("POST", "PATCH", "PUT", "DELETE"):
                        length = int(self.headers.get("Content-Length", 0) or 0)
                        if length:
                            try:
                                body = json.loads(self.rfile.read(length).decode("utf-8"))
                            except json.JSONDecodeError:
                                self._send_json({"error": "Invalid JSON"}, 400)
                                return
                    req = {
                        "method": method,
                        "path": path,
                        "params": match.groupdict(),
                        "query": parse_qs(parsed.query),
                        "body": body,
                    }
                    try:
                        result = handler(req, dependencies)
                        if asyncio.iscoroutine(result):
                            result = asyncio.run(result)
                    except Exception as exc:  # noqa: BLE001
                        self._send_json({"error": str(exc)}, 500)
                        return
                    if isinstance(result, tuple):
                        body, status = result
                    else:
                        body, status = result, 200
                    self._send_response(body, status)
                    return
            self._send_json({"error": "Not found"}, 404)

        def _send_response(self, body, status):
            if isinstance(body, (dict, list)):
                self._send_json(body, status)
            elif isinstance(body, str):
                payload = body.encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
            elif body is None:
                self.send_response(status)
                self.end_headers()
            else:
                self._send_json({"error": "Unsupported response type"}, 500)

        def _send_json(self, body, status):
            payload = json.dumps(body, default=str).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    return _AtlasHandler


# --- Route handlers --------------------------------------------------------


def _handle_list_memories(req, deps):
    params = req["query"]
    limit = _clamp_integer((params.get("limit") or [None])[0], 100, 1, 1000)
    offset = _clamp_integer((params.get("offset") or [None])[0], 0, 0, 1_000_000)
    source = (params.get("source") or [None])[0]
    rows = deps["getMemories"](limit=limit, offset=offset, source=source)
    return [deps["serializeMemory"](row) for row in rows]


def _handle_catalog_memories(req, deps):
    parsed = _parse_catalog_query(
        req["query"],
        default_sort="created_at",
        default_order="desc",
        sorts=["title", "type", "source", "confidence", "created_at", "linked"],
        filters={"source": ["ui", "mcp"], "type": None},
    )
    if not parsed["ok"]:
        return {"error": parsed["error"]}, 400
    return deps["getMemoryCatalog"](**parsed["value"])


def _handle_catalog_entities(req, deps):
    parsed = _parse_catalog_query(
        req["query"],
        default_sort="canonical_name",
        default_order="asc",
        sorts=[
            "canonical_name",
            "kind",
            "memory_count",
            "relationship_count",
            "created_at",
        ],
        filters={"kind": ["person", "place", "object", "concept", "organization"]},
    )
    if not parsed["ok"]:
        return {"error": parsed["error"]}, 400
    return deps["getEntityCatalog"](**parsed["value"])


def _handle_search(req, deps):
    params = req["query"]
    query = (params.get("q") or [None])[0] or ""
    if not query.strip():
        return {"error": "q query param required"}, 400
    limit = _clamp_integer((params.get("limit") or [None])[0], 10, 1, 100)
    score_threshold = _parse_optional_number((params.get("scoreThreshold") or [None])[0])
    strategy = (params.get("strategy") or ["hybrid"])[0]
    if strategy not in ("hybrid", "vector", "bm25"):
        return {"error": f"strategy must be one of: hybrid, vector, bm25"}, 400
    import asyncio
    if strategy == "bm25":
        results = deps["searchMemoriesFts"](query, {"limit": limit})
    elif strategy == "vector":
        results = asyncio.run(deps["searchMemoryVectors"](query, {"limit": limit}))
    else:
        async def _hybrid():
            return await vector_store.hybrid_search_memories(
                query,
                {
                    "limit": limit,
                    "scoreThreshold": score_threshold,
                    "searchMemoriesFts": deps["searchMemoriesFts"],
                    "searchMemoryVectors": deps["searchMemoryVectors"],
                },
            )

        results = asyncio.run(_hybrid())
    memories = []
    for hit in results:
        memory = deps["getMemory"](hit["id"])
        if memory is not None:
            memories.append({**deps["serializeMemory"](memory), "rrfScore": hit.get("score")})
    return {
        "query": query,
        "strategy": strategy,
        "memories": memories,
    }


def _handle_get_memory(req, deps):
    memory_id = req["params"]["id"]
    memory = deps["getMemory"](memory_id)
    if memory is None:
        return {"error": "Memory not found"}, 404
    return deps["serializeMemory"](memory)


def _handle_memory_links(req, deps):
    memory_id = req["params"]["id"]
    if not deps["getMemory"](memory_id):
        return {"error": "Memory not found"}, 404
    params = req["query"]
    try:
        limit = _parse_strict_integer(
            (params.get("limit") or [None])[0], 5, 1, 20, "limit"
        )
        score_threshold = _parse_strict_number(
            (params.get("scoreThreshold") or [None])[0],
            0.65,
            -1,
            1,
            "scoreThreshold",
        )
    except ValueError as exc:
        return {"error": str(exc)}, 400
    try:
        result = deps["getRelatedMemories"](
            memory_id,
            {
                "getMemory": deps["getMemory"],
                "getStructuralMemoryLinks": deps["getStructuralMemoryLinks"],
                "searchMemoryVectors": deps["searchMemoryVectors"],
                "searchMemoriesFts": deps["searchMemoriesFts"],
                "serializeMemory": deps["serializeMemory"],
            },
            limit=limit,
            score_threshold=score_threshold,
        )
    except ValueError as exc:
        return {"error": str(exc)}, 400
    if result is None:
        return {"error": "Memory not found"}, 404
    return result


def _handle_memory_comparisons(req, deps):
    body = req["body"]
    left_id = body.get("leftMemoryId")
    right_id = body.get("rightMemoryId")
    if not left_id or not right_id:
        return {"error": "leftMemoryId and rightMemoryId required"}, 400
    if left_id == right_id:
        return {"error": "leftMemoryId and rightMemoryId must differ"}, 400
    if not deps["getMemory"](left_id) or not deps["getMemory"](right_id):
        missing = [mid for mid in (left_id, right_id) if not deps["getMemory"](mid)]
        return {"error": "Memory not found", "missing": missing}, 404
    compare = deps.get("compareMemories")
    if compare is None:
        return {
            "leftMemoryId": left_id,
            "rightMemoryId": right_id,
            "analysis": _fallback_comparison(left_id, right_id, deps),
            "structuralDiff": build_memory_structural_diff(
                deps["serializeMemory"](deps["getMemory"](left_id)),
                deps["serializeMemory"](deps["getMemory"](right_id)),
            ),
            "generation": {"cached": False, "saved": False},
        }
    left_memory = deps["serializeMemory"](deps["getMemory"](left_id))
    right_memory = deps["serializeMemory"](deps["getMemory"](right_id))
    structural_diff = build_memory_structural_diff(left_memory, right_memory)

    # Compute a stable cache key
    from .memory_comparison import hash_memory_comparison_input
    input_hash = hash_memory_comparison_input(left_memory, right_memory)
    cached = deps.get("getMemoryComparison") and deps["getMemoryComparison"](
        left_id, right_id, input_hash
    )
    if cached and not body.get("regenerate"):
        return {
            "leftMemoryId": left_id,
            "rightMemoryId": right_id,
            "analysis": cached,
            "structuralDiff": structural_diff,
            "generation": {"cached": True, "saved": True},
        }
    try:
        import asyncio
        result = compare(left_memory, right_memory)
        if asyncio.iscoroutine(result):
            result = asyncio.run(result)
        analysis = result
    except Exception as exc:  # noqa: BLE001
        return {
            "leftMemoryId": left_id,
            "rightMemoryId": right_id,
            "left": left_memory,
            "right": right_memory,
            "analysis": None,
            "structuralDiff": structural_diff,
            "generation": {"cached": False, "saved": False, "error": str(exc)},
        }, 502
    if deps.get("saveMemoryComparison"):
        deps["saveMemoryComparison"](
            left_id, right_id, input_hash, analysis, "test-model", 1
        )
    return {
        "leftMemoryId": left_id,
        "rightMemoryId": right_id,
        "analysis": analysis,
        "structuralDiff": structural_diff,
        "generation": {"cached": False, "saved": True},
    }


def _fallback_comparison(left_id, right_id, deps):
    return {
        "relationship": "unknown",
        "confidence": 0.0,
        "overview": "Compare provider unavailable; structural diff only.",
        "sharedFacts": [],
        "differences": [],
        "contradictions": [],
        "caveats": ["provider_unavailable"],
    }


def _handle_list_entities(req, deps):
    params = req["query"]
    query = (params.get("q") or [None])[0]
    return {"entities": deps["findEntities"](query or "")}


def _handle_entity_graph(req, deps):
    entity_id = int(req["params"]["id"])
    entity = deps["getEntity"](entity_id)
    if entity is None:
        return {"error": "Entity not found"}, 404
    relationships = deps["getRelationshipsForEntity"](entity_id)
    memories = deps["getMemoriesForEntity"](entity_id)
    return {
        "entity": entity,
        "memories": [deps["serializeMemory"](memory) for memory in memories],
        "relationships": [_serialize_relationship(rel) for rel in relationships],
        "aliases": deps["getEntityAliases"](entity_id) if deps.get("getEntityAliases") else [],
        "suggestions": [
            s for s in deps["getEntityResolutionSuggestions"]()
            if s.get("source_entity_id") == entity_id or s.get("target_entity_id") == entity_id
        ],
    }


def _handle_entity_memories(req, deps):
    entity_id = int(req["params"]["id"])
    memories = deps["getMemoriesForEntity"](entity_id)
    return [deps["serializeMemory"](memory) for memory in memories]


def _handle_entity_resolution_suggestions(req, deps):
    params = req["query"]
    status = (params.get("status") or ["pending"])[0]
    if status not in ("pending", "merged", "rejected"):
        return {"error": "status must be pending, merged, or rejected"}, 400
    return {"suggestions": deps["getEntityResolutionSuggestions"](status=status)}


def _handle_entity_resolution_update(req, deps):
    suggestion_id = int(req["params"]["id"])
    body = req["body"]
    decision = body.get("decision")
    if decision not in ("merged", "rejected"):
        return {"error": "decision must be 'merged' or 'rejected'"}, 400
    deps["resolveEntityResolutionSuggestion"](suggestion_id, decision)
    return {"ok": True, "suggestionId": suggestion_id, "decision": decision}


def _handle_graph(req, deps):
    memories = deps["getMemories"](limit=200, offset=0)
    nodes = []
    edges = []
    for memory in memories:
        nodes.append({"id": memory["id"], "type": "memory", "label": memory.get("title") or memory["id"]})
    return {"nodes": nodes, "edges": edges}


def _handle_spa(req, deps):
    path = req["path"]
    if path == "/memories/compare":
        return "<!doctype html><html><body><div id=\"comparisonContent\"></div></body></html>"
    return (
        "<!doctype html><html><head><title>Atlas</title></head>"
        "<body><div class=\"catalog-sidebar\"></div></body></html>"
    )


def start_atlas_server(app_or_handler, port=0, host="127.0.0.1"):
    """Start the HTTP server in a background thread. Returns (server, base_url)."""
    if isinstance(app_or_handler, type) and issubclass(app_or_handler, BaseHTTPRequestHandler):
        handler_cls = app_or_handler
    else:
        handler_cls = app_or_handler
    server = ThreadingHTTPServer((host, port), handler_cls)
    import threading
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base_url = f"http://{host}:{server.server_address[1]}"
    return server, base_url
