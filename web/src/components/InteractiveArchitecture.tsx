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
    title: "Embedding (384-d vector)",
    lines: [
      "Sentence-transformer encodes the full memory text.",
      "384 dimensions capture semantic meaning densely.",
      "Written to Qdrant for similarity search.",
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
  qdrant: {
    title: "Qdrant — atlas_memories",
    lines: [
      "Vector store holding 384-d embeddings.",
      "Retrieval uses cosine distance (ANN search).",
      "Fast approximate nearest-neighbour at scale.",
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
        role="img"
        aria-label="Interactive architecture diagram — click any node for details"
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
          ONE WRITE · TWO STORES
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
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") handleNodeClick("nl")(e as any);
          }}
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
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") handleNodeClick("schema")(e as any);
          }}
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
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") handleNodeClick("cortical")(e as any);
          }}
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
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") handleNodeClick("embedding")(e as any);
          }}
        >
          <rect x="588" y="30" width="150" height="48" rx="4" />
          <text x="663" y="58" textAnchor="middle" className={styles.nodeTitle}>
            Embedding
          </text>
        </g>

        {/* ── branching pipes: capture → stores ── */}
        <line x1="663" y1="78" x2="663" y2="108" className={styles.pipe} />
        <line x1="663" y1="108" x2="310" y2="108" className={styles.pipe} />
        <line x1="663" y1="108" x2="820" y2="108" className={styles.pipe} />
        <line x1="310" y1="108" x2="310" y2="130" className={styles.pipe} />
        <polygon points="305,126 310,136 315,126" className={styles.pipeHead} />
        <line x1="820" y1="108" x2="820" y2="130" className={styles.pipe} />
        <polygon points="815,126 820,136 825,126" className={styles.pipeHead} />

        {/* ── stores ── */}
        <g
          className={`${styles.storeNode} ${active === "sqlite" ? styles.nodeActive : ""}`}
          onClick={handleNodeClick("sqlite")}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") handleNodeClick("sqlite")(e as any);
          }}
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
          className={`${styles.storeNode} ${active === "qdrant" ? styles.nodeActive : ""}`}
          onClick={handleNodeClick("qdrant")}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") handleNodeClick("qdrant")(e as any);
          }}
        >
          <rect x="555" y="168" width="310" height="80" rx="4" />
          <text x="575" y="192" className={styles.storeName}>
            Qdrant
          </text>
          <text x="675" y="192" className={styles.storeCode}>
            atlas_memories
          </text>
          <text x="575" y="214" className={styles.storeRole}>
            Semantic index
          </text>
          <text x="575" y="234" className={styles.storeDetail}>
            BM25 Vector Search
          </text>
        </g>

        {/* ── merge pipes: stores → recall ── */}
        <line x1="310" y1="248" x2="310" y2="278" className={styles.pipe} />
        <line x1="820" y1="248" x2="820" y2="278" className={styles.pipe} />
        <line x1="260" y1="278" x2="820" y2="278" className={styles.pipe} />
        <line x1="260" y1="278" x2="260" y2="300" className={styles.pipe} />
        <polygon points="255,296 260,306 265,296" className={styles.pipeHead} />
        <line x1="540" y1="278" x2="540" y2="300" className={styles.pipe} />
        <polygon points="535,296 540,306 545,296" className={styles.pipeHead} />
        <line x1="820" y1="278" x2="820" y2="300" className={styles.pipe} />
        <polygon points="815,296 820,306 825,296" className={styles.pipeHead} />

        {/* ── recall paths ── */}
        <g
          className={`${styles.recallNode} ${active === "semantic" ? styles.nodeActive : ""}`}
          onClick={handleNodeClick("semantic")}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") handleNodeClick("semantic")(e as any);
          }}
        >
          <rect x="80" y="340" width="360" height="90" rx="4" />
          <text x="100" y="364" className={styles.recallName}>
            Semantic recall
          </text>
          <text x="100" y="386" className={styles.recallDesc}>
            Embed the query, take the cosine-nearest
          </text>
          <text x="100" y="402" className={styles.recallDesc}>
            vectors from Qdrant.
          </text>
          <text x="100" y="420" className={styles.recallTag}>
            GET /api/memories/search
          </text>
        </g>

        <g
          className={`${styles.recallNode} ${active === "structural" ? styles.nodeActive : ""}`}
          onClick={handleNodeClick("structural")}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") handleNodeClick("structural")(e as any);
          }}
        >
          <rect x="460" y="340" width="160" height="90" rx="4" />
          <text x="480" y="364" className={styles.recallName}>
            Structural
          </text>
          <text x="480" y="380" className={styles.recallName}>
            links
          </text>
          <text x="480" y="402" className={styles.recallDesc}>
            Memories sharing
          </text>
          <text x="480" y="418" className={styles.recallDesc}>
            entities or triples
          </text>
        </g>

        <g
          className={`${styles.recallNode} ${active === "catalog" ? styles.nodeActive : ""}`}
          onClick={handleNodeClick("catalog")}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") handleNodeClick("catalog")(e as any);
          }}
        >
          <rect x="640" y="340" width="230" height="90" rx="4" />
          <text x="660" y="364" className={styles.recallName}>
            Entity &amp; catalog
          </text>
          <text x="660" y="386" className={styles.recallDesc}>
            Full-text search across names,
          </text>
          <text x="660" y="402" className={styles.recallDesc}>
            aliases, summaries and raw text.
          </text>
          <text x="660" y="420" className={styles.recallTag}>
            GET /api/catalog
          </text>
        </g>

        {/* ── converge pipes to MCP client ── */}
        <line x1="260" y1="430" x2="260" y2="460" className={styles.pipe} />
        <line x1="540" y1="430" x2="540" y2="460" className={styles.pipe} />
        <line x1="820" y1="430" x2="820" y2="460" className={styles.pipe} />
        <line x1="260" y1="460" x2="820" y2="460" className={styles.pipe} />
        <line x1="540" y1="460" x2="540" y2="480" className={styles.pipe} />
        <polygon points="535,476 540,486 545,476" className={styles.pipeHead} />

        {/* ── MCP client ── */}
        <g
          className={`${styles.userNode} ${active === "mcp" ? styles.nodeActive : ""}`}
          onClick={handleNodeClick("mcp")}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") handleNodeClick("mcp")(e as any);
          }}
        >
          <rect x="440" y="488" width="200" height="30" rx="4" />
          <text x="540" y="508" textAnchor="middle" className={styles.userLabel}>
            You / MCP Client
          </text>
        </g>

        {/* ── detail panel overlay ── */}
        {detail && (
          <foreignObject x="200" y="180" width="560" height="160" className={styles.detailForeign}>
            <div
              className={styles.detailPanel}
              onClick={(e) => e.stopPropagation()}
            >
              <span className={styles.detailClose}>esc</span>
              <p className={styles.detailTitle}>{detail.title}</p>
              {detail.lines[0] && <p className={styles.detailLine}>{detail.lines[0]}</p>}
              {detail.lines[1] && <p className={styles.detailLine}>{detail.lines[1]}</p>}
              {detail.lines[2] && <p className={styles.detailLineDim}>{detail.lines[2]}</p>}
            </div>
          </foreignObject>
        )}
      </svg>
    </div>
  );
}
