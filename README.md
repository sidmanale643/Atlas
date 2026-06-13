# Neurogram

A memory system that extracts, stores, and retrieves personal memories using an LLM-powered pipeline, SQLite, and semantic vector search.

## Quick start

```bash
npm install
cp .env.example .env
# Add your LLM key, Qdrant Cloud REST endpoint, and Database API key.
npm run qdrant:sync    # index memories already stored in SQLite
npm start              # web UI on http://localhost:3000
```

Neurogram embeds newly added memories locally with the Sentence Transformers
`all-MiniLM-L6-v2` model through Transformers.js. The resulting 384-dimensional
vectors are stored in Qdrant Cloud; SQLite remains the source of truth for
memory content and metadata.

Create a Qdrant Cloud cluster, then create a Database API key with manage/write
access. Put the cluster's HTTPS REST endpoint and key in `.env`:

```dotenv
QDRANT_URL=https://your-cluster-id.region.cloud-provider.cloud.qdrant.io:6333
QDRANT_API_KEY=your-qdrant-database-api-key
```

The `neurogram_memories` collection is created automatically. Run
`npm run qdrant:sync` once when switching an existing SQLite database to
Qdrant Cloud.

Semantic search is available over HTTP:

```bash
curl "http://localhost:3000/api/memories/search?q=trip+with+a+friend&limit=5"
```

## MCP server

Neurogram ships with a local MCP (Model Context Protocol) server that exposes
the memory store over stdio. Any MCP-compatible client (Claude Desktop, Cursor,
etc.) can call these tools to add, search, and manage memories.

### Available tools

| Tool | Description |
|------|-------------|
| `add_memory` | Extract and store a short personal memory via LLM |
| `list_memories` | List recently stored memories |
| `get_memory` | Get one memory with its entities, relationships, and region activations |
| `search_memories` | Semantic search across memory text and summaries |
| `find_entities` | Find people, places, concepts, etc. extracted from memories |
| `get_entity_memories` | List every memory linked to an entity |
| `update_memory_summary` | Replace the editable summary of a memory |
| `delete_memory` | Permanently delete a memory |

### Run directly

```bash
npm run mcp
```

The server reads from and writes to `engram.db` in the project root and logs
diagnostics to stderr.

### Add to an MCP client

Add the following to your client's MCP configuration (e.g. `claude_desktop_config.json`
or `.cursor/mcp.json`), replacing the path with your local project path:

```json
{
  "mcpServers": {
    "neurogram": {
      "command": "node",
      "args": ["/absolute/path/to/neurogram/mcp-server.js"],
      "env": {
        "ENGRAM_DB_PATH": "/absolute/path/to/neurogram/engram.db",
        "QDRANT_URL": "https://your-cluster-id.region.cloud-provider.cloud.qdrant.io:6333",
        "QDRANT_API_KEY": "your-qdrant-database-api-key"
      }
    }
  }
}
```

`add_memory` requires an LLM provider API key. Set it in `.env` or pass it
through the `env` block above (e.g. `TOKENROUTER_API_KEY` or
`OPENROUTER_API_KEY`). Most read-only tools work directly against SQLite;
`search_memories` additionally requires the Qdrant Cloud credentials.

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `LLM_PROVIDER` | No | `tokenrouter` (default) or `openrouter` |
| `LLM_MODEL` | No | Override the default model for the chosen provider |
| `TOKENROUTER_API_KEY` | Yes* | API key for TokenRouter |
| `OPENROUTER_API_KEY` | Yes* | API key for OpenRouter |
| `ENGRAM_DB_PATH` | No | Override the SQLite database path |
| `QDRANT_URL` | Yes | HTTPS REST endpoint from the Qdrant Cloud cluster |
| `QDRANT_API_KEY` | Yes | Qdrant Cloud Database API key with manage/write access |
| `QDRANT_COLLECTION` | No | Collection name; defaults to `neurogram_memories` |
| `QDRANT_TIMEOUT_MS` | No | Qdrant request timeout; defaults to `10000` |
| `EMBEDDING_MODEL` | No | Transformers.js sentence embedding model |
| `EMBEDDING_DIMENSIONS` | No | Model vector size; defaults to `384` |
| `EMBEDDING_DTYPE` | No | ONNX model dtype; defaults to `q8` |

*Required only for the provider you select.

## Testing

```bash
npm test
```
