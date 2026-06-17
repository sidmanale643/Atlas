import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./InteractiveArchitecture.module.css";

/* ------------------------------------------------------------------ data */

interface NodeDetail {
  title: string;
  lines: [string, string, string];
}

const NODES: Record<string, NodeDetail> = {
  nl: {
    title: "Natural language input",
    lines: [
      "Raw text from a conversation or document.",
      "No schema required — extraction handles structure.",
      "",
    ],
  },
  schema: {
    title: "Schema-locked extraction",
    lines: [
      "Parses natural language into typed fields.",
      "Enforces the cortical map schema strictly.",
      "Produces structured entities, triples, and ROI tags.",
    ],
  },
  cortical: {
    title: "Cortical map (11 regions)",
    lines: [
      "Inspired by cortical organisation of long-term memory.",
      "11 ROIs: identity, location, time, emotion, goal…",
      "Each memory is tagged to one or more regions.",
    ],
  },
  embedding: {
    title: "Prepared atomic memory",
    lines: [
      "One validated memory, ready for durable persistence.",
      "Carries entities, relationships, metadata, and ROI tags.",
      "SQLite commits it before vector indexing begins.",
    ],
  },
  sqlite: {
    title: "SQLite — engram.db",
    lines: [
      "Source of truth. Stores the full graph: memories,",
      "entities, relationships, extractions, region tags.",
      "Queried for structural and catalog retrieval.",
    ],
  },
  lancedb: {
    title: "LanceDB — atlas_memories",
    lines: [
      "Local vector store holding 384-d embeddings.",
      "Retrieval uses exact cosine-distance search.",
      "Stored alongside Atlas on your machine.",
    ],
  },
  semantic: {
    title: "Semantic recall",
    lines: [
      "Embed the query, find cosine-nearest vectors.",
      "Returns memories that mean the same thing,",
      "even if phrased differently. /api/memories/search",
    ],
  },
  structural: {
    title: "Structural links",
    lines: [
      "Find memories sharing entities or RDF triples.",
      "Graph traversal over SQLite relationships.",
      "Catches exact co-references semantic recall misses.",
    ],
  },
  catalog: {
    title: "Entity & catalog",
    lines: [
      "Full-text search across names, aliases, summaries.",
      "Useful for proper nouns and exact entity lookup.",
      "/api/catalog returns ranked matches.",
    ],
  },
  mcp: {
    title: "You / MCP client",
    lines: [
      "The consuming agent or human-facing interface.",
      "Receives fused results from all three retrieval paths.",
      "Signal fusion: 1 − ∏(1 − signal_i)",
    ],
  },
};

/* ------------------------------------------------------------------ component */

