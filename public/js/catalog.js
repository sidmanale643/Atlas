const MEMORY_TYPES = [
  "relationship",
  "preference",
  "fact",
  "decision",
  "learning",
  "event",
  "instruction",
  "observation",
  "error",
];
const ENTITY_KINDS = [
  "person",
  "place",
  "object",
  "concept",
  "organization",
];
const SEARCH_DELAY = 250;

const view = window.location.pathname === "/entities" ? "entities" : "memories";
const config = view === "memories"
  ? {
      title: "Memories",
      description:
        "Every remembered trace, with its extracted context and associations.",
      endpoint: "/api/catalog/memories",
      searchPlaceholder: "Search title, text, summary, or entity",
      filterLabel: "Source",
      defaultSort: "created_at",
      defaultOrder: "desc",
      columns: [
        { key: "select", label: "Compare" },
        { key: "title", label: "Memory", sortable: true },
        { key: "type", label: "Type", sortable: true },
        { key: "entities", label: "Entities" },
        { key: "source", label: "Source", sortable: true },
        { key: "confidence", label: "Confidence", sortable: true },
        { key: "created_at", label: "Created", sortable: true },
        { key: "expand", label: "Details" },
      ],
    }
  : {
      title: "Entities",
      description:
        "People, places, objects, concepts, and organizations extracted from memory.",
      endpoint: "/api/catalog/entities",
      searchPlaceholder: "Search entity names",
      filterLabel: "Kind",
      defaultSort: "canonical_name",
      defaultOrder: "asc",
      columns: [
        { key: "canonical_name", label: "Entity", sortable: true },
        { key: "kind", label: "Kind", sortable: true },
        { key: "memory_count", label: "Memories", sortable: true },
        {
          key: "relationship_count",
          label: "Relationships",
          sortable: true,
        },
        { key: "alias_count", label: "Aliases" },
        { key: "pending_suggestion_count", label: "Review" },
        { key: "created_at", label: "Created", sortable: true },
        { key: "expand", label: "Details" },
      ],
    };

const elements = {
  title: document.querySelector("#catalogTitle"),
  description: document.querySelector("#catalogDescription"),
  search: document.querySelector("#catalogSearch"),
  searchLabel: document.querySelector("#searchLabel"),
  filter: document.querySelector("#catalogFilter"),
  filterLabel: document.querySelector("#filterLabel"),
  secondaryFilter: document.querySelector("#secondaryFilter"),
  secondaryFilterLabel: document.querySelector("#secondaryFilterLabel"),
  secondaryFilterControl: document.querySelector("#secondaryFilterControl"),
  pageSize: document.querySelector("#pageSize"),
  count: document.querySelector("#catalogCount"),
  clearFilters: document.querySelector("#clearFilters"),
  head: document.querySelector("#catalogHead"),
  body: document.querySelector("#catalogBody"),
  state: document.querySelector("#catalogState"),
  caption: document.querySelector("#tableCaption"),
  pageStatus: document.querySelector("#pageStatus"),
  previous: document.querySelector("#previousPage"),
  next: document.querySelector("#nextPage"),
  comparisonBar: document.querySelector("#comparisonBar"),
  comparisonCount: document.querySelector("#comparisonCount"),
  comparisonNames: document.querySelector("#comparisonNames"),
  clearComparison: document.querySelector("#clearComparison"),
  compareMemories: document.querySelector("#compareMemories"),
};

const urlState = new URLSearchParams(window.location.search);
const state = {
  q: urlState.get("q") || "",
  limit: readInteger(urlState.get("limit"), 25, [10, 25, 50, 100]),
  offset: Math.max(0, readInteger(urlState.get("offset"), 0)),
  sort: urlState.get("sort") || config.defaultSort,
  order: urlState.get("order") === "desc"
    ? "desc"
    : urlState.get("order") === "asc"
      ? "asc"
      : config.defaultOrder,
  filter: readPrimaryFilter(urlState),
  secondaryFilter: readSecondaryFilter(urlState),
  total: 0,
  items: [],
  loading: true,
  error: null,
  expandedId: null,
  selectedMemories: new Map(),
};

const detailCache = new Map();
let requestController = null;
let searchTimer = null;

initialize();

