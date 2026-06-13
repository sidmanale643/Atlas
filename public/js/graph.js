const MEMORY_TYPE_COLORS = {
  episodic: "#9ae6f5",
  semantic: "#b9a7ff",
  procedural: "#ffd38a",
  emotional: "#ff8fa8",
  spatial: "#7ee8d3",
  working: "#9ce4ba",
};

const MEMORY_TYPE_LABELS = {
  episodic: "Episodic",
  semantic: "Semantic",
  procedural: "Procedural",
  emotional: "Emotional",
  spatial: "Spatial",
  working: "Working",
};

const ENTITY_KIND_COLORS = {
  person: "#9bbcff",
  place: "#7ee8d3",
  object: "#ffd38a",
  concept: "#e99fd1",
  organization: "#ffad8a",
};

const ENTITY_KIND_LABELS = {
  person: "Person",
  place: "Place",
  object: "Object",
  concept: "Concept",
  organization: "Organization",
};

const SEARCH_DEBOUNCE_MS = 200;

const elements = {
  svg: document.querySelector("#graphSvg"),
  wrapper: document.querySelector("#graphCanvasWrapper"),
  tooltip: document.querySelector("#graphTooltip"),
  empty: document.querySelector("#graphEmpty"),
  detail: document.querySelector("#graphDetail"),
  detailType: document.querySelector("#detailType"),
  detailContent: document.querySelector("#detailContent"),
  closeDetail: document.querySelector("#closeDetail"),
  stats: document.querySelector("#graphStats"),
  search: document.querySelector("#graphSearch"),
  memoryTypeFilters: document.querySelector("#memoryTypeFilters"),
  entityKindFilters: document.querySelector("#entityKindFilters"),
  legendContent: document.querySelector("#legendContent"),
};

let graphData = { nodes: [], edges: [] };
let simulation = null;
let svgGroup = null;
let zoom = null;
let selectedNodeId = null;
let searchQuery = "";
let activeMemoryTypes = new Set(Object.keys(MEMORY_TYPE_COLORS));
let activeEntityKinds = new Set(Object.keys(ENTITY_KIND_COLORS));
let searchTimer = null;

initialize();

async function initialize() {
  renderLegend();
  renderFilterChips();
  bindEvents();
  await loadGraph();
}

function bindEvents() {
  elements.closeDetail.addEventListener("click", closeDetail);

  let resizeTimer = null;
  const ro = new ResizeObserver(() => {
    if (graphData && graphData.nodes.length > 0 && elements.svg.childNodes.length === 0) {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => renderGraph(), 100);
    }
  });
  ro.observe(elements.wrapper);

  elements.search.addEventListener("input", () => {
    searchQuery = elements.search.value.trim().toLowerCase();
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(applyFilters, SEARCH_DEBOUNCE_MS);
  });
}

async function loadGraph() {
  try {
    const response = await fetch("/api/graph");
    if (!response.ok) throw new Error("Failed to load graph");
    graphData = await response.json();
    elements.empty.hidden = graphData.nodes.length > 0;
    renderStats();
    if (graphData.nodes.length === 0) return;
    if (typeof d3 === "undefined") {
      console.error("D3.js not loaded");
      elements.empty.hidden = false;
      elements.empty.querySelector("p").textContent = "D3.js failed to load. Check your network connection.";
      return;
    }
    requestAnimationFrame(() => renderGraph());
  } catch (error) {
    console.error("Graph load failed:", error);
    elements.empty.hidden = false;
    elements.empty.querySelector("p").textContent = "Failed to load graph data.";
  }
}

function renderStats() {
  const memoryCount = graphData.nodes.filter((n) => n.type === "memory").length;
  const entityCount = graphData.nodes.filter((n) => n.type === "entity").length;
  const edgeCount = graphData.edges.length;

  elements.stats.innerHTML = `
    <span class="stat"><strong>${memoryCount}</strong> memories</span>
    <span class="stat"><strong>${entityCount}</strong> entities</span>
    <span class="stat"><strong>${edgeCount}</strong> connections</span>
  `;
}

