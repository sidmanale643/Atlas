"""CLI dependency defaults. Mirrors src/cli/deps.js."""

from __future__ import annotations

from .. import db as _db
from .. import vector_store
from .. import related_memories


def _serialize_memory(memory):
    if not memory:
        return None
    return {
        **memory,
        "extraction": _db.get_latest_extraction(memory["id"]),
        "entities": _db.get_entities_for_memory(memory["id"]),
        "relationships": _db.get_relationships_for_memory(memory["id"]),
        "regions": _db.get_region_activations(memory["id"]),
    }


def _derive_related(id_, options):
    return related_memories.get_related_memories(
        id_,
        {
            "getMemory": _db.get_memory,
            "getStructuralMemoryLinks": _db.get_structural_memory_links,
            "searchMemoryVectors": vector_store.search_memory_vectors,
            "searchMemoriesFts": _db.search_memories_fts,
            "serializeMemory": _serialize_memory,
        },
        options or {},
    )


async def _extract_atomic_memories(*args, **kwargs):
    from .. import llm
    return await llm.extract_atomic_memories(*args, **kwargs)


async def _decide_memory_write(*args, **kwargs):
    from .. import llm
    return await llm.decide_memory_write(*args, **kwargs)


def _retrieve_extraction_context(*args, **kwargs):
    from .. import extraction_context
    return extraction_context.retrieve_extraction_context(*args, **kwargs)


def _create_ingestion_service(dependencies):
    from .. import ingestion_service
    return ingestion_service.create_ingestion_service(dependencies)


def default_dependencies():
    dependencies = {
        "closeDb": _db.close_db,
        "decideMemoryWrite": _decide_memory_write,
        "deleteMemory": _db.delete_memory,
        "deleteMemoryVector": vector_store.delete_memory_vector,
        "extractAtomicMemories": _extract_atomic_memories,
        "findEntities": _db.find_entities,
        "getEntitiesForMemory": _db.get_entities_for_memory,
        "getLatestExtraction": _db.get_latest_extraction,
        "getMemories": _db.get_memories,
        "getMemoriesForEntity": _db.get_memories_for_entity,
        "getMemory": _db.get_memory,
        "getRegionActivations": _db.get_region_activations,
        "getRelationshipsForMemory": _db.get_relationships_for_memory,
        "getStructuralMemoryLinks": _db.get_structural_memory_links,
        "hybridSearchMemories": vector_store.hybrid_search_memories,
        "indexMemoryVector": vector_store.index_memory_vector,
        "model": None,
        "retrieveExtractionContext": _retrieve_extraction_context,
        "searchMemoryVectors": vector_store.search_memory_vectors,
        "serializeMemory": _serialize_memory,
        "storeMemory": _db.store_memory,
        "updateMemoryGraph": _db.update_memory_graph,
        "updateMemorySummary": _db.update_memory_summary,
    }

    async def _get_model():
        from .. import llm_config
        dependencies["model"] = llm_config.model
        return llm_config.model

    dependencies["getModel"] = _get_model
    dependencies["getRelatedMemories"] = _derive_related
    dependencies["ingestionService"] = _create_ingestion_service(dependencies)
    return dependencies