function initialize() {
  document.title = `${config.title} · Neurogram`;
  elements.title.textContent = config.title;
  elements.description.textContent = config.description;
  elements.search.placeholder = config.searchPlaceholder;
  elements.searchLabel.textContent = `Search ${view}`;
  elements.filterLabel.textContent = config.filterLabel;
  elements.caption.textContent = `Stored ${view}`;
  elements.search.value = state.q;
  elements.pageSize.value = String(state.limit);
  document.querySelectorAll("[data-view]").forEach((link) => {
    if (link.dataset.view === view) link.setAttribute("aria-current", "page");
  });

  renderFilterOptions();
  renderHead();
  bindEvents();
  loadCatalog();
}

function bindEvents() {
  elements.search.addEventListener("input", () => {
    state.q = elements.search.value.trim();
    state.offset = 0;
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(loadCatalog, SEARCH_DELAY);
    updateClearButton();
  });
  elements.search.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    window.clearTimeout(searchTimer);
    loadCatalog();
  });
  elements.filter.addEventListener("change", () => {
    state.filter = elements.filter.value;
    state.offset = 0;
    loadCatalog();
  });
  elements.secondaryFilter.addEventListener("change", () => {
    state.secondaryFilter = elements.secondaryFilter.value;
    state.offset = 0;
    loadCatalog();
  });
  elements.pageSize.addEventListener("change", () => {
    state.limit = Number(elements.pageSize.value);
    state.offset = 0;
    loadCatalog();
  });
  elements.clearFilters.addEventListener("click", () => {
    state.q = "";
    state.filter = "";
    state.secondaryFilter = "";
    state.offset = 0;
    elements.search.value = "";
    elements.filter.value = "";
    elements.secondaryFilter.value = "";
    loadCatalog();
  });
  elements.previous.addEventListener("click", () => {
    state.offset = Math.max(0, state.offset - state.limit);
    loadCatalog({ focusTable: true });
  });
  elements.next.addEventListener("click", () => {
    if (state.offset + state.limit >= state.total) return;
    state.offset += state.limit;
    loadCatalog({ focusTable: true });
  });
  elements.clearComparison.addEventListener("click", clearComparisonSelection);
  elements.compareMemories.addEventListener("click", openComparison);
}

function renderFilterOptions() {
  elements.filter.replaceChildren();
  elements.filter.append(createOption("", "All"));
  elements.secondaryFilter.replaceChildren();
  elements.secondaryFilter.append(createOption("", "All"));
  if (view === "memories") {
    elements.filter.append(
      createOption("source:ui", "User"),
      createOption("source:mcp", "Agent"),
    );
    MEMORY_TYPES.forEach((type) => {
      elements.secondaryFilter.append(
        createOption(`type:${type}`, capitalize(type)),
      );
    });
    elements.secondaryFilterControl.hidden = false;
  } else {
    ENTITY_KINDS.forEach((kind) => {
      elements.filter.append(createOption(`kind:${kind}`, capitalize(kind)));
    });
    elements.secondaryFilterControl.hidden = true;
  }
  elements.filter.value = state.filter;
  elements.secondaryFilter.value = state.secondaryFilter;
}