function renderLegend() {
  const items = [];

  items.push({ label: "Memory", shape: "circle", color: "#9ae6f5" });
  for (const [type, color] of Object.entries(MEMORY_TYPE_COLORS)) {
    items.push({ label: `  ${MEMORY_TYPE_LABELS[type]}`, shape: "circle", color });
  }

  items.push({ label: "Entity", shape: "hex", color: "#9bbcff" });
  for (const [kind, color] of Object.entries(ENTITY_KIND_COLORS)) {
    items.push({ label: `  ${ENTITY_KIND_LABELS[kind]}`, shape: "hex", color });
  }

  elements.legendContent.innerHTML = items
    .map(
      (item) => `
      <div class="legend-item">
        <span class="legend-swatch ${item.shape}" style="background:${item.color}"></span>
        <span>${item.label}</span>
      </div>
    `,
    )
    .join("");
}

function renderFilterChips() {
  elements.memoryTypeFilters.innerHTML = Object.entries(MEMORY_TYPE_LABELS)
    .map(
      ([type, label]) => `
      <button class="filter-chip active" data-type="${type}" type="button">
        <span class="chip-swatch" style="background:${MEMORY_TYPE_COLORS[type]}"></span>${label}
      </button>
    `,
    )
    .join("");

  elements.entityKindFilters.innerHTML = Object.entries(ENTITY_KIND_LABELS)
    .map(
      ([kind, label]) => `
      <button class="filter-chip active" data-kind="${kind}" type="button">
        <span class="chip-swatch" style="background:${ENTITY_KIND_COLORS[kind]}"></span>${label}
      </button>
    `,
    )
    .join("");

  elements.memoryTypeFilters.addEventListener("click", (event) => {
    const chip = event.target.closest(".filter-chip");
    if (!chip) return;
    const type = chip.dataset.type;
    if (activeMemoryTypes.has(type)) {
      activeMemoryTypes.delete(type);
    } else {
      activeMemoryTypes.add(type);
    }
    chip.classList.toggle("active", activeMemoryTypes.has(type));
    applyFilters();
  });

  elements.entityKindFilters.addEventListener("click", (event) => {
    const chip = event.target.closest(".filter-chip");
    if (!chip) return;
    const kind = chip.dataset.kind;
    if (activeEntityKinds.has(kind)) {
      activeEntityKinds.delete(kind);
    } else {
      activeEntityKinds.add(kind);
    }
    chip.classList.toggle("active", activeEntityKinds.has(kind));
    applyFilters();
  });
}

function applyFilters() {
  if (!svgGroup) return;

  const visibleIds = getVisibleNodeIds();

  svgGroup.selectAll(".graph-node").classed("dimmed", (d) => !visibleIds.has(d.id));
  svgGroup.selectAll(".graph-edge").classed("dimmed", (d) => {
    const sourceId = typeof d.source === "object" ? d.source.id : d.source;
    const targetId = typeof d.target === "object" ? d.target.id : d.target;
    return !visibleIds.has(sourceId) || !visibleIds.has(targetId);
  });
}

function getVisibleNodeIds() {
  const ids = new Set();
  for (const node of graphData.nodes) {
    if (node.type === "memory" && !activeMemoryTypes.has(getDominantType(node.types))) {
      continue;
    }
    if (node.type === "entity" && !activeEntityKinds.has(node.kind)) {
      continue;
    }
    if (searchQuery && !node.label.toLowerCase().includes(searchQuery)) {
      if (node.type === "entity" && node.kind.toLowerCase().includes(searchQuery)) {
        ids.add(node.id);
      } else if (node.type === "memory" && node.text?.toLowerCase().includes(searchQuery)) {
        ids.add(node.id);
      }
      continue;
    }
    ids.add(node.id);
  }
  return ids;
}

function getDominantType(types) {
  let dominant = null;
  for (const item of types || []) {
    if (!dominant || item.weight > dominant.weight) dominant = item;
  }
  return dominant?.type || "semantic";
}

let renderRetries = 0;
const MAX_RENDER_RETRIES = 5;

