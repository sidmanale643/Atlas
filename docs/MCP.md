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
      "args": ["/absolute/path/to/neurogram/src/mcp-server.js"],
      "env": {
        "ENGRAM_DB_PATH": "/absolute/path/to/neurogram/engram.db",
        "QDRANT_URL": "https://your-cluster-id.region.cloud-provider.cloud.qdrant.io:6333",
        "QDRANT_API_KEY": "your-qdrant-database-api-key"
      }
    }
  }
}
```

`add_memory` also needs the LLM provider API key configured by `.env`.
Most read-only tools work directly against SQLite; `search_memories` requires
the Qdrant Cloud credentials. `get_related_memories` combines structural links
from SQLite with semantic similarity when Qdrant is available, and degrades to
structural links when it is not.
The Qdrant key needs manage/write access so Neurogram can create and update its
collection. Run `npm run qdrant:sync` to upload existing SQLite memories.

## Tools

- `add_memory`
- `list_memories`
- `get_memory`
- `search_memories`
- `get_related_memories`
- `find_entities`
- `get_entity_memories`
- `update_memory_summary`
- `delete_memory`

### When to use which tool

- The user shares a durable preference, fact, decision, event, learning,
  relationship detail, instruction, observation, or error -> `add_memory`.
  Always search first with `search_memories` (or `list_memories`) to avoid
  duplicates; `add_memory` will itself deduplicate against similar memories.
- You need to recall context for a free-text question ("what does the user
  like?", "what did we decide about X?") -> `search_memories` first. It is the
  primary recall tool and uses Qdrant semantic search.
- The user mentions a person, place, or organization by name -> `find_entities`
  to resolve it, then `get_entity_memories` to fetch every memory linked to it.
- You want to browse chronologically or enumerate what's stored ->
  `list_memories` (paginated by `limit` / `offset`, newest first).
- You have a memory ID and need the full payload, or want memories connected
  to it through entities/relationships/similarity -> `get_memory` for the
  record, `get_related_memories` for the surrounding context.
- The auto-generated summary is wrong or stale but the underlying memory text
  is correct -> `update_memory_summary`.
- The user explicitly asks to forget or delete a memory -> `delete_memory`
  (irreversible). Prefer `add_memory` updates otherwise so the original ID and
  revision history are preserved.

### `get_related_memories` schema

Callers provide:

- `id`: the source memory ID
- `limit`: optional result count from `1` to `20`, default `5`
- `scoreThreshold`: optional semantic similarity threshold from `-1` to `1`,
  default `0.65`

The result matches `GET /api/memories/:id/links`: ranked links include the
related memory, combined score, human-readable reasons, shared entities, shared
relationships, and semantic similarity. `semanticAvailable` indicates whether
Qdrant contributed to the result.

Entity identity resolution is conservative. Unique canonical names and aliases
can resolve automatically within the same entity kind; ambiguous aliases remain
separate and produce reviewable merge suggestions. Related-memory links are
derived from those entity links, explicit relationship triples, and semantic
similarity rather than persisted as manual edges.

### `add_memory` schema

Callers provide:

- `text`: memory text, up to 180 characters
- `type`: one of `relationship`, `preference`, `fact`, `decision`, `learning`,
  `event`, `instruction`, `observation`, or `error`
- `title`: required title, up to 50 characters
- `confidence`: optional value from `0` to `1`, default `0.6`
- `tags`: optional array of strings, default `[]`

Neurogram extracts the incoming text, searches for up to five semantically
similar memories, and chooses one of three actions:

- `created`: store a distinct memory with a generated ID
- `updated`: revise an existing memory while preserving its ID and prior state
- `unchanged`: return an equivalent existing memory without writing

Updates require at least `0.85` decision confidence. Ambiguous matches, Qdrant
failures, and invalid decision responses conservatively create a new memory.
Separate events, observations, errors, and learnings remain separate memories.

The tool returns:

```json
{
  "action": "created",
  "memory": {},
  "matchedMemoryId": null,
  "confidence": 0.96,
  "reason": "This is a separate event."
}
```

For updates, Neurogram retains the original ID, creation time, scope, and
source; merges tags; rebuilds extraction-derived graph data; reindexes the
Qdrant point; and stores the complete prior state in internal revision history.
Existing memories need no migration or revision backfill.