function renderHead() {
  const row = document.createElement("tr");
  config.columns.forEach((column) => {
    const th = document.createElement("th");
    th.scope = "col";
    if (!column.sortable) {
      th.textContent = column.label;
      row.append(th);
      return;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = column.label;
    const indicator = document.createElement("span");
    indicator.setAttribute("aria-hidden", "true");
    indicator.textContent = state.sort === column.key
      ? state.order === "asc" ? "↑" : "↓"
      : "↕";
    button.append(indicator);
    if (state.sort === column.key) {
      button.setAttribute(
        "aria-sort",
        state.order === "asc" ? "ascending" : "descending",
      );
    }
    button.addEventListener("click", () => {
      if (state.sort === column.key) {
        state.order = state.order === "asc" ? "desc" : "asc";
      } else {
        state.sort = column.key;
        state.order = column.key === "created_at" ? "desc" : "asc";
      }
      state.offset = 0;
      renderHead();
      loadCatalog();
    });
    th.append(button);
    row.append(th);
  });
  elements.head.replaceChildren(row);
}

async function loadCatalog({ focusTable = false } = {}) {
  requestController?.abort();
  requestController = new AbortController();
  state.loading = true;
  state.error = null;
  state.expandedId = null;
  render();
  syncUrl();

  try {
    const response = await fetch(buildCatalogUrl(), {
      signal: requestController.signal,
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(
        typeof result.error === "string" ? result.error : "Catalog request failed",
      );
    }
    state.items = result.items;
    state.total = result.total;
    state.limit = result.limit;
    state.offset = result.offset;
    if (state.offset >= state.total && state.total > 0) {
      state.offset = Math.floor((state.total - 1) / state.limit) * state.limit;
      return loadCatalog({ focusTable });
    }
  } catch (error) {
    if (error.name === "AbortError") return;
    state.error = error.message;
    state.items = [];
    state.total = 0;
  } finally {
    if (requestController?.signal.aborted) return;
    state.loading = false;
    render();
    syncUrl();
    if (focusTable) {
      document.querySelector(".table-frame").scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
  }
}

function buildCatalogUrl() {
  const params = new URLSearchParams({
    limit: String(state.limit),
    offset: String(state.offset),
    sort: state.sort,
    order: state.order,
  });
  if (state.q) params.set("q", state.q);
  if (state.filter) {
    const [name, value] = state.filter.split(":");
    params.set(name, value);
  }
  if (state.secondaryFilter) {
    const [name, value] = state.secondaryFilter.split(":");
    params.set(name, value);
  }
  return `${config.endpoint}?${params}`;
}

function syncUrl() {
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  if (state.filter) {
    const [name, value] = state.filter.split(":");
    params.set(name, value);
  }
  if (state.secondaryFilter) {
    const [name, value] = state.secondaryFilter.split(":");
    params.set(name, value);
  }
  if (state.limit !== 25) params.set("limit", String(state.limit));
  if (state.offset) params.set("offset", String(state.offset));
  if (state.sort !== config.defaultSort) params.set("sort", state.sort);
  if (state.order !== config.defaultOrder) params.set("order", state.order);
  const query = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
}

function render() {
  elements.state.classList.toggle("is-error", Boolean(state.error));
  if (state.loading) {
    elements.state.hidden = false;
    elements.state.textContent = `Loading ${view}…`;
  } else if (state.error) {
    elements.state.hidden = false;
    elements.state.textContent = `Unable to load ${view}: ${state.error}`;
  } else if (!state.items.length) {
    elements.state.hidden = false;
    elements.state.textContent = state.q || state.filter
      ? `No ${view} match the current search and filters.`
      : `No ${view} have been stored yet.`;
  } else {
    elements.state.hidden = true;
  }

  renderRows();
  renderSummary();
  renderComparisonBar();
  updateClearButton();
}

function renderRows() {
  elements.body.replaceChildren();
  state.items.forEach((item) => {
    const row = view === "memories"
      ? createMemoryRow(item)
      : createEntityRow(item);
    elements.body.append(row);
    if (String(state.expandedId) === String(item.id)) {
      row.classList.add("is-expanded");
      elements.body.append(createDetailRow(item));
    }
  });
}

function createMemoryRow(memory) {
  const row = document.createElement("tr");
  row.className = "data-row";
  row.append(
    createSelectionCell(memory),
    createPrimaryCell(memory.title, memory.summary || memory.raw_text),
    createTextCell(capitalize(memory.type)),
    createTagsCell(memory.entities),
    createTextCell(memory.source === "mcp" ? "Agent" : "User"),
    createTextCell(formatPercent(memory.confidence)),
    createTextCell(formatDate(memory.created_at)),
    createExpandCell(memory),
  );
  return row;
}

function createSelectionCell(memory) {
  const cell = document.createElement("td");
  cell.className = "selection-cell";
  const input = document.createElement("input");
  const selected = state.selectedMemories.has(memory.id);
  input.type = "checkbox";
  input.checked = selected;
  input.disabled = !selected && state.selectedMemories.size >= 2;
  input.setAttribute("aria-label", `Select ${memory.title || memory.raw_text} for comparison`);
  input.addEventListener("change", () => {
    if (input.checked) {
      state.selectedMemories.set(memory.id, {
        id: memory.id,
        label: memory.title || memory.summary || memory.raw_text,
      });
    } else {
      state.selectedMemories.delete(memory.id);
    }
    renderRows();
    renderComparisonBar();
  });
  cell.append(input);
  return cell;
}

function createEntityRow(entity) {
  const row = document.createElement("tr");
  row.className = "data-row";
  const primary = createPrimaryCell(entity.canonical_name);
  primary.querySelector("strong").classList.add(`tag-${entity.kind}`);
  row.append(
    primary,
    createTagsCell([
      { canonical_name: capitalize(entity.kind), kind: entity.kind },
    ]),
    createTextCell(String(entity.memory_count)),
    createTextCell(String(entity.relationship_count)),
    createTextCell(String(entity.alias_count || 0)),
    createTextCell(String(entity.pending_suggestion_count || 0)),
    createTextCell(formatDate(entity.created_at)),
    createExpandCell(entity),
  );
  return row;
}

function createPrimaryCell(title, preview = "") {
  const cell = document.createElement("td");
  cell.className = "primary-cell";
  const strong = document.createElement("strong");
  strong.textContent = title || "Untitled memory";
  cell.append(strong);
  if (preview) {
    const paragraph = document.createElement("p");
    paragraph.textContent = preview;
    cell.append(paragraph);
  }
  return cell;
}

function createTextCell(value) {
  const cell = document.createElement("td");
  cell.textContent = value;
  return cell;
}

function createTagsCell(items = []) {
  const cell = document.createElement("td");
  const tags = document.createElement("div");
  tags.className = "cell-tags";
  items.slice(0, 4).forEach((item) => {
    const tag = document.createElement("span");
    tag.className = `tag tag-${item.kind}`;
    tag.textContent = item.canonical_name || item.kind;
    tags.append(tag);
  });
  if (items.length > 4) {
    const overflow = document.createElement("span");
    overflow.className = "tag";
    overflow.textContent = `+${items.length - 4}`;
    tags.append(overflow);
  }
  if (!items.length) {
    const empty = document.createElement("span");
    empty.textContent = "None";
    tags.append(empty);
  }
  cell.append(tags);
  return cell;
}

function createExpandCell(item) {
  const cell = document.createElement("td");
  const button = document.createElement("button");
  const expanded = String(state.expandedId) === String(item.id);
  button.type = "button";
  button.className = "expand-button";
  button.setAttribute("aria-expanded", String(expanded));
  button.setAttribute(
    "aria-label",
    `${expanded ? "Collapse" : "Inspect"} ${
      item.title || item.canonical_name
    }`,
  );
  button.textContent = expanded ? "−" : "+";
  button.addEventListener("click", () => toggleDetail(item));
  cell.append(button);
  return cell;
}

function toggleDetail(item) {
  if (String(state.expandedId) === String(item.id)) {
    state.expandedId = null;
    renderRows();
    return;
  }
  state.expandedId = item.id;
  renderRows();
  loadDetail(item);
}

async function loadDetail(item) {
  const cacheKey = `${view}:${item.id}`;
  if (detailCache.has(cacheKey)) return;
  detailCache.set(cacheKey, { loading: true });
  renderRows();
  try {
    const endpoint = view === "memories"
      ? `/api/memories/${encodeURIComponent(item.id)}`
      : `/api/entities/${encodeURIComponent(item.id)}/graph`;
    const response = await fetch(endpoint);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Detail request failed");
    detailCache.set(cacheKey, { data: result });
  } catch (error) {
    detailCache.set(cacheKey, { error: error.message });
  }
  if (String(state.expandedId) === String(item.id)) renderRows();
}

function createDetailRow(item) {
  const row = document.createElement("tr");
  row.className = "detail-row";
  const cell = document.createElement("td");
  cell.colSpan = config.columns.length;
  const detail = document.createElement("div");
  detail.className = "row-detail";
  const cached = detailCache.get(`${view}:${item.id}`);

  if (!cached || cached.loading) {
    detail.textContent = "Loading details…";
  } else if (cached.error) {
    detail.textContent = `Unable to load details: ${cached.error}`;
  } else if (view === "memories") {
    detail.append(renderMemoryDetail(cached.data));
  } else {
    detail.append(renderEntityDetail(cached.data));
  }
  cell.append(detail);
  row.append(cell);
  return row;
}

function renderMemoryDetail(memory) {
  const extraction = memory.extraction?.extraction_json || memory.extraction || {};
  const grid = document.createElement("div");
  grid.className = "detail-grid";
  grid.append(
    createDetailSection("Full memory", memory.raw_text, true),
    createListSection(
      "Entities",
      (memory.entities || []).map(
        (entity) => `${entity.canonical_name} · ${entity.kind} · ${formatPercent(entity.confidence)}`,
      ),
    ),
    createListSection(
      "Relationships",
      (memory.relationships || []).map((relationship) => {
        const source = relationship.source_name || relationship.source?.canonical_name;
        const target = relationship.target_name || relationship.target?.canonical_name;
        return `${source} ${relationship.predicate} ${target}`;
      }),
    ),
    createListSection(
      "Brain regions",
      (memory.regions || []).map(
        (region) => `${humanize(region.region)} · ${formatPercent(region.weight)}`,
      ),
    ),
    createListSection("Tags", memory.tags || []),
    createMetaSection("Extraction", [
      ["Summary", extraction.summary || memory.summary || "Not available"],
      [
        "Types",
        (extraction.types || [])
          .map((type) => `${type.type} ${formatPercent(type.weight)}`)
          .join(", ") || "Not available",
      ],
      ["Salience", formatPercent(extraction.salience)],
      ["Model", memory.extraction?.model || "Not available"],
      ["Schema", memory.extraction?.schema_version ?? "Not available"],
    ]),
  );
  return grid;
}

function renderEntityDetail(graph) {
  const grid = document.createElement("div");
  grid.className = "detail-grid";
  grid.append(
    createMetaSection("Entity", [
      ["Name", graph.entity.canonical_name],
      ["Kind", capitalize(graph.entity.kind)],
      ["Created", formatDate(graph.entity.created_at)],
    ]),
    createListSection(
      "Known aliases",
      (graph.aliases || []).map((alias) => alias.alias),
    ),
    createListSection(
      "Linked memories",
      (graph.memories || []).map(
        (memory) => memory.summary || memory.title || memory.raw_text,
      ),
      true,
    ),
    createListSection(
      "Explicit relationships",
      (graph.relationships || []).map(
        (relationship) =>
          `${relationship.source.canonical_name} ${relationship.predicate} ${relationship.target.canonical_name}`,
      ),
      true,
    ),
    createSuggestionSection(graph.suggestions || [], graph.entity.id),
  );
  return grid;
}

function createSuggestionSection(suggestions, entityId) {
  const section = document.createElement("section");
  section.className = "detail-section wide";
  const heading = document.createElement("h2");
  heading.textContent = "Entity resolution review";
  section.append(heading);

  if (!suggestions.length) {
    const empty = document.createElement("p");
    empty.textContent = "No ambiguous aliases need review.";
    section.append(empty);
    return section;
  }

  const list = document.createElement("div");
  list.className = "suggestion-list";
  suggestions.forEach((suggestion) => {
    const item = document.createElement("article");
    item.className = "suggestion-item";
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    const sourceName =
      suggestion.source_name
      || suggestion.source_canonical_name
      || `Entity ${suggestion.source_entity_id}`;
    const targetName =
      suggestion.target_name
      || suggestion.target_canonical_name
      || `Entity ${suggestion.target_entity_id}`;
    title.textContent = `${sourceName} may be ${targetName}`;
    const explanation = document.createElement("p");
    explanation.textContent = suggestion.reason
      || `Ambiguous alias: ${suggestion.alias || "unknown"}`;
    copy.append(title, explanation);

    const actions = document.createElement("div");
    actions.className = "suggestion-actions";
    const merge = createSuggestionButton(
      suggestion.id,
      "Merge",
      "merge",
      entityId,
    );
    const reject = createSuggestionButton(
      suggestion.id,
      "Keep separate",
      "reject",
      entityId,
    );
    actions.append(merge, reject);
    item.append(copy, actions);
    list.append(item);
  });
  section.append(list);
  return section;
}

function createSuggestionButton(suggestionId, label, decision, entityId) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const response = await fetch(
        `/api/entity-resolution/suggestions/${encodeURIComponent(suggestionId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision }),
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Review failed");
      detailCache.delete(`entities:${entityId}`);
      await loadCatalog();
    } catch (error) {
      button.disabled = false;
      button.title = error.message;
    }
  });
  return button;
}

function createDetailSection(title, text, wide = false) {
  const section = document.createElement("section");
  section.className = `detail-section${wide ? " wide" : ""}`;
  const heading = document.createElement("h2");
  heading.textContent = title;
  const paragraph = document.createElement("p");
  paragraph.textContent = text || "Not available";
  section.append(heading, paragraph);
  return section;
}

function createListSection(title, items, wide = false) {
  const section = document.createElement("section");
  section.className = `detail-section${wide ? " wide" : ""}`;
  const heading = document.createElement("h2");
  heading.textContent = title;
  const list = document.createElement("ul");
  list.className = "detail-list";
  (items.length ? items : ["None"]).forEach((value) => {
    const item = document.createElement("li");
    item.textContent = value;
    list.append(item);
  });
  section.append(heading, list);
  return section;
}

function createMetaSection(title, entries) {
  const section = document.createElement("section");
  section.className = "detail-section";
  const heading = document.createElement("h2");
  heading.textContent = title;
  const list = document.createElement("dl");
  list.className = "detail-meta";
  entries.forEach(([label, value]) => {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    list.append(term, description);
  });
  section.append(heading, list);
  return section;
}

function renderSummary() {
  const noun = state.total === 1
    ? view === "memories" ? "memory" : "entity"
    : view;
  elements.count.textContent = state.loading
    ? `Loading ${view}…`
    : `${state.total.toLocaleString()} ${noun}`;

  const first = state.total ? state.offset + 1 : 0;
  const last = Math.min(state.offset + state.limit, state.total);
  elements.pageStatus.textContent = `${first.toLocaleString()}–${last.toLocaleString()} of ${state.total.toLocaleString()}`;
  elements.previous.disabled = state.loading || state.offset === 0;
  elements.next.disabled =
    state.loading || state.offset + state.limit >= state.total;
}

function renderComparisonBar() {
  if (view !== "memories") {
    elements.comparisonBar.hidden = true;
    return;
  }
  const selected = [...state.selectedMemories.values()];
  elements.comparisonBar.hidden = selected.length === 0;
  elements.comparisonCount.textContent = `${selected.length} of 2 selected`;
  elements.comparisonNames.textContent = selected.length
    ? selected.map(({ label }) => label).join(" · ")
    : "Choose two memories to compare";
  elements.compareMemories.disabled = selected.length !== 2;
}

function clearComparisonSelection() {
  state.selectedMemories.clear();
  renderRows();
  renderComparisonBar();
}

function openComparison() {
  const selected = [...state.selectedMemories.keys()];
  if (selected.length !== 2) return;
  const params = new URLSearchParams({
    left: selected[0],
    right: selected[1],
  });
  window.location.assign(`/memories/compare?${params}`);
}

function updateClearButton() {
  elements.clearFilters.hidden =
    !state.q && !state.filter && !state.secondaryFilter;
}

function readPrimaryFilter(params) {
  if (view === "entities") {
    const kind = params.get("kind");
    return ENTITY_KINDS.includes(kind) ? `kind:${kind}` : "";
  }
  const source = params.get("source");
  if (["ui", "mcp"].includes(source)) return `source:${source}`;
  return "";
}

function readSecondaryFilter(params) {
  if (view === "entities") return "";
  const type = params.get("type");
  return MEMORY_TYPES.includes(type) ? `type:${type}` : "";
}

function readInteger(value, fallback, allowed = null) {
  if (value === null || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  if (allowed && !allowed.includes(parsed)) return fallback;
  return parsed;
}

function createOption(value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

function formatDate(value) {
  if (!value) return "Not available";
  const date = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(date);
}

function formatPercent(value) {
  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat("en", {
        style: "percent",
        maximumFractionDigits: 0,
      }).format(number)
    : "Not available";
}

function capitalize(value) {
  const text = String(value || "");
  return text ? text[0].toUpperCase() + text.slice(1) : "Not available";
}

function humanize(value) {
  return String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toUpperCase());
}