function renderGraph() {
  const bounds = elements.wrapper.getBoundingClientRect();
  let width = bounds.width;
  let height = bounds.height;

  if (width < 10 || height < 10) {
    elements.wrapper.style.minHeight = "500px";
    if (renderRetries < MAX_RENDER_RETRIES) {
      renderRetries++;
      requestAnimationFrame(() => renderGraph());
    }
    return;
  }
  renderRetries = 0;

  elements.svg.innerHTML = "";
  elements.svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
  marker.setAttribute("id", "arrowhead");
  marker.setAttribute("viewBox", "0 0 10 7");
  marker.setAttribute("refX", 10);
  marker.setAttribute("refY", 3.5);
  marker.setAttribute("markerWidth", 8);
  marker.setAttribute("markerHeight", 6);
  marker.setAttribute("orient", "auto");
  const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
  polygon.setAttribute("points", "0 0, 10 3.5, 0 7");
  polygon.setAttribute("class", "graph-arrow");
  marker.appendChild(polygon);
  defs.appendChild(marker);
  elements.svg.appendChild(defs);

  svgGroup = d3.select(elements.svg).append("g");

  zoom = d3.zoom()
    .scaleExtent([0.2, 5])
    .on("zoom", (event) => {
      svgGroup.attr("transform", event.transform);
    });
  d3.select(elements.svg).call(zoom);

  const nodes = graphData.nodes.map((d) => ({ ...d }));
  const edges = graphData.edges.map((d) => ({ ...d }));

  simulation = d3.forceSimulation(nodes)
    .force(
      "link",
      d3.forceLink(edges)
        .id((d) => d.id)
        .distance(120)
        .strength(0.4),
    )
    .force("charge", d3.forceManyBody().strength(-260))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collision", d3.forceCollide().radius(nodeRadius))
    .force("x", d3.forceX(width / 2).strength(0.04))
    .force("y", d3.forceY(height / 2).strength(0.04));

  const edgeGroup = svgGroup.append("g").attr("class", "graph-edges");
  const nodeGroup = svgGroup.append("g").attr("class", "graph-nodes");

  const edgeElements = edgeGroup
    .selectAll(".graph-edge")
    .data(edges)
    .join("line")
    .attr("class", (d) => `graph-edge ${d.type === "relationship" ? "relationship" : "memory-entity"}`)
    .attr("stroke", (d) => (d.type === "relationship" ? "rgba(155, 167, 165, 0.35)" : "rgba(154, 230, 245, 0.18)"))
    .attr("stroke-width", (d) => (d.type === "relationship" ? 1.5 : 1))
    .attr("stroke-dasharray", (d) => (d.type === "memory-entity" ? "4,3" : "none"));

  const nodeElements = nodeGroup
    .selectAll(".graph-node")
    .data(nodes)
    .join("g")
    .attr("class", "graph-node")
    .call(drag(simulation));

  nodeElements.each(function (d) {
    const g = d3.select(this);
    const color = getNodeColor(d);

    if (d.type === "entity") {
      g.append("polygon")
        .attr("points", hexPoints(0, 0, nodeRadius(d)))
        .attr("fill", color)
        .attr("stroke", color)
        .attr("fill-opacity", 0.35)
        .attr("stroke-opacity", 0.9);
    } else {
      g.append("circle")
        .attr("r", nodeRadius(d))
        .attr("fill", color)
        .attr("stroke", color)
        .attr("fill-opacity", 0.4)
        .attr("stroke-opacity", 0.95);
    }

    g.append("text")
      .attr("dy", (d.type === "entity" ? nodeRadius(d) + 14 : nodeRadius(d) + 12))
      .attr("paint-order", "stroke")
      .attr("stroke", "rgba(17, 22, 23, 0.85)")
      .attr("stroke-width", 3)
      .text(truncateLabel(d.label, 22));
  });

  nodeElements
    .on("pointerenter", (event, d) => {
      highlightConnections(d.id, nodes, edges, nodeElements, edgeElements);
      showTooltip(event, d);
    })
    .on("pointermove", (event) => {
      positionTooltip(event);
    })
    .on("pointerleave", () => {
      if (!selectedNodeId) {
        clearHighlight(nodeElements, edgeElements);
      } else {
        highlightConnections(selectedNodeId, nodes, edges, nodeElements, edgeElements);
      }
      hideTooltip();
    })
    .on("click", (event, d) => {
      event.stopPropagation();
      selectNode(d, nodeElements, edgeElements);
    });

  d3.select(elements.svg).on("click", () => {
    clearSelection(nodeElements, edgeElements);
  });

  simulation.on("tick", () => {
    edgeElements
      .attr("x1", (d) => d.source.x)
      .attr("y1", (d) => d.source.y)
      .attr("x2", (d) => {
        const dx = d.target.x - d.source.x;
        const dy = d.target.y - d.source.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const targetR = nodeRadius(d.target);
        return d.target.x - (dx / dist) * targetR;
      })
      .attr("y2", (d) => {
        const dx = d.target.x - d.source.x;
        const dy = d.target.y - d.source.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const targetR = nodeRadius(d.target);
        return d.target.y - (dy / dist) * targetR;
      });

    nodeElements.attr("transform", (d) => `translate(${d.x},${d.y})`);
  });

  applyFilters();
}