export default function InteractiveArchitecture() {
  const [active, setActive] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const handleNodeClick = useCallback(
    (id: string) => (e: React.MouseEvent) => {
      e.stopPropagation();
      setActive((prev) => (prev === id ? null : id));
    },
    [],
  );

  const handleNodeKeyDown = useCallback(
    (id: string) => (e: React.KeyboardEvent<SVGGElement>) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      e.stopPropagation();
      setActive((prev) => (prev === id ? null : id));
    },
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActive(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const detail = active ? NODES[active] : null;

  return (
    <div className={styles.wrap}>
      <svg
        ref={svgRef}
        viewBox="0 0 960 520"
        className={styles.svg}
        role="group"
        aria-label="Interactive Atlas memory architecture diagram"
        aria-describedby="architecture-instructions"
        onClick={() => setActive(null)}
      >
        <title>Atlas memory architecture — interactive</title>

        {/* ── tier labels ── */}
        <text x="0" y="18" className={styles.tierLabel}>
          CAPTURE
        </text>
        <line
          x1="0" y1="24" x2="960" y2="24"
          stroke="var(--line-soft)" strokeWidth="0.5"
        />

        <text x="0" y="155" className={styles.tierLabel}>
          SOURCE OF TRUTH · DERIVED INDEX
        </text>
        <line
          x1="0" y1="161" x2="960" y2="161"
          stroke="var(--line-soft)" strokeWidth="0.5"
        />

        <text x="0" y="325" className={styles.tierLabel}>
          THREE WAYS BACK
        </text>
        <line
          x1="0" y1="331" x2="960" y2="331"
          stroke="var(--line-soft)" strokeWidth="0.5"
        />

        {/* ── capture pipeline ── */}
        <g
          className={`${styles.node} ${active === "nl" ? styles.nodeActive : ""}`}
          onClick={handleNodeClick("nl")}
          role="button"
          tabIndex={0}
          aria-pressed={active === "nl"}
          onKeyDown={handleNodeKeyDown("nl")}
        >
          <rect x="0" y="30" width="150" height="48" rx="4" />
          <text x="75" y="50" textAnchor="middle" className={styles.nodeTitle}>
            Natural
          </text>
          <text x="75" y="66" textAnchor="middle" className={styles.nodeTitle}>
            language
          </text>
        </g>

        <line x1="150" y1="54" x2="190" y2="54" className={styles.arrow} />
        <polygon points="186,49 196,54 186,59" className={styles.arrowHead} />

        <g
          className={`${styles.node} ${active === "schema" ? styles.nodeActive : ""}`}
          onClick={handleNodeClick("schema")}
          role="button"
          tabIndex={0}
          aria-pressed={active === "schema"}
          onKeyDown={handleNodeKeyDown("schema")}
        >
          <rect x="196" y="30" width="150" height="48" rx="4" />
          <text x="271" y="50" textAnchor="middle" className={styles.nodeTitle}>
            Schema-locked
          </text>
          <text x="271" y="66" textAnchor="middle" className={styles.nodeTitle}>
            extraction
          </text>
        </g>

        <line x1="346" y1="54" x2="386" y2="54" className={styles.arrow} />
        <polygon points="382,49 392,54 382,59" className={styles.arrowHead} />

        <g
          className={`${styles.node} ${active === "cortical" ? styles.nodeActive : ""}`}
          onClick={handleNodeClick("cortical")}
          role="button"
          tabIndex={0}
          aria-pressed={active === "cortical"}
          onKeyDown={handleNodeKeyDown("cortical")}
        >
          <rect x="392" y="30" width="150" height="48" rx="4" />
          <text x="467" y="50" textAnchor="middle" className={styles.nodeTitle}>
            Cortical map
          </text>
          <text x="467" y="66" textAnchor="middle" className={styles.nodeTitle}>
            11 ROIs
          </text>
        </g>

        <line x1="542" y1="54" x2="582" y2="54" className={styles.arrow} />
        <polygon points="578,49 588,54 578,59" className={styles.arrowHead} />

        <g
          className={`${styles.node} ${active === "embedding" ? styles.nodeActive : ""}`}
          onClick={handleNodeClick("embedding")}
          role="button"
          tabIndex={0}
          aria-pressed={active === "embedding"}
          onKeyDown={handleNodeKeyDown("embedding")}
        >
          <rect x="588" y="30" width="150" height="48" rx="4" />
          <text x="663" y="58" textAnchor="middle" className={styles.nodeTitle}>
            Atomic memory
          </text>
        </g>

        {/* ── prepared memory → durable source of truth ── */}
        <line x1="663" y1="78" x2="663" y2="108" className={styles.pipe} />
        <line x1="663" y1="108" x2="310" y2="108" className={styles.pipe} />
        <line x1="310" y1="108" x2="310" y2="130" className={styles.pipe} />
        <polygon points="305,126 310,136 315,126" className={styles.pipeHead} />

        {/* ── stores ── */}
        <g
          className={`${styles.storeNode} ${active === "sqlite" ? styles.nodeActive : ""}`}
          onClick={handleNodeClick("sqlite")}
          role="button"
          tabIndex={0}
          aria-pressed={active === "sqlite"}
          onKeyDown={handleNodeKeyDown("sqlite")}
        >
          <rect x="155" y="168" width="310" height="80" rx="4" />
          <text x="175" y="192" className={styles.storeName}>
            SQLite
          </text>
          <text x="275" y="192" className={styles.storeCode}>
            engram.db
          </text>
          <text x="175" y="214" className={styles.storeRole}>
            Source of truth · the graph
          </text>
          <text x="175" y="234" className={styles.storeDetail}>
            memories · entities · relationships
          </text>
        </g>

        <g
          className={`${styles.storeNode} ${active === "lancedb" ? styles.nodeActive : ""}`}
          onClick={handleNodeClick("lancedb")}
          role="button"
          tabIndex={0}
          aria-pressed={active === "lancedb"}
          onKeyDown={handleNodeKeyDown("lancedb")}
        >
          <rect x="555" y="168" width="310" height="80" rx="4" />
          <text x="575" y="192" className={styles.storeName}>
            LanceDB
          </text>
          <text x="675" y="192" className={styles.storeCode}>
            atlas_memories
          </text>
          <text x="575" y="214" className={styles.storeRole}>
            Semantic index
          </text>
          <text x="575" y="234" className={styles.storeDetail}>
            Cosine vector search
          </text>
        </g>

        {/* SQLite commits first; LanceDB is a rebuildable projection. */}
        <line x1="465" y1="208" x2="545" y2="208" className={styles.arrow} />
        <polygon points="541,203 551,208 541,213" className={styles.arrowHead} />
        <text x="508" y="194" textAnchor="middle" className={styles.indexLabel}>
          EMBED + INDEX
        </text>

        {/* ── each store feeds only the retrieval modes it owns ── */}
        <line x1="310" y1="248" x2="310" y2="278" className={styles.pipe} />
        <line x1="180" y1="278" x2="450" y2="278" className={styles.pipe} />
        <line x1="180" y1="278" x2="180" y2="300" className={styles.pipe} />
        <polygon points="175,296 180,306 185,296" className={styles.pipeHead} />
        <line x1="450" y1="278" x2="450" y2="300" className={styles.pipe} />
        <polygon points="445,296 450,306 455,296" className={styles.pipeHead} />

        <line x1="710" y1="248" x2="710" y2="278" className={styles.pipe} />
        <line x1="710" y1="278" x2="770" y2="278" className={styles.pipe} />
        <line x1="770" y1="278" x2="770" y2="300" className={styles.pipe} />
        <polygon points="765,296 770,306 775,296" className={styles.pipeHead} />

        {/* ── recall paths ── */}
        <g
          className={`${styles.recallNode} ${active === "structural" ? styles.nodeActive : ""}`}
          onClick={handleNodeClick("structural")}
          role="button"
          tabIndex={0}
          aria-pressed={active === "structural"}
          onKeyDown={handleNodeKeyDown("structural")}
        >
          <rect x="80" y="340" width="200" height="90" rx="4" />
          <text x="100" y="364" className={styles.recallName}>
            Structural links
          </text>
          <text x="100" y="386" className={styles.recallDesc}>
            Memories sharing
          </text>
          <text x="100" y="402" className={styles.recallDesc}>
            entities or triples
          </text>
        </g>

        <g
          className={`${styles.recallNode} ${active === "catalog" ? styles.nodeActive : ""}`}
          onClick={handleNodeClick("catalog")}
          role="button"
          tabIndex={0}
          aria-pressed={active === "catalog"}
          onKeyDown={handleNodeKeyDown("catalog")}
        >
          <rect x="300" y="340" width="300" height="90" rx="4" />
          <text x="320" y="364" className={styles.recallName}>
            Entity &amp; catalog
          </text>
          <text x="320" y="386" className={styles.recallDesc}>
            Full-text search across names,
          </text>
          <text x="320" y="402" className={styles.recallDesc}>
            aliases, summaries and raw text.
          </text>
          <text x="320" y="420" className={styles.recallTag}>
            GET /api/catalog
          </text>
        </g>

        <g
          className={`${styles.recallNode} ${active === "semantic" ? styles.nodeActive : ""}`}
          onClick={handleNodeClick("semantic")}
          role="button"
          tabIndex={0}
          aria-pressed={active === "semantic"}
          onKeyDown={handleNodeKeyDown("semantic")}
        >
          <rect x="620" y="340" width="300" height="90" rx="4" />
          <text x="640" y="364" className={styles.recallName}>
            Semantic recall
          </text>
          <text x="640" y="386" className={styles.recallDesc}>
            Embed the query; find the nearest
          </text>
          <text x="640" y="402" className={styles.recallDesc}>
            vectors in the local index.
          </text>
          <text x="640" y="420" className={styles.recallTag}>
            GET /api/memories/search
          </text>
        </g>

        {/* ── converge pipes to MCP client ── */}
        <line x1="180" y1="430" x2="180" y2="460" className={styles.pipe} />
        <line x1="450" y1="430" x2="450" y2="460" className={styles.pipe} />
        <line x1="770" y1="430" x2="770" y2="460" className={styles.pipe} />
        <line x1="180" y1="460" x2="770" y2="460" className={styles.pipe} />
        <line x1="540" y1="460" x2="540" y2="480" className={styles.pipe} />
        <polygon points="535,476 540,486 545,476" className={styles.pipeHead} />

        {/* ── MCP client ── */}
        <g
          className={`${styles.userNode} ${active === "mcp" ? styles.nodeActive : ""}`}
          onClick={handleNodeClick("mcp")}
          role="button"
          tabIndex={0}
          aria-pressed={active === "mcp"}
          onKeyDown={handleNodeKeyDown("mcp")}
        >
          <rect x="440" y="488" width="200" height="30" rx="4" />
          <text x="540" y="508" textAnchor="middle" className={styles.userLabel}>
            You / MCP Client
          </text>
        </g>

      </svg>

      <div
        id="architecture-instructions"
        className={styles.detailRegion}
        aria-live="polite"
      >
        {detail ? (
          <div className={styles.detailPanel}>
            <button
              type="button"
              className={styles.detailClose}
              onClick={() => setActive(null)}
              aria-label="Close architecture details"
            >
              Close <span aria-hidden="true">· esc</span>
            </button>
            <p className={styles.detailTitle}>{detail.title}</p>
            {detail.lines[0] && <p className={styles.detailLine}>{detail.lines[0]}</p>}
            {detail.lines[1] && <p className={styles.detailLine}>{detail.lines[1]}</p>}
            {detail.lines[2] && <p className={styles.detailLineDim}>{detail.lines[2]}</p>}
          </div>
        ) : (
          <p className={styles.detailHint}>Select any node to inspect its role in the system.</p>
        )}
      </div>
    </div>
  );
}
