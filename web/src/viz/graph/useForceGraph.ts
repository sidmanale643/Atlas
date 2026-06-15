import { useEffect, useRef } from "react";
import * as d3 from "d3";
import type { GraphData, GraphEdge, GraphNode } from "../../lib/types";

/* ---------------------------------------------------------------------------
 * useForceGraph — D3 v7 force-directed network of memories + entities.
 *
 * Ported from the legacy public/js/graph.js, recoloured to the Neurogram
 * phosphor-green palette. Node CATEGORIES are encoded by SHAPE + green
 * brightness/opacity rather than the legacy rainbow per-type colours:
 *
 *   - memory  -> filled phosphor circle, brightness scaled by salience
 *                (bright --green-bright for salient, dim --green-mid otherwise)
 *   - entity  -> hollow / outlined hexagon in dimmer green (--green-dim stroke)
 *   - edges   -> low-alpha green lines (relationships solid, memory-entity dashed)
 *   - hover / selected -> bright green with glow
 * ------------------------------------------------------------------------- */

/* Phosphor palette (mirrors web/src/theme/theme.css tokens). */
const C = {
  bg: "#060807",
  green: "#4ef08f",
  greenBright: "#9bffc7",
  greenMid: "#2fbf74",
  greenDim: "#1f6e46",
  muted: "#5f8270",
  edgeRel: "rgba(78, 240, 143, 0.22)",
  edgeMem: "rgba(78, 240, 143, 0.12)",
} as const;

/* Memory/extraction subtype on a node, e.g. [{type, weight}]. */
interface NodeType {
  type: string;
  weight: number;
}

/* Working copy of a node enriched with D3 simulation positions. */
export interface SimNode extends GraphNode, d3.SimulationNodeDatum {
  text?: string;
  source?: string;
  salience?: number;
  types?: NodeType[];
  memoryCount?: number;
  entityId?: number;
  createdAt?: string;
}

/* Working copy of an edge; source/target become SimNode after forceLink runs. */
export interface SimEdge extends Omit<GraphEdge, "source" | "target"> {
  source: string | SimNode;
  target: string | SimNode;
  type?: string;
  label?: string;
  predicate?: string;
}

export interface ForceGraphFilters {
  /** lowercased search query against label/text/kind */
  search: string;
  /** set of active memory subtype keys (episodic, semantic, …) */
  activeMemoryTypes: Set<string>;
  /** set of active entity kinds (person, place, …) */
  activeEntityKinds: Set<string>;
}

export interface UseForceGraphOptions {
  svgRef: React.RefObject<SVGSVGElement>;
  /** wrapping element used for sizing + tooltip coordinate origin */
  wrapperRef: React.RefObject<HTMLElement>;
  data: GraphData | null;
  filters: ForceGraphFilters;
  onSelect: (node: SimNode | null) => void;
  onTooltip: (tip: { node: SimNode; x: number; y: number } | null) => void;
}

/* Pull the canonical edge list whether the API returns `edges` or `links`. */
export function getEdges(data: GraphData | null): GraphEdge[] {
  if (!data) return [];
  return data.edges ?? data.links ?? [];
}

function edgeId(end: string | SimNode): string {
  return typeof end === "object" ? end.id : end;
}

function getDominantType(types: NodeType[] | undefined): string {
  let dominant: NodeType | null = null;
  for (const item of types ?? []) {
    if (!dominant || item.weight > dominant.weight) dominant = item;
  }
  return dominant?.type ?? "semantic";
}

function nodeRadius(d: SimNode): number {
  if (d.type === "entity") return 12;
  return 6 + (d.salience ?? 0.5) * 10;
}

/* Memory brightness scales with salience; entities stay dim/outlined. */
function memoryFill(d: SimNode): string {
  const s = d.salience ?? 0.5;
  if (s >= 0.66) return C.greenBright;
  if (s >= 0.33) return C.green;
  return C.greenMid;
}

function hexPoints(r: number): string {
  const points: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    points.push(`${r * Math.cos(angle)},${r * Math.sin(angle)}`);
  }
  return points.join(" ");
}