function nodeRadius(d) {
  if (d.type === "entity") return 12;
  return 6 + (d.salience || 0.5) * 10;
}

function getNodeColor(d) {
  if (d.type === "entity") return ENTITY_KIND_COLORS[d.kind] || "#9ba7a5";
  const dominant = getDominantType(d.types);
  return MEMORY_TYPE_COLORS[dominant] || "#9ae6f5";
}

function hexPoints(cx, cy, r) {
  const points = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    points.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
  }
  return points.join(" ");
}

function truncateLabel(label, maxLen) {
  if (!label) return "";
  return label.length > maxLen ? `${label.slice(0, maxLen - 1)}...` : label;
}

function highlightConnections(id, nodes, edges, nodeElements, edgeElements) {
  const connectedIds = new Set([id]);
  edges.forEach((e) => {
    const sourceId = typeof e.source === "object" ? e.source.id : e.source;
    const targetId = typeof e.target === "object" ? e.target.id : e.target;
    if (sourceId === id) connectedIds.add(targetId);
    if (targetId === id) connectedIds.add(sourceId);
  });

  nodeElements.classed("dimmed", (d) => !connectedIds.has(d.id));
  nodeElements.classed("highlighted", (d) => d.id === id);
  edgeElements.classed("dimmed", (d) => {
    const sourceId = typeof d.source === "object" ? d.source.id : d.source;
    const targetId = typeof d.target === "object" ? d.target.id : d.target;
    return sourceId !== id && targetId !== id;
  });
}

function clearHighlight(nodeElements, edgeElements) {
  nodeElements.classed("dimmed", false).classed("highlighted", false);
  edgeElements.classed("dimmed", false);
  applyFilters();
}

function selectNode(d, nodeElements, edgeElements) {
  if (selectedNodeId === d.id) {
    clearSelection(nodeElements, edgeElements);
    return;
  }
  selectedNodeId = d.id;
  highlightConnections(d.id, [], [], nodeElements, edgeElements);
  showDetail(d);
}

function clearSelection(nodeElements, edgeElements) {
  selectedNodeId = null;
  clearHighlight(nodeElements, edgeElements);
  closeDetail();
}

