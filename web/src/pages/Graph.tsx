import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import type { GraphData } from "../lib/types";
import {
  getEdges,
  useForceGraph,
  type ForceGraphFilters,
  type SimNode,
} from "../viz/graph/useForceGraph";
import styles from "./Graph.module.css";

/* --------------------------------------------------------------- constants */

const MEMORY_TYPES: { key: string; label: string }[] = [
  { key: "episodic", label: "Episodic" },
  { key: "semantic", label: "Semantic" },
  { key: "procedural", label: "Procedural" },
  { key: "emotional", label: "Emotional" },
  { key: "spatial", label: "Spatial" },
  { key: "working", label: "Working" },
];

const ENTITY_KINDS: { key: string; label: string }[] = [
  { key: "person", label: "Person" },
  { key: "place", label: "Place" },
  { key: "object", label: "Object" },
  { key: "concept", label: "Concept" },
  { key: "organization", label: "Organization" },
];

const SEARCH_DEBOUNCE = 200;

/* ------------------------------------------------------------------ helpers */

interface NodeTypeWeight {
  type: string;
  weight: number;
}

function dominantType(types: NodeTypeWeight[] | undefined): string | null {
  let dominant: NodeTypeWeight | null = null;
  for (const item of types ?? []) {
    if (!dominant || item.weight > dominant.weight) dominant = item;
  }
  return dominant?.type ?? null;
}

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

/* ================================================================ component */