function truncate(label: string | undefined, max: number): string {
  if (!label) return "";
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

function dragBehavior(
  simulation: d3.Simulation<SimNode, SimEdge>,
): d3.DragBehavior<SVGGElement, SimNode, SimNode | d3.SubjectPosition> {
  return d3
    .drag<SVGGElement, SimNode>()
    .on("start", (event) => {
      if (!event.active) simulation.alphaTarget(0.15).restart();
      event.subject.fx = event.subject.x;
      event.subject.fy = event.subject.y;
    })
    .on("drag", (event) => {
      event.subject.fx = event.x;
      event.subject.fy = event.y;
    })
    .on("end", (event) => {
      if (!event.active) simulation.alphaTarget(0);
      event.subject.fx = null;
      event.subject.fy = null;
    });
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type NodeSel = d3.Selection<SVGGElement, SimNode, SVGGElement, unknown>;
type EdgeSel = d3.Selection<SVGLineElement, SimEdge, SVGGElement, unknown>;
type LabelSel = d3.Selection<SVGTextElement, SimEdge, SVGGElement, unknown>;

export function useForceGraph({
  svgRef,
  wrapperRef,
  data,
  filters,
  onSelect,
  onTooltip,
}: UseForceGraphOptions): void {
  /* Mutable refs so filter changes don't tear down the whole simulation. */
  const simRef = useRef<d3.Simulation<SimNode, SimEdge> | null>(null);
  const nodeSelRef = useRef<NodeSel | null>(null);
  const edgeSelRef = useRef<EdgeSel | null>(null);
  const labelSelRef = useRef<LabelSel | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const edgesRef = useRef<SimEdge[]>([]);
  const selectedRef = useRef<string | null>(null);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  /* ----- shared helpers that read live state via refs ----- */
  const visibleIds = (): Set<string> => {
    const f = filtersRef.current;
    const ids = new Set<string>();
    for (const node of nodesRef.current) {
      if (
        node.type === "memory" &&
        !f.activeMemoryTypes.has(getDominantType(node.types))
      ) {
        continue;
      }
      if (node.type === "entity" && !f.activeEntityKinds.has(node.kind ?? "")) {
        continue;
      }
      if (f.search) {
        const label = (node.label ?? "").toLowerCase();
        if (label.includes(f.search)) {
          ids.add(node.id);
        } else if (
          node.type === "entity" &&
          (node.kind ?? "").toLowerCase().includes(f.search)
        ) {
          ids.add(node.id);
        } else if (
          node.type === "memory" &&
          (node.text ?? "").toLowerCase().includes(f.search)
        ) {
          ids.add(node.id);
        }
        continue;
      }
      ids.add(node.id);
    }
    return ids;
  };

  const applyFilters = (): void => {
    const nodeSel = nodeSelRef.current;
    const edgeSel = edgeSelRef.current;
    const labelSel = labelSelRef.current;
    if (!nodeSel || !edgeSel) return;
    const ids = visibleIds();
    nodeSel.classed("dimmed", (d) => !ids.has(d.id));
    edgeSel.classed(
      "dimmed",
      (d) => !ids.has(edgeId(d.source)) || !ids.has(edgeId(d.target)),
    );
    labelSel?.classed(
      "dimmed",
      (d) => !ids.has(edgeId(d.source)) || !ids.has(edgeId(d.target)),
    );
  };

  const highlight = (id: string): void => {
    const nodeSel = nodeSelRef.current;
    const edgeSel = edgeSelRef.current;
    const labelSel = labelSelRef.current;
    if (!nodeSel || !edgeSel) return;
    const connected = new Set<string>([id]);
    for (const e of edgesRef.current) {
      const s = edgeId(e.source);
      const t = edgeId(e.target);
      if (s === id) connected.add(t);
      if (t === id) connected.add(s);
    }
    nodeSel.classed("dimmed", (d) => !connected.has(d.id));
    nodeSel.classed("highlighted", (d) => d.id === id);
    edgeSel.classed(
      "active",
      (d) => edgeId(d.source) === id || edgeId(d.target) === id,
    );
    edgeSel.classed(
      "dimmed",
      (d) => edgeId(d.source) !== id && edgeId(d.target) !== id,
    );
    labelSel?.classed(
      "dimmed",
      (d) => edgeId(d.source) !== id && edgeId(d.target) !== id,
    );
  };

  const clearHighlight = (): void => {
    const nodeSel = nodeSelRef.current;
    const edgeSel = edgeSelRef.current;
    if (!nodeSel || !edgeSel) return;
    nodeSel.classed("dimmed", false).classed("highlighted", false);
    edgeSel.classed("dimmed", false).classed("active", false);
    applyFilters();
  };

  /* ---------------------------------------------------------------------
   * Effect 1: build the simulation. Re-runs only when DATA changes so the
   * graph isn't rebuilt on every keystroke / filter toggle.
   * ------------------------------------------------------------------- */
  useEffect(() => {
    const svgEl = svgRef.current;
    const wrapperEl = wrapperRef.current;
    if (!svgEl || !wrapperEl || !data || data.nodes.length === 0) return;

    const svg = d3.select(svgEl);
    svg.selectAll("*").remove();

    const sizeOf = (): { width: number; height: number } => {
      const b = wrapperEl.getBoundingClientRect();
      return {
        width: Math.max(b.width, 320),
        height: Math.max(b.height, 320),
      };
    };
    let { width, height } = sizeOf();
    svg.attr("viewBox", `0 0 ${width} ${height}`);

    /* arrowhead marker (phosphor green) */
    const defs = svg.append("defs");
    defs
      .append("marker")
      .attr("id", "ng-arrow")
      .attr("viewBox", "0 0 10 7")
      .attr("refX", 10)
      .attr("refY", 3.5)
      .attr("markerWidth", 7)
      .attr("markerHeight", 5)
      .attr("orient", "auto")
      .append("polygon")
      .attr("points", "0 0, 10 3.5, 0 7")
      .attr("fill", C.green)
      .attr("fill-opacity", 0.55);

    const root = svg.append("g").attr("class", "ng-root");

    /* zoom / pan */
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 5])
      .on("zoom", (event) => {
        root.attr("transform", event.transform.toString());
      });
    svg.call(zoom);

    /* working copies so the simulation can mutate x/y/fx/fy freely */
    const nodes: SimNode[] = data.nodes.map((d) => ({ ...d }) as SimNode);
    const edges: SimEdge[] = getEdges(data).map((d) => ({ ...d }) as SimEdge);
    nodesRef.current = nodes;
    edgesRef.current = edges;

    const simulation = d3
      .forceSimulation<SimNode, SimEdge>(nodes)
      .force(
        "link",
        d3
          .forceLink<SimNode, SimEdge>(edges)
          .id((d) => d.id)
          .distance(120)
          .strength(0.4),
      )
      .force("charge", d3.forceManyBody().strength(-260))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force(
        "collision",
        d3.forceCollide<SimNode>().radius((d) => nodeRadius(d) + 4),
      )
      .force("x", d3.forceX(width / 2).strength(0.04))
      .force("y", d3.forceY(height / 2).strength(0.04));
    simRef.current = simulation;

    const edgeGroup = root.append("g").attr("class", "ng-edges");
    const labelGroup = root.append("g").attr("class", "ng-edge-labels");
    const nodeGroup = root.append("g").attr("class", "ng-nodes");

    const edgeSel: EdgeSel = edgeGroup
      .selectAll<SVGLineElement, SimEdge>("line")
      .data(edges)
      .join("line")
      .attr("class", (d) =>
        `ng-edge ${d.type === "relationship" ? "rel" : "mem"}`,
      )
      .attr("stroke", (d) =>
        d.type === "relationship" ? C.edgeRel : C.edgeMem,
      )
      .attr("stroke-width", (d) => (d.type === "relationship" ? 1.4 : 1))
      .attr("stroke-dasharray", (d) =>
        d.type === "memory-entity" ? "4,3" : "none",
      )
      .attr("marker-end", (d) =>
        d.type === "relationship" ? "url(#ng-arrow)" : null,
      );
    edgeSelRef.current = edgeSel;

    /* relationship predicate labels (entity↔entity edges only) */
    const labelSel: LabelSel = labelGroup
      .selectAll<SVGTextElement, SimEdge>("text")
      .data(edges.filter((d) => d.type === "relationship"))
      .join("text")
      .attr("class", "ng-edge-label")
      .attr("text-anchor", "middle")
      .attr("dy", -3)
      .text((d) => truncate(d.label ?? d.predicate, 20));
    labelSelRef.current = labelSel;

    const nodeSel: NodeSel = nodeGroup
      .selectAll<SVGGElement, SimNode>("g")
      .data(nodes)
      .join("g")
      .attr("class", "ng-node")
      .call(dragBehavior(simulation));
    nodeSelRef.current = nodeSel;

    nodeSel.each(function (d) {
      const g = d3.select(this);
      if (d.type === "entity") {
        /* hollow / outlined hexagon, dimmer green */
        g.append("polygon")
          .attr("class", "ng-shape")
          .attr("points", hexPoints(nodeRadius(d)))
          .attr("fill", C.green)
          .attr("fill-opacity", 0.08)
          .attr("stroke", C.greenDim)
          .attr("stroke-width", 1.4)
          .attr("stroke-opacity", 0.9);
      } else {
        /* filled phosphor circle, brightness from salience */
        const fill = memoryFill(d);
        g.append("circle")
          .attr("class", "ng-shape")
          .attr("r", nodeRadius(d))
          .attr("fill", fill)
          .attr("fill-opacity", 0.28)
          .attr("stroke", fill)
          .attr("stroke-width", 1.2)
          .attr("stroke-opacity", 0.95);
      }

      g.append("text")
        .attr("class", "ng-node-label")
        .attr("dy", nodeRadius(d) + 13)
        .attr("text-anchor", "middle")
        .attr("paint-order", "stroke")
        .attr("stroke", C.bg)
        .attr("stroke-width", 3)
        .attr("stroke-linejoin", "round")
        .text(truncate(d.label, 22));
    });

    nodeSel
      .on("pointerenter", (event: PointerEvent, d) => {
        highlight(d.id);
        const b = wrapperEl.getBoundingClientRect();
        onTooltip({
          node: d,
          x: event.clientX - b.left,
          y: event.clientY - b.top,
        });
      })
      .on("pointermove", (event: PointerEvent, d) => {
        const b = wrapperEl.getBoundingClientRect();
        onTooltip({
          node: d,
          x: event.clientX - b.left,
          y: event.clientY - b.top,
        });
      })
      .on("pointerleave", () => {
        if (selectedRef.current) highlight(selectedRef.current);
        else clearHighlight();
        onTooltip(null);
      })
      .on("click", (event: PointerEvent, d) => {
        event.stopPropagation();
        if (selectedRef.current === d.id) {
          selectedRef.current = null;
          clearHighlight();
          onSelect(null);
        } else {
          selectedRef.current = d.id;
          highlight(d.id);
          onSelect(d);
        }
      });

    svg.on("click", () => {
      selectedRef.current = null;
      clearHighlight();
      onSelect(null);
    });

    simulation.on("tick", () => {
      edgeSel
        .attr("x1", (d) => (d.source as SimNode).x ?? 0)
        .attr("y1", (d) => (d.source as SimNode).y ?? 0)
        .attr("x2", (d) => {
          const s = d.source as SimNode;
          const t = d.target as SimNode;
          const dx = (t.x ?? 0) - (s.x ?? 0);
          const dy = (t.y ?? 0) - (s.y ?? 0);
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          return (t.x ?? 0) - (dx / dist) * nodeRadius(t);
        })
        .attr("y2", (d) => {
          const s = d.source as SimNode;
          const t = d.target as SimNode;
          const dx = (t.x ?? 0) - (s.x ?? 0);
          const dy = (t.y ?? 0) - (s.y ?? 0);
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          return (t.y ?? 0) - (dy / dist) * nodeRadius(t);
        });

      labelSel
        .attr(
          "x",
          (d) =>
            (((d.source as SimNode).x ?? 0) + ((d.target as SimNode).x ?? 0)) /
            2,
        )
        .attr(
          "y",
          (d) =>
            (((d.source as SimNode).y ?? 0) + ((d.target as SimNode).y ?? 0)) /
            2,
        );

      nodeSel.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    /* responsive: keep centering force in sync with the canvas size */
    const resizeObserver = new ResizeObserver(() => {
      const next = sizeOf();
      width = next.width;
      height = next.height;
      svg.attr("viewBox", `0 0 ${width} ${height}`);
      const center = simulation.force<d3.ForceCenter<SimNode>>("center");
      center?.x(width / 2).y(height / 2);
      simulation.force("x", d3.forceX(width / 2).strength(0.04));
      simulation.force("y", d3.forceY(height / 2).strength(0.04));
      simulation.alpha(0.2).restart();
    });
    resizeObserver.observe(wrapperEl);

    applyFilters();

    /* cleanup — stop simulation + detach all listeners so SPA revisits
     * don't leak timers, ResizeObservers or zoom handlers. */
    return () => {
      resizeObserver.disconnect();
      simulation.on("tick", null);
      simulation.stop();
      svg.on(".zoom", null);
      svg.on("click", null);
      svg.selectAll("*").remove();
      simRef.current = null;
      nodeSelRef.current = null;
      edgeSelRef.current = null;
      labelSelRef.current = null;
      nodesRef.current = [];
      edgesRef.current = [];
      selectedRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, svgRef, wrapperRef]);

  /* ---------------------------------------------------------------------
   * Effect 2: re-apply dimming whenever filters / search change.
   * ------------------------------------------------------------------- */
  useEffect(() => {
    if (selectedRef.current) highlight(selectedRef.current);
    else applyFilters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    filters.search,
    filters.activeMemoryTypes,
    filters.activeEntityKinds,
  ]);
}