function showDetail(d) {
  elements.detail.hidden = false;
  elements.detailType.textContent = d.type === "memory" ? "MEMORY" : `ENTITY / ${d.kind?.toUpperCase()}`;

  if (d.type === "memory") {
    const types = (d.types || [])
      .sort((a, b) => b.weight - a.weight)
      .map((t) => t.type);
    const primaryType = types[0] || "unknown";

    elements.detailContent.innerHTML = `
      <div class="detail-section">
        <span class="detail-label">RAW TEXT</span>
        <p class="detail-text">${escapeHtml(d.text || d.label)}</p>
      </div>
      ${types.length ? `
        <div class="detail-section">
          <span class="detail-label">TYPES</span>
          <div>${types.map((t) => `<span class="detail-tag" style="border-color:${MEMORY_TYPE_COLORS[t]};color:${MEMORY_TYPE_COLORS[t]}">${MEMORY_TYPE_LABELS[t] || t}</span>`).join("")}</div>
        </div>
      ` : ""}
      <div class="detail-section">
        <span class="detail-label">SOURCE</span>
        <p class="detail-text">${d.source === "mcp" ? "Agent" : "User"}</p>
      </div>
      <div class="detail-section">
        <span class="detail-label">SALIENCE</span>
        <p class="detail-text">${(d.salience || 0).toFixed(2)}</p>
      </div>
    `;
  } else {
    const connectedMemories = graphData.edges
      .filter((e) => {
        const sourceId = typeof e.source === "object" ? e.source.id : e.source;
        const targetId = typeof e.target === "object" ? e.target.id : e.target;
        return (sourceId === d.id || targetId === d.id) && e.type === "memory-entity";
      })
      .map((e) => {
        const sourceId = typeof e.source === "object" ? e.source.id : e.source;
        const memoryId = sourceId === d.id
          ? (typeof e.target === "object" ? e.target.id : e.target)
          : (typeof e.source === "object" ? e.source.id : e.source);
        return graphData.nodes.find((n) => n.id === memoryId);
      })
      .filter(Boolean);

    const relationships = graphData.edges.filter((e) => {
      const sourceId = typeof e.source === "object" ? e.source.id : e.source;
      const targetId = typeof e.target === "object" ? e.target.id : e.target;
      return (sourceId === d.id || targetId === d.id) && e.type === "relationship";
    });

    elements.detailContent.innerHTML = `
      <div class="detail-section">
        <span class="detail-label">KIND</span>
        <p class="detail-text"><span class="detail-tag ${d.kind}" style="border-color:${ENTITY_KIND_COLORS[d.kind]};color:${ENTITY_KIND_COLORS[d.kind]}">${ENTITY_KIND_LABELS[d.kind] || d.kind}</span></p>
      </div>
      <div class="detail-section">
        <span class="detail-label">LINKED MEMORIES (${connectedMemories.length})</span>
        <div>${connectedMemories.map((m) => `<span class="detail-tag" style="border-color:${getNodeColor(m)};color:${getNodeColor(m)}">${truncateLabel(m.label, 30)}</span>`).join("") || '<span class="detail-text" style="color:var(--muted)">None</span>'}</div>
      </div>
      ${relationships.length ? `
        <div class="detail-section">
          <span class="detail-label">RELATIONSHIPS</span>
          <div>${relationships.map((r) => `<p class="detail-text" style="margin:4px 0">${escapeHtml(r.label)}</p>`).join("")}</div>
        </div>
      ` : ""}
    `;
  }
}

function closeDetail() {
  elements.detail.hidden = true;
  elements.detailContent.innerHTML = "";
  selectedNodeId = null;
}

function showTooltip(event, d) {
  const tooltip = elements.tooltip;
  tooltip.hidden = false;

  if (d.type === "memory") {
    const primaryType = getDominantType(d.types);
    tooltip.innerHTML = `
      <div class="tooltip-label">Memory</div>
      <div class="tooltip-title">${escapeHtml(d.label)}</div>
      <div class="tooltip-meta">
        ${MEMORY_TYPE_LABELS[primaryType] || "Unclassified"} · Salience ${(d.salience || 0).toFixed(2)}
      </div>
    `;
  } else {
    tooltip.innerHTML = `
      <div class="tooltip-label">Entity / ${d.kind}</div>
      <div class="tooltip-title">${escapeHtml(d.label)}</div>
      <div class="tooltip-meta">${d.memoryCount || 0} linked memories</div>
    `;
  }

  positionTooltip(event);
}

function positionTooltip(event) {
  const bounds = elements.wrapper.getBoundingClientRect();
  const x = event.clientX - bounds.left;
  const y = event.clientY - bounds.top;
  elements.tooltip.style.transform = `translate(${x + 14}px, ${y + 14}px)`;
}

function hideTooltip() {
  elements.tooltip.hidden = true;
}

function drag(simulation) {
  function dragstarted(event) {
    if (!event.active) simulation.alphaTarget(0.15).restart();
    event.subject.fx = event.subject.x;
    event.subject.fy = event.subject.y;
  }

  function dragged(event) {
    event.subject.fx = event.x;
    event.subject.fy = event.y;
  }

  function dragended(event) {
    if (!event.active) simulation.alphaTarget(0);
    event.subject.fx = null;
    event.subject.fy = null;
  }

  return d3.drag()
    .on("start", dragstarted)
    .on("drag", dragged)
    .on("end", dragended);
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
