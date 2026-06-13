# Neurogram MCP

Neurogram includes a local MCP server over stdio. It exposes the existing
SQLite memory store and uses the same LLM extraction pipeline as the web app.

## Run

```bash
npm run mcp
```

The server writes protocol messages to stdout and diagnostics to stderr.
`search_memories` uses Qdrant Cloud; new memories are embedded locally with
`Xenova/all-MiniLM-L6-v2` and uploaded to the configured cloud collection.

## Client configuration

Add Neurogram to an MCP client using an absolute project path:

```json
{
  "mcpServers": {
    "neurogram": {
      "command": "node",
      "args": ["/Users/sidmanale/Development/Neurogram/mcp-server.js"],
      "env": {
        "ENGRAM_DB_PATH": "/Users/sidmanale/Development/Neurogram/engram.db",
        "QDRANT_URL": "https://your-cluster-id.region.cloud-provider.cloud.qdrant.io:6333",
        "QDRANT_API_KEY": "your-qdrant-database-api-key"
      }
    }
  }
}
```

`add_memory` also needs the LLM provider API key configured by `.env`.
Most read-only tools work directly against SQLite; `search_memories` requires
the Qdrant Cloud credentials.
The Qdrant key needs manage/write access so Neurogram can create and update its
collection. Run `npm run qdrant:sync` to upload existing SQLite memories.

## Tools

- `add_memory`
- `list_memories`
- `get_memory`
- `search_memories`
- `find_entities`
- `get_entity_memories`
- `update_memory_summary`
- `delete_memory`
