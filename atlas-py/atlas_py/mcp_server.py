"""MCP server factory for the Atlas Python port.

Port of ``src/mcp-server.js`` covering the tool surface exercised by the
Python test suite. The Python port exposes a ``create_atlas_mcp_server``
function that takes a dependencies dict and returns a server object with
``list_tools()`` and ``call_tool(name, arguments)`` methods so the tests
can drive the tools directly without a live MCP transport.
"""

from __future__ import annotations

import inspect
from typing import Any, Callable


def _tool_result(data: Any) -> dict:
    return {
        "content": [{"type": "text", "text": _safe_json(data)}],
        "structuredContent": data,
    }


def _safe_json(data: Any) -> str:
    import json
    return json.dumps(data, indent=2, default=str)


def _tool_error(message: str) -> dict:
    return {
        "content": [{"type": "text", "text": message}],
        "isError": True,
    }


def _default_dependencies() -> dict:
    from . import db
    from . import llm_config
    from . import related_memories
    from . import vector_store

    async def _decide_memory_write(*args, **kwargs):
        from . import llm as llm_module
        return await llm_module.decide_memory_write(*args, **kwargs)

    async def _extract_atomic_memories(*args, **kwargs):
        from . import llm as llm_module
        return await llm_module.extract_atomic_memories(*args, **kwargs)

    async def _get_model():
        return llm_config.model

    dependencies = {
        "deleteMemory": db.delete_memory,
        "deleteMemoryVector": vector_store.delete_memory_vector,
        "decideMemoryWrite": _decide_memory_write,
        "extractAtomicMemories": _extract_atomic_memories,
        "findEntities": db.find_entities,
        "getEntitiesForMemory": db.get_entities_for_memory,
        "getLatestExtraction": db.get_latest_extraction,
        "getMemories": db.get_memories,
        "getMemoriesForEntity": db.get_memories_for_entity,
        "getMemory": db.get_memory,
        "getRegionActivations": db.get_region_activations,
        "getRelationshipsForMemory": db.get_relationships_for_memory,
        "getStructuralMemoryLinks": db.get_structural_memory_links,
        "indexMemoryVector": vector_store.index_memory_vector,
        "searchMemoryVectors": vector_store.search_memory_vectors,
        "storeMemory": db.store_memory,
        "updateMemoryGraph": db.update_memory_graph,
        "updateMemorySummary": db.update_memory_summary,
        "searchMemoriesFts": db.search_memories_fts,
        "getModel": _get_model,
    }

    def _serialize_memory(memory):
        if not memory:
            return None
        mem_id = memory.get("id")
        return dependencies["getMemoryDetails"](mem_id)

    dependencies["serializeMemory"] = _serialize_memory

    def _get_related_memories(memory_id, options=None):
        return related_memories.get_related_memories(
            memory_id,
            {
                "getMemory": dependencies["getMemory"],
                "getStructuralMemoryLinks": dependencies["getStructuralMemoryLinks"],
                "searchMemoryVectors": dependencies["searchMemoryVectors"],
                "searchMemoriesFts": dependencies["searchMemoriesFts"],
                "serializeMemory": _serialize_memory,
            },
            options or {},
        )

    dependencies["getRelatedMemories"] = _get_related_memories

    def _get_memory_details(memory_id):
        memory = dependencies["getMemory"](memory_id)
        if not memory:
            return None
        return {
            **memory,
            "extraction": dependencies["getLatestExtraction"](memory_id),
            "entities": dependencies["getEntitiesForMemory"](memory_id),
            "relationships": dependencies["getRelationshipsForMemory"](memory_id),
            "regions": dependencies["getRegionActivations"](memory_id),
        }

    dependencies["getMemoryDetails"] = _get_memory_details
    return dependencies


def create_atlas_mcp_server(overrides: dict | None = None) -> "AtlasMcpServer":
    dependencies = {**_default_dependencies(), **(overrides or {})}
    server = AtlasMcpServer(dependencies)
    server._register_default_tools()
    return server


class AtlasMcpServer:
    def __init__(self, dependencies: dict):
        self._dependencies = dependencies
        self._tools: dict[str, dict] = {}

    # --- Tool registration -------------------------------------------------

    def register_tool(
        self,
        name: str,
        *,
        title: str = "",
        description: str = "",
        input_schema: dict | None = None,
        output_schema: dict | None = None,
        annotations: dict | None = None,
        handler: Callable,
    ) -> None:
        self._tools[name] = {
            "name": name,
            "title": title or name,
            "description": description,
            "inputSchema": input_schema or {"type": "object", "properties": {}},
            "outputSchema": output_schema or {"type": "object"},
            "annotations": annotations or {},
            "handler": handler,
        }

    def list_tools(self) -> dict:
        return {"tools": list(self._tools.values())}

    async def call_tool(self, name: str, arguments: dict | None = None) -> dict:
        tool = self._tools.get(name)
        if tool is None:
            return _tool_error(f"Unknown tool: {name}")
        handler = tool["handler"]
        try:
            result = handler(arguments or {})
            if inspect.iscoroutine(result):
                result = await result
            return result
        except Exception as error:
            return _tool_error(f"Tool execution failed: {error}")

    # --- Default tool surface ---------------------------------------------

    def _register_default_tools(self) -> None:
        deps = self._dependencies

        def get_memory_details(memory_id):
            memory = deps["getMemory"](memory_id)
            if not memory:
                return None
            return {
                **memory,
                "extraction": deps["getLatestExtraction"](memory_id),
                "entities": deps["getEntitiesForMemory"](memory_id),
                "relationships": deps["getRelationshipsForMemory"](memory_id),
                "regions": deps["getRegionActivations"](memory_id),
            }

        self.register_tool(
            "get_memory",
            title="Get memory",
            description="Fetch one Atlas memory by ID.",
            input_schema={
                "type": "object",
                "required": ["id"],
                "properties": {
                    "id": {"type": "string", "minLength": 1},
                },
            },
            annotations={"readOnlyHint": True, "openWorldHint": False},
            handler=lambda args: self._get_memory_handler(args, get_memory_details),
        )

        self.register_tool(
            "get_related_memories",
            title="Get related memories",
            description="Find memories connected to a given memory.",
            input_schema={
                "type": "object",
                "required": ["id"],
                "properties": {
                    "id": {"type": "string", "minLength": 1},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 20, "default": 5},
                    "scoreThreshold": {"type": "number", "minimum": -1, "maximum": 1, "default": 0.65},
                },
            },
            annotations={"readOnlyHint": True, "openWorldHint": True},
            handler=lambda args: self._get_related_memories_handler(args, deps),
        )

    def _get_memory_handler(self, args, get_memory_details):
        memory_id = args.get("id")
        memory = get_memory_details(memory_id)
        if not memory:
            return _tool_error(f"Memory not found: {memory_id}")
        return _tool_result(memory)

    async def _get_related_memories_handler(self, args, deps):
        memory_id = args.get("id")
        limit = args.get("limit", 5)
        score_threshold = args.get("scoreThreshold", 0.65)
        try:
            result = await _maybe_await(
                deps["getRelatedMemories"](
                    memory_id, {"limit": limit, "scoreThreshold": score_threshold}
                )
            )
            return _tool_result(result) if result else _tool_error(
                f"Memory not found: {memory_id}"
            )
        except Exception as error:
            return _tool_error(f"Could not get related memories: {error}")


async def _maybe_await(value):
    if inspect.iscoroutine(value):
        return await value
    return value