export default function GraphPage() {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const [data, setData] = useState<GraphData | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [errorMsg, setErrorMsg] = useState("");

  /* filter / search state */
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [activeMemoryTypes, setActiveMemoryTypes] = useState<Set<string>>(
    () => new Set(MEMORY_TYPES.map((t) => t.key)),
  );
  const [activeEntityKinds, setActiveEntityKinds] = useState<Set<string>>(
    () => new Set(ENTITY_KINDS.map((k) => k.key)),
  );

  /* interaction state */
  const [selected, setSelected] = useState<SimNode | null>(null);
  const [tooltip, setTooltip] = useState<{
    node: SimNode;
    x: number;
    y: number;
  } | null>(null);

  /* fetch on mount */
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    api
      .graph()
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setErrorMsg(err instanceof Error ? err.message : "Failed to load graph");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /* debounce search input -> committed search */
  useEffect(() => {
    const id = window.setTimeout(
      () => setSearch(searchInput.trim().toLowerCase()),
      SEARCH_DEBOUNCE,
    );
    return () => window.clearTimeout(id);
  }, [searchInput]);

  const filters: ForceGraphFilters = useMemo(
    () => ({ search, activeMemoryTypes, activeEntityKinds }),
    [search, activeMemoryTypes, activeEntityKinds],
  );

  useForceGraph({
    svgRef,
    wrapperRef,
    data: status === "ready" ? data : null,
    filters,
    onSelect: setSelected,
    onTooltip: setTooltip,
  });

  /* stats */
  const stats = useMemo(() => {
    if (!data) return { memories: 0, entities: 0, relationships: 0 };
    const memories = data.nodes.filter((n) => n.type === "memory").length;
    const entities = data.nodes.filter((n) => n.type === "entity").length;
    const relationships = getEdges(data).length;
    return { memories, entities, relationships };
  }, [data]);

  const toggle = (
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    key: string,
  ): void => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const isEmpty = status === "ready" && (!data || data.nodes.length === 0);

  return (
    <div className={styles.page}>
      {/* ----------------------------------------------------------- sidebar */}
      <aside className={styles.sidebar}>
        <div className={styles.section}>
          <h1 className={styles.title}>Memory Network</h1>
          <p className={styles.intro}>
            How memories and entities connect. Click a node to inspect, drag to
            rearrange, scroll to zoom.
          </p>
        </div>

        <div className={styles.section}>
          <input
            className={`nrg-field ${styles.search}`}
            type="search"
            autoComplete="off"
            placeholder="Filter nodes…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Search nodes"
          />
        </div>

        <div className={styles.section}>
          <span className={styles.heading}>Memory type</span>
          <div className={styles.chips}>
            {MEMORY_TYPES.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`${styles.chip} ${
                  activeMemoryTypes.has(t.key) ? styles.chipOn : ""
                }`}
                onClick={() => toggle(setActiveMemoryTypes, t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.section}>
          <span className={styles.heading}>Entity kind</span>
          <div className={styles.chips}>
            {ENTITY_KINDS.map((k) => (
              <button
                key={k.key}
                type="button"
                className={`${styles.chip} ${
                  activeEntityKinds.has(k.key) ? styles.chipOn : ""
                }`}
                onClick={() => toggle(setActiveEntityKinds, k.key)}
              >
                {k.label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.section}>
          <span className={styles.heading}>Legend</span>
          <ul className={styles.legend}>
            <li className={styles.legendItem}>
              <span className={`${styles.swatch} ${styles.swatchMem}`} />
              Memory — filled circle, brightness ∝ salience
            </li>
            <li className={styles.legendItem}>
              <span className={`${styles.swatch} ${styles.swatchEntity}`} />
              Entity — hollow hexagon
            </li>
            <li className={styles.legendItem}>
              <span className={`${styles.swatch} ${styles.swatchRel}`} />
              Relationship — solid edge, directed
            </li>
            <li className={styles.legendItem}>
              <span className={`${styles.swatch} ${styles.swatchLink}`} />
              Mention — dashed memory↔entity edge
            </li>
          </ul>
        </div>

        <div className={styles.section}>
          <span className={styles.heading}>Stats</span>
          <dl className={styles.stats}>
            <div className={styles.statRow}>
              <dt>Memories</dt>
              <dd>{stats.memories}</dd>
            </div>
            <div className={styles.statRow}>
              <dt>Entities</dt>
              <dd>{stats.entities}</dd>
            </div>
            <div className={styles.statRow}>
              <dt>Connections</dt>
              <dd>{stats.relationships}</dd>
            </div>
          </dl>
        </div>
      </aside>

      {/* ------------------------------------------------------------ canvas */}
      <section className={styles.canvasArea}>
        <div className={styles.canvasWrapper} ref={wrapperRef}>
          <svg ref={svgRef} className={styles.svg} />

          {tooltip ? (
            <div
              className={styles.tooltip}
              style={{
                transform: `translate(${tooltip.x + 14}px, ${
                  tooltip.y + 14
                }px)`,
              }}
              role="tooltip"
            >
              <NodeTooltip node={tooltip.node} />
            </div>
          ) : null}

          {status === "loading" ? (
            <div className={styles.overlay}>Loading network…</div>
          ) : null}
          {status === "error" ? (
            <div className={styles.overlay}>{errorMsg}</div>
          ) : null}
          {isEmpty ? (
            <div className={styles.overlay}>
              No memories recorded yet. Add a memory in the atlas to see the
              graph.
            </div>
          ) : null}
        </div>

        {selected ? (
          <DetailPanel
            node={selected}
            data={data}
            onClose={() => setSelected(null)}
          />
        ) : null}
      </section>
    </div>
  );
}

/* ----------------------------------------------------------------- tooltip */

function NodeTooltip({ node }: { node: SimNode }) {
  if (node.type === "memory") {
    const top = dominantType(node.types as NodeTypeWeight[] | undefined);
    return (
      <>
        <span className={styles.tipLabel}>Memory</span>
        <span className={styles.tipTitle}>{node.label}</span>
        <span className={styles.tipMeta}>
          {top ? capitalize(top) : "Unclassified"} · salience{" "}
          {(node.salience ?? 0).toFixed(2)}
        </span>
      </>
    );
  }
  return (
    <>
      <span className={styles.tipLabel}>
        Entity / {capitalize(node.kind ?? "")}
      </span>
      <span className={styles.tipTitle}>{node.label}</span>
      <span className={styles.tipMeta}>
        {node.memoryCount ?? 0} linked memories
      </span>
    </>
  );
}

/* ------------------------------------------------------------ detail panel */

function DetailPanel({
  node,
  data,
  onClose,
}: {
  node: SimNode;
  data: GraphData | null;
  onClose: () => void;
}) {
  const edges = getEdges(data);

  if (node.type === "memory") {
    const types = ((node.types as NodeTypeWeight[] | undefined) ?? [])
      .slice()
      .sort((a, b) => b.weight - a.weight)
      .map((t) => t.type);
    return (
      <div className={styles.detail} aria-live="polite">
        <div className={styles.detailHead}>
          <span className={styles.detailType}>Memory</span>
          <button type="button" className={styles.close} onClick={onClose}>
            Close
          </button>
        </div>
        <div className={styles.detailBody}>
          <DetailField label="Raw text">
            <p className={styles.detailText}>{node.text ?? node.label}</p>
          </DetailField>
          {types.length ? (
            <DetailField label="Types">
              <div className={styles.tagRow}>
                {types.map((t) => (
                  <span key={t} className={styles.tag}>
                    {capitalize(t)}
                  </span>
                ))}
              </div>
            </DetailField>
          ) : null}
          <DetailField label="Source">
            <p className={styles.detailText}>
              {node.source === "mcp" ? "Agent" : "User"}
            </p>
          </DetailField>
          <DetailField label="Salience">
            <p className={styles.detailText}>
              {(node.salience ?? 0).toFixed(2)}
            </p>
          </DetailField>
        </div>
      </div>
    );
  }

  /* entity */
  const linkedMemories = edges
    .filter((e) => {
      const s = typeof e.source === "object" ? (e.source as { id: string }).id : e.source;
      const t = typeof e.target === "object" ? (e.target as { id: string }).id : e.target;
      return (s === node.id || t === node.id) && e.type === "memory-entity";
    })
    .map((e) => {
      const s = typeof e.source === "object" ? (e.source as { id: string }).id : e.source;
      const memId = s === node.id
        ? typeof e.target === "object" ? (e.target as { id: string }).id : e.target
        : s;
      return data?.nodes.find((n) => n.id === memId);
    })
    .filter((n): n is NonNullable<typeof n> => Boolean(n));

  const relationships = edges.filter((e) => {
    const s = typeof e.source === "object" ? (e.source as { id: string }).id : e.source;
    const t = typeof e.target === "object" ? (e.target as { id: string }).id : e.target;
    return (s === node.id || t === node.id) && e.type === "relationship";
  });

  return (
    <div className={styles.detail} aria-live="polite">
      <div className={styles.detailHead}>
        <span className={styles.detailType}>
          Entity / {capitalize(node.kind ?? "")}
        </span>
        <button type="button" className={styles.close} onClick={onClose}>
          Close
        </button>
      </div>
      <div className={styles.detailBody}>
        <DetailField label={`Linked memories (${linkedMemories.length})`}>
          {linkedMemories.length ? (
            <div className={styles.tagRow}>
              {linkedMemories.map((m) => (
                <span key={m.id} className={styles.tag}>
                  {m.label.length > 30 ? `${m.label.slice(0, 29)}…` : m.label}
                </span>
              ))}
            </div>
          ) : (
            <p className={styles.detailMuted}>None</p>
          )}
        </DetailField>
        {relationships.length ? (
          <DetailField label="Relationships">
            <div className={styles.relList}>
              {relationships.map((r, i) => (
                <p key={i} className={styles.detailText}>
                  {r.label ?? r.predicate}
                </p>
              ))}
            </div>
          </DetailField>
        ) : null}
      </div>
    </div>
  );
}

function DetailField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.detailField}>
      <span className={styles.detailLabel}>{label}</span>
      {children}
    </div>
  );
}
