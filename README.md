<div align="center">

# Atlas

**Semantic memory layer with a 3D atlas and MCP integration.**

SQLite is the source of truth. Vectors are embedded locally. Memories are typed, deduplicated, and mapped to brain regions.

</div>

---

## Quick start

```bash
npm install
cp .env.example .env
# Add TOKENROUTER_API_KEY or OPENROUTER_API_KEY
npm start              # Express on http://localhost:3000
```

Node.js 18+. The default `ATLAS_MODE=local` runs everything on-machine: SQLite for memory, LanceDB for vectors, Transformers.js for embeddings.

### Frontend (Atlas UI)

```bash
npm run dev            # backend on :3000
npm run dev:web        # Vite on :5173, proxies /api to :3000
```

Run both for the 3D brain visualization. Reserve `npm run build:web` for production builds.

### Optional auth

Set `AUTH_ENABLED=true` and provide `SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY`. All `/api` routes verify the access token. Off by default.

### Persistent paths

```dotenv
ATLAS_MODE=local
ENGRAM_DB_PATH=/var/data/neurogram/engram.db
LANCEDB_PATH=/var/data/neurogram/lancedb
LANCEDB_TABLE=atlas_memories
```

---

## MCP server

Stdiod MCP server exposing the memory store to any compatible client (Claude Desktop, Cursor, etc.).

```bash
npx atlas-mcp          # no clone required
npm run mcp            # from this repo
```

### Tools

| Tool | Description |
|------|-------------|
| `add_memory` | Write a typed memory; deduplicates against semantic candidates |
| `list_memories` | Recent memories |
| `get_memory` | One memory with entities, links, region activations |
| `search_memories` | Semantic search across text and summaries |
| `get_related_memories` | Connections from shared entities + similarity |
| `find_entities` | People, places, concepts |
| `get_entity_memories` | Memories linked to an entity |
| `update_memory_summary` | Rewrite the summary |
| `delete_memory` | Remove permanently |

`add_memory` requires an LLM API key. Read-only tools do not. The server logs to **stderr**; stdout is reserved for the protocol.

### Client config

```json
{
  "mcpServers": {
    "neurogram": {
      "command": "node",
      "args": ["/absolute/path/to/neurogram/src/mcp-server.js"],
      "env": {
        "ATLAS_MODE": "local",
        "ENGRAM_DB_PATH": "/absolute/path/to/neurogram-data/engram.db",
        "LANCEDB_PATH": "/absolute/path/to/neurogram-data/lancedb",
        "LLM_PROVIDER": "tokenrouter",
        "TOKENROUTER_API_KEY": "your-key-here"
      }
    }
  }
}
```

### CLI

```bash
npm run cli            # atlas <command>
npm link               # exposes `neurogram` and `atlas-mcp` in your shell
```

Commands: `add`, `list`, `get`, `search`, `related`, `entities`, `entity`, `update`, `delete`.

---

## Write pipeline

`add_memory` runs four steps:

1. **Extract** — LLM pulls entities, relationships, summary, region weights, emotional tone.
2. **Embed** — local sentence-transformer model produces the vector, offline.
3. **Compare** — score up to 5 semantic candidates. High-confidence matches update the existing memory; equivalent input is returned unchanged; distinct input creates a new node.
4. **Persist** — SQLite gets the canonical record, LanceDB gets the vector.

The response includes `action`, `memory`, `matchedMemoryId`, `confidence`, and `reason`.

Entity linking is conservative: ambiguous matches stay separate. Related-memory links are derived at read time, not stored as manual edges.

---

## Atlas (3D brain)

Every memory leaves a footprint across 11 regions: hippocampus, prefrontal, associationCortex, temporalCortex, basalGanglia, cerebellum, motorCortex, amygdala, insula, entorhinal, parietalCortex. Region mapping is deterministic and lives in `src/shared/region-mapper.js`.

Hippocampal activations include a bilateral footprint: `hemispheres.left` + `hemispheres.right` equals the parent region's `weight`. Other regions omit `hemispheres`.

---

## Environment

| Variable | Required | Description |
|----------|:--------:|-------------|
| `ATLAS_MODE` | No | `local` (default). `cloud` reserved. |
| `LLM_PROVIDER` | No | `tokenrouter` (default) or `openrouter` |
| `LLM_MODEL` | No | Override provider default |
| `TOKENROUTER_API_KEY` | ★ | Required if using TokenRouter |
| `OPENROUTER_API_KEY` | ★ | Required if using OpenRouter |
| `ENGRAM_DB_PATH` | No | SQLite path (default `./engram.db`) |
| `LANCEDB_PATH` | No | Vector index dir (default `./lancedb`) |
| `LANCEDB_TABLE` | No | Vector table (default `atlas_memories`) |
| `SUPABASE_URL` | No | Auth provider URL |
| `SUPABASE_PUBLISHABLE_KEY` | No | Auth provider publishable key |
| `EMBEDDING_MODEL` | No | Transformers.js model override |
| `EMBEDDING_DIMENSIONS` | No | Vector size (default `384`) |
| `EMBEDDING_DTYPE` | No | ONNX dtype (default `q8`) |

★ Required only for the selected provider.

Legacy `QDRANT_*` vars remain for direct-Qdrant setups. Not required in local mode.

---

## Architecture

```
src/
  server.js              Express HTTP API
  mcp-server.js          MCP stdio server
  db.js                  SQLite schema + queries + migrations
  llm.js                 Extraction, comparison, write decisions
  schemas.js             Zod schemas for extraction/memory/comparison
  vector-store.js        LanceDB (default) + Qdrant (legacy) + Transformers.js embeddings
  ingestion-service.js   Unified ingestion (HTTP + MCP)
  cognitive-worker.js    Background annotation worker
  shared/                region-mapper, brain-regions

web/src/
  App.tsx                Routes: Landing, Atlas, Catalog, Compare, Graph
  viz/brain/             Three.js 3D brain (~3600 lines, legacy)
  viz/graph/             Force graph hook
  pages/                 Route components (TypeScript)
  components/            Shared UI
  lib/                   API client, types, motion utils
  theme/                 CSS design tokens
```

ESM throughout. No TypeScript in `src/` — only `web/src/`.

---

## Testing

```bash
npm test
```

Runs `node --test tests/*.test.js`. Built-in test runner; tests import directly from `src/`.

---

## Gotchas

- `engram.db` is local and not portable across machines without also syncing the vector index.
- Run `npm run qdrant:sync` once when switching vector stores or after bulk SQLite imports.
- `add_memory` requires an LLM API key. Read-only tools work without one.
- Memory IDs: legacy `mem_*` short IDs and new UUIDv4 both exist.

---

## License

MIT.

The optimized brain atlas is derived from the Human Reference Atlas v1.3
3D Male Allen Brain by the HuBMAP Consortium, licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Source and modification
details are recorded in `public/assets/brain-atlas.LICENSE.txt`.
