import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import type { EntityResolutionSuggestion } from "../lib/api";

type RelatedMemoryLink = Awaited<ReturnType<typeof api.getMemoryLinks>>["links"][number];
import type {
  EntityCatalogItem,
  EntityKind,
  Entity,
  Memory,
  MemoryCatalogItem,
} from "../lib/types";
import styles from "./Catalog.module.css";

/* ---------------------------------------------------------------- constants */

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
] as const;

const ENTITY_KINDS: EntityKind[] = [
  "person",
  "place",
  "object",
  "concept",
  "organization",
];

const PAGE_SIZES = [10, 25, 50, 100] as const;
const SEARCH_DELAY = 250;

type Order = "asc" | "desc";

interface ColumnConfig {
  key: string;
  label: string;
  sortable?: boolean;
}

const MEMORY_COLUMNS: ColumnConfig[] = [
  { key: "select", label: "Compare" },
  { key: "title", label: "Memory", sortable: true },
  { key: "type", label: "Type", sortable: true },
  { key: "entities", label: "Entities" },
  { key: "linked", label: "Linked", sortable: true },
  { key: "source", label: "Source", sortable: true },
  { key: "confidence", label: "Confidence", sortable: true },
  { key: "created_at", label: "Created", sortable: true },
  { key: "expand", label: "Details" },
];

const ENTITY_COLUMNS: ColumnConfig[] = [
  { key: "canonical_name", label: "Entity", sortable: true },
  { key: "kind", label: "Kind", sortable: true },
  { key: "memory_count", label: "Memories", sortable: true },
  { key: "relationship_count", label: "Relationships", sortable: true },
  { key: "alias_count", label: "Aliases" },
  { key: "pending_suggestion_count", label: "Review" },
  { key: "created_at", label: "Created", sortable: true },
  { key: "expand", label: "Details" },
];

/* The entity graph response shape (see api.entityGraph). */
type EntityGraph = Awaited<ReturnType<typeof api.entityGraph>>;

interface DetailState<T> {
  loading?: boolean;
  data?: T;
  error?: string;
}

/* ---------------------------------------------------------------- helpers */

function readInteger(
  value: string | null,
  fallback: number,
  allowed?: readonly number[],
): number {
  if (value === null || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  if (allowed && !allowed.includes(parsed)) return fallback;
  return parsed;
}

function capitalize(value: unknown): string {
  const text = String(value ?? "");
  return text ? text[0].toUpperCase() + text.slice(1) : "Not available";
}

function humanize(value: unknown): string {
  return String(value ?? "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

function formatDate(value?: string | null): string {
  if (!value) return "Not available";
  const date = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(date);
}

function formatPercent(value: unknown): string {
  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat("en", {
        style: "percent",
        maximumFractionDigits: 0,
      }).format(number)
    : "Not available";
}

/* ---------------------------------------------------------------- view config */

interface ViewConfig {
  title: string;
  description: string;
  searchPlaceholder: string;
  filterLabel: string;
  defaultSort: string;
  defaultOrder: Order;
  columns: ColumnConfig[];
}

const VIEW_CONFIG: Record<"memories" | "entities", ViewConfig> = {
  memories: {
    title: "Memories",
    description:
      "Every remembered trace, with its extracted context and associations.",
    searchPlaceholder: "Search title, text, summary, or entity",
    filterLabel: "Source",
    defaultSort: "created_at",
    defaultOrder: "desc",
    columns: MEMORY_COLUMNS,
  },
  entities: {
    title: "Entities",
    description:
      "People, places, objects, concepts, and organizations extracted from memory.",
    searchPlaceholder: "Search entity names",
    filterLabel: "Kind",
    defaultSort: "canonical_name",
    defaultOrder: "asc",
    columns: ENTITY_COLUMNS,
  },
};

/* ---------------------------------------------------------------- component */

export default function Catalog({ view }: { view: "memories" | "entities" }) {
  const config = VIEW_CONFIG[view];
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  /* --- URL-derived initial state (read once per param change) --- */
  const readPrimaryFilter = useCallback((): string => {
    if (view === "entities") {
      const kind = searchParams.get("kind");
      return kind && ENTITY_KINDS.includes(kind as EntityKind)
        ? `kind:${kind}`
        : "";
    }
    const source = searchParams.get("source");
    return source === "ui" || source === "mcp" ? `source:${source}` : "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, searchParams]);

  const readSecondaryFilter = useCallback((): string => {
    if (view === "entities") return "";
    const type = searchParams.get("type");
    return type && (MEMORY_TYPES as readonly string[]).includes(type)
      ? `type:${type}`
      : "";
  }, [view, searchParams]);

  /* --- controlled query state --- */
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [filter, setFilter] = useState(readPrimaryFilter);
  const [secondaryFilter, setSecondaryFilter] = useState(readSecondaryFilter);
  const [limit, setLimit] = useState(() =>
    readInteger(searchParams.get("limit"), 25, PAGE_SIZES),
  );
  const [offset, setOffset] = useState(() =>
    Math.max(0, readInteger(searchParams.get("offset"), 0)),
  );
  const [sort, setSort] = useState(
    () => searchParams.get("sort") ?? config.defaultSort,
  );
  const [order, setOrder] = useState<Order>(() => {
    const o = searchParams.get("order");
    return o === "desc" ? "desc" : o === "asc" ? "asc" : config.defaultOrder;
  });

  /* --- data state --- */
  const [items, setItems] = useState<(MemoryCatalogItem | EntityCatalogItem)[]>(
    [],
  );
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* --- expand / detail cache --- */
  const [expandedId, setExpandedId] = useState<string | number | null>(null);
  const [memoryDetails, setMemoryDetails] = useState<
    Record<string, DetailState<Memory>>
  >({});
  const [entityDetails, setEntityDetails] = useState<
    Record<string, DetailState<EntityGraph>>
  >({});
  const [relatedMemories, setRelatedMemories] = useState<
    Record<string, { loading?: boolean; links?: RelatedMemoryLink[]; error?: string }>
  >({});

  /* --- comparison selection (memories only) --- */
  const [selected, setSelected] = useState<Map<string, string>>(new Map());

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tableRef = useRef<HTMLDivElement | null>(null);

  /* --- document title --- */
  useEffect(() => {
    document.title = `${config.title} · Atlas`;
  }, [config.title]);

  /* --- sync URL whenever query state changes --- */
  useEffect(() => {
    const next = new URLSearchParams();
    if (q) next.set("q", q);
    if (filter) {
      const [name, value] = filter.split(":");
      next.set(name, value);
    }
    if (secondaryFilter) {
      const [name, value] = secondaryFilter.split(":");
      next.set(name, value);
    }
    if (limit !== 25) next.set("limit", String(limit));
    if (offset) next.set("offset", String(offset));
    if (sort !== config.defaultSort) next.set("sort", sort);
    if (order !== config.defaultOrder) next.set("order", order);
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, filter, secondaryFilter, limit, offset, sort, order]);

  /* --- load catalog whenever effective query changes --- */
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    const params: Record<string, string | number | undefined> = {
      limit,
      offset,
      sort,
      order,
    };
    if (q) params.q = q;
    if (filter) {
      const [name, value] = filter.split(":");
      params[name] = value;
    }
    if (secondaryFilter) {
      const [name, value] = secondaryFilter.split(":");
      params[name] = value;
    }

    setLoading(true);
    setError(null);
    setExpandedId(null);

    const loader =
      view === "memories"
        ? api.catalogMemories(params)
        : api.catalogEntities(params);

    loader
      .then((result) => {
        if (cancelled) return;
        // Clamp offset past the end (mirrors legacy re-fetch behavior).
        if (offset >= result.total && result.total > 0) {
          const clamped =
            Math.floor((result.total - 1) / result.limit) * result.limit;
          setOffset(clamped);
          return;
        }
        setItems(result.items);
        setTotal(result.total);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled || controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setItems([]);
        setTotal(0);
        setError(err instanceof Error ? err.message : "Catalog request failed");
        setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, q, filter, secondaryFilter, limit, offset, sort, order]);

  /* --- debounced search input --- */
  const onSearchInput = (value: string) => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setQ(value.trim());
      setOffset(0);
    }, SEARCH_DELAY);
  };
  const onSearchEnter = (value: string) => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    setQ(value.trim());
    setOffset(0);
  };

  const [searchInput, setSearchInput] = useState(q);

  const hasActiveFilters = Boolean(q || filter || secondaryFilter);

  const clearFilters = () => {
    setSearchInput("");
    setQ("");
    setFilter("");
    setSecondaryFilter("");
    setOffset(0);
  };

  /* --- sorting --- */
  const toggleSort = (key: string) => {
    if (sort === key) {
      setOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSort(key);
      setOrder(key === "created_at" ? "desc" : "asc");
    }
    setOffset(0);
  };

  /* --- pagination --- */
  const goPrevious = () => {
    setOffset((o) => Math.max(0, o - limit));
    scrollTable();
  };
  const goNext = () => {
    if (offset + limit >= total) return;
    setOffset((o) => o + limit);
    scrollTable();
  };
  const scrollTable = () => {
    requestAnimationFrame(() => {
      tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  /* --- expand / detail fetch --- */
  const toggleDetail = (id: string | number) => {
    if (expandedId !== null && String(expandedId) === String(id)) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    loadDetail(id);
  };

  const loadDetail = (id: string | number) => {
    const key = String(id);
    if (view === "memories") {
      if (memoryDetails[key] && !memoryDetails[key].error) return;
      setMemoryDetails((prev) => ({ ...prev, [key]: { loading: true } }));
      api
        .getMemory(key)
        .then((data) =>
          setMemoryDetails((prev) => ({ ...prev, [key]: { data } })),
        )
        .catch((err: unknown) =>
          setMemoryDetails((prev) => ({
            ...prev,
            [key]: {
              error: err instanceof Error ? err.message : "Detail request failed",
            },
          })),
        );
      if (!relatedMemories[key]) {
        setRelatedMemories((prev) => ({ ...prev, [key]: { loading: true } }));
        api
          .getMemoryLinks(key, { limit: 5 })
          .then((result) =>
            setRelatedMemories((prev) => ({
              ...prev,
              [key]: { links: result.links },
            })),
          )
          .catch(() =>
            setRelatedMemories((prev) => ({
              ...prev,
              [key]: { links: [] },
            })),
          );
      }
    } else {
      if (entityDetails[key] && !entityDetails[key].error) return;
      setEntityDetails((prev) => ({ ...prev, [key]: { loading: true } }));
      api
        .entityGraph(Number(id))
        .then((data) =>
          setEntityDetails((prev) => ({ ...prev, [key]: { data } })),
        )
        .catch((err: unknown) =>
          setEntityDetails((prev) => ({
            ...prev,
            [key]: {
              error: err instanceof Error ? err.message : "Detail request failed",
            },
          })),
        );
    }
  };

  /* Force-refetch an entity's graph (used after a resolution decision). */
  const reloadEntityDetail = (id: string | number) => {
    const key = String(id);
    setEntityDetails((prev) => ({ ...prev, [key]: { loading: true } }));
    api
      .entityGraph(Number(id))
      .then((data) =>
        setEntityDetails((prev) => ({ ...prev, [key]: { data } })),
      )
      .catch((err: unknown) =>
        setEntityDetails((prev) => ({
          ...prev,
          [key]: {
            error: err instanceof Error ? err.message : "Detail request failed",
          },
        })),
      );
  };

  /* Resolve an alias-merge suggestion, then refresh the open entity. */
  const decideSuggestion = async (
    suggestionId: number,
    decision: "merge" | "reject",
    entityId: string | number,
  ) => {
    await api.resolveSuggestion(suggestionId, decision);
    reloadEntityDetail(entityId);
  };

  /* --- comparison --- */
  const toggleSelect = (item: MemoryCatalogItem) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(item.id)) {
        next.delete(item.id);
      } else {
        if (next.size >= 2) return prev;
        next.set(item.id, item.title || item.summary || item.raw_text);
      }
      return next;
    });
  };
  const clearSelection = () => setSelected(new Map());
  const openComparison = () => {
    const ids = [...selected.keys()];
    if (ids.length !== 2) return;
    navigate(
      `/memories/compare?left=${encodeURIComponent(ids[0])}&right=${encodeURIComponent(
        ids[1],
      )}`,
    );
  };

  /* --- summary readout --- */
  const noun =
    total === 1 ? (view === "memories" ? "memory" : "entity") : view;
  const firstRow = total ? offset + 1 : 0;
  const lastRow = Math.min(offset + limit, total);

  const selectedList = useMemo(() => [...selected.values()], [selected]);

  /* ---------------------------------------------------------------- render */

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>{config.title}</h1>
        <p className={styles.lede}>{config.description}</p>
      </header>

      {/* toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <label className="label" htmlFor="catalogSearch">
            Search {view}
          </label>
          <input
            id="catalogSearch"
            className="nrg-field"
            type="search"
            autoComplete="off"
            placeholder={config.searchPlaceholder}
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              onSearchInput(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSearchEnter(searchInput);
              }
            }}
          />
        </div>

        <div className={styles.filters}>
          <div className={styles.filterField}>
            <label className="label" htmlFor="catalogFilter">
              {config.filterLabel}
            </label>
            <select
              id="catalogFilter"
              className="nrg-field"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">All</option>
              {view === "memories" ? (
                <>
                  <option value="source:ui">User</option>
                  <option value="source:mcp">Agent</option>
                </>
              ) : (
                ENTITY_KINDS.map((kind) => (
                  <option key={kind} value={`kind:${kind}`}>
                    {capitalize(kind)}
                  </option>
                ))
              )}
            </select>
          </div>

          {view === "memories" && (
            <div className={styles.filterField}>
              <label className="label" htmlFor="secondaryFilter">
                Type
              </label>
              <select
                id="secondaryFilter"
                className="nrg-field"
                value={secondaryFilter}
                onChange={(e) => {
                  setSecondaryFilter(e.target.value);
                  setOffset(0);
                }}
              >
                <option value="">All</option>
                {MEMORY_TYPES.map((type) => (
                  <option key={type} value={`type:${type}`}>
                    {capitalize(type)}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className={styles.filterField}>
            <label className="label" htmlFor="pageSize">
              Per page
            </label>
            <select
              id="pageSize"
              className="nrg-field"
              value={limit}
              onChange={(e) => {
                setLimit(Number(e.target.value));
                setOffset(0);
              }}
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* summary */}
      <div className={styles.summary}>
        <span className={styles.count}>
          {loading
            ? `Loading ${view}…`
            : `${total.toLocaleString()} ${noun}`}
        </span>
        {hasActiveFilters && (
          <button
            type="button"
            className={styles.textBtn}
            onClick={clearFilters}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* comparison action row (inline, NOT a fixed status bar) */}
      {view === "memories" && selectedList.length > 0 && (
        <div className={styles.compareRow}>
          <div className={styles.compareInfo}>
            <span className={styles.compareCount}>
              {selectedList.length} of 2 selected
            </span>
            <span className={styles.compareNames}>
              {selectedList.join(" · ")}
            </span>
          </div>
          <div className={styles.compareActions}>
            <button
              type="button"
              className="nrg-btn"
              onClick={clearSelection}
            >
              Clear
            </button>
            <button
              type="button"
              className="nrg-btn nrg-btn--solid"
              disabled={selectedList.length !== 2}
              onClick={openComparison}
            >
              Compare
            </button>
          </div>
        </div>
      )}

      {/* table */}
      <div className={styles.tableFrame} ref={tableRef}>
        <table className={styles.table}>
          <caption className="visually-hidden">Stored {view}</caption>
          <thead>
            <tr>
              {config.columns.map((column) => (
                <th key={column.key} scope="col" className={styles.th}>
                  {column.sortable ? (
                    <button
                      type="button"
                      className={styles.sortBtn}
                      aria-sort={
                        sort === column.key
                          ? order === "asc"
                            ? "ascending"
                            : "descending"
                          : undefined
                      }
                      onClick={() => toggleSort(column.key)}
                    >
                      <span>{column.label}</span>
                      <span aria-hidden="true" className={styles.sortInd}>
                        {sort === column.key
                          ? order === "asc"
                            ? "↑"
                            : "↓"
                          : "↕"}
                      </span>
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!loading &&
              !error &&
              items.map((item) =>
                view === "memories"
                  ? renderMemoryRow(item as MemoryCatalogItem)
                  : renderEntityRow(item as EntityCatalogItem),
              )}
          </tbody>
        </table>

        {/* inline states (NOT a status bar) */}
        {loading && (
          <div className={styles.state}>Loading {view}…</div>
        )}
        {!loading && error && (
          <div className={`${styles.state} ${styles.stateError}`}>
            Unable to load {view}: {error}
          </div>
        )}
        {!loading && !error && items.length === 0 && (
          <div className={styles.state}>
            {hasActiveFilters
              ? `No ${view} match the current search and filters.`
              : `No ${view} have been stored yet.`}
          </div>
        )}
      </div>

      {/* pagination */}
      <div className={styles.pagination}>
        <span>
          {firstRow.toLocaleString()}–{lastRow.toLocaleString()} of{" "}
          {total.toLocaleString()}
        </span>
        <div className={styles.pageBtns}>
          <button
            type="button"
            className="nrg-btn"
            disabled={loading || offset === 0}
            onClick={goPrevious}
          >
            Previous
          </button>
          <button
            type="button"
            className="nrg-btn"
            disabled={loading || offset + limit >= total}
            onClick={goNext}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );

  /* -------------------------------------------------------------- row renderers */

  function renderMemoryRow(memory: MemoryCatalogItem) {
    const isExpanded = String(expandedId) === String(memory.id);
    const isSelected = selected.has(memory.id);
    const selectDisabled = !isSelected && selected.size >= 2;
    return (
      <RowGroup key={memory.id}>
        <tr className={isExpanded ? styles.rowExpanded : styles.row}>
          <td className={styles.selectCell}>
            <input
              type="checkbox"
              className={styles.checkbox}
              checked={isSelected}
              disabled={selectDisabled}
              aria-label={`Select ${memory.title || memory.raw_text} for comparison`}
              onChange={() => toggleSelect(memory)}
            />
          </td>
          <td className={styles.primaryCell}>
            <strong className={styles.primaryName}>
              {memory.title || "Untitled memory"}
            </strong>
            {(memory.summary || memory.raw_text) && (
              <p className={styles.preview}>
                {memory.summary || memory.raw_text}
              </p>
            )}
          </td>
          <td>{capitalize(memory.type)}</td>
          <td>{renderTagCell(memory.entities)}</td>
          <td>
            {memory.linked_count > 0 ? (
              <span className={styles.linkedCount}>{memory.linked_count}</span>
            ) : (
              <span className={styles.muted}>0</span>
            )}
          </td>
          <td>{memory.source === "mcp" ? "Agent" : "User"}</td>
          <td>{formatPercent(memory.confidence)}</td>
          <td>{formatDate(memory.created_at)}</td>
          <td>{renderExpandCell(memory.id, memory.title)}</td>
        </tr>
        {isExpanded && (
          <tr className={styles.detailRow}>
            <td colSpan={config.columns.length}>
              <div className={styles.detail}>{renderMemoryDetail(memory.id)}</div>
            </td>
          </tr>
        )}
      </RowGroup>
    );
  }

  function renderEntityRow(entity: EntityCatalogItem) {
    const isExpanded = String(expandedId) === String(entity.id);
    return (
      <RowGroup key={entity.id}>
        <tr className={isExpanded ? styles.rowExpanded : styles.row}>
          <td className={styles.primaryCell}>
            <strong className={styles.primaryName}>
              {entity.canonical_name}
            </strong>
          </td>
          <td>
            <span className="chip">{entity.kind}</span>
          </td>
          <td>{entity.memory_count}</td>
          <td>{entity.relationship_count}</td>
          <td>{entity.alias_count ?? 0}</td>
          <td>{entity.pending_suggestion_count ?? 0}</td>
          <td>{formatDate(entity.created_at)}</td>
          <td>{renderExpandCell(entity.id, entity.canonical_name)}</td>
        </tr>
        {isExpanded && (
          <tr className={styles.detailRow}>
            <td colSpan={config.columns.length}>
              <div className={styles.detail}>
                {renderEntityDetail(entity.id)}
              </div>
            </td>
          </tr>
        )}
      </RowGroup>
    );
  }

  function renderTagCell(entities: Entity[] = []) {
    if (!entities.length) {
      return <span className={styles.muted}>None</span>;
    }
    const shown = entities.slice(0, 4);
    return (
      <div className={styles.tagCell}>
        {shown.map((entity) => (
          <span key={entity.id} className="chip">
            {entity.canonical_name || entity.kind}
          </span>
        ))}
        {entities.length > 4 && (
          <span className="chip">{`+${entities.length - 4}`}</span>
        )}
      </div>
    );
  }

  function renderExpandCell(id: string | number, name?: string) {
    const isExpanded = String(expandedId) === String(id);
    return (
      <button
        type="button"
        className={styles.expandBtn}
        aria-expanded={isExpanded}
        aria-label={`${isExpanded ? "Collapse" : "Inspect"} ${name ?? ""}`}
        onClick={() => toggleDetail(id)}
      >
        {isExpanded ? "−" : "+"}
      </button>
    );
  }

  /* -------------------------------------------------------------- detail renderers */

  function renderMemoryDetail(id: string | number) {
    const entry = memoryDetails[String(id)];
    if (!entry || entry.loading) {
      return <p className={styles.detailMsg}>Loading details…</p>;
    }
    if (entry.error) {
      return (
        <p className={`${styles.detailMsg} ${styles.detailError}`}>
          Unable to load details: {entry.error}
        </p>
      );
    }
    const memory = entry.data;
    if (!memory) return null;

    const rawExtraction = memory.extraction;
    type ExtractionShape = {
      summary?: string;
      salience?: number;
      types?: { type: string; weight: number }[];
    };
    const extraction: ExtractionShape =
      (rawExtraction &&
        "extraction_json" in rawExtraction &&
        rawExtraction.extraction_json) ||
      (rawExtraction as ExtractionShape | undefined) ||
      {};
    const meta =
      rawExtraction && "model" in rawExtraction
        ? (rawExtraction as { model?: string; schema_version?: number })
        : {};

    const related = relatedMemories[String(id)];
    const relatedLinks = related?.links || [];

    return (
      <div className={styles.detailCards}>
        {/* Memory Core */}
        <section className={styles.detailCard}>
          <h3 className={styles.detailCardTitle}>
            <span className={styles.detailIcon} aria-hidden="true">CORE</span>
            Memory Core
          </h3>
          <div className={styles.detailCardBody}>
            <div className={styles.detailField}>
              <div className={styles.detailFieldIcon} aria-hidden="true">TXT</div>
              <div>
                <span className={styles.detailFieldLabel}>Raw Memory</span>
                <p className={styles.detailFieldValue}>{memory.raw_text || "Not available"}</p>
              </div>
            </div>
            <div className={styles.detailField}>
              <div className={styles.detailFieldIcon} aria-hidden="true">SUM</div>
              <div>
                <span className={styles.detailFieldLabel}>Summary</span>
                <p className={`${styles.detailFieldValue} ${styles.detailSummaryHighlight}`}>
                  {extraction.summary || memory.summary || "Not available"}
                </p>
              </div>
            </div>
            {meta.model && (
              <div className={styles.detailFieldMeta}>
                <span>Model: {meta.model}</span>
                {meta.schema_version != null && <span>Schema: {meta.schema_version}</span>}
                {extraction.salience != null && <span>Salience: {formatPercent(extraction.salience)}</span>}
              </div>
            )}
          </div>
        </section>

        {/* Entities */}
        <section className={styles.detailCard}>
          <h3 className={styles.detailCardTitle}>
            <span className={styles.detailIcon} aria-hidden="true">ENT</span>
            Entities
          </h3>
          <div className={styles.detailCardBody}>
            {(memory.entities || []).length === 0 ? (
              <p className={styles.detailMsg}>No entities extracted.</p>
            ) : (
              <div className={styles.detailChips}>
                {memory.entities.map((e) => (
                  <span key={e.id} className={styles.detailChip}>
                    {e.canonical_name}
                    <span className={styles.detailChipKind}>[{e.kind}]</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Relationships */}
        <section className={styles.detailCard}>
          <h3 className={styles.detailCardTitle}>
            <span className={styles.detailIcon} aria-hidden="true">REL</span>
            Relationships
          </h3>
          <div className={styles.detailCardBody}>
            {(memory.relationships || []).length === 0 ? (
              <p className={styles.detailMsg}>No relationships found.</p>
            ) : (
              <ul className={styles.detailRelList}>
                {memory.relationships.map((r) => {
                  const src = r.source_name || r.source?.canonical_name;
                  const tgt = r.target_name || r.target?.canonical_name;
                  return (
                    <li key={r.id}>
                      {src} <span className={styles.detailPredicate}>{r.predicate}</span> {tgt}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        {/* Related Memories */}
        <section className={styles.detailCard}>
          <h3 className={styles.detailCardTitle}>
            <span className={styles.detailIcon} aria-hidden="true">LNK</span>
            Related Memories
          </h3>
          <div className={styles.detailCardBody}>
            {related?.loading && (
              <p className={styles.detailMsg}>Loading related memories…</p>
            )}
            {!related?.loading && relatedLinks.length === 0 && (
              <p className={styles.detailMsg}>No related memories found.</p>
            )}
            {relatedLinks.map((link) => (
              <article key={link.memory.id} className={styles.relatedCard}>
                <div className={styles.relatedHeader}>
                  <span className={styles.relatedTitle}>
                    {link.memory.summary || link.memory.title || link.memory.raw_text}
                  </span>
                  <span className={styles.relatedScore}>
                    {Math.round(link.score * 100)}% Linked
                  </span>
                </div>
                <div className={styles.relatedTags}>
                  {link.reasons.slice(0, 4).map((reason, i) => (
                    <span key={i} className={styles.relatedTag}>{reason}</span>
                  ))}
                </div>
                <div className={styles.relatedMeta}>
                  {link.semanticSimilarity != null && (
                    <span>{Math.round(link.semanticSimilarity * 100)}% Semantic Similarity</span>
                  )}
                  <span>·</span>
                  <span>{link.memory.source === "mcp" ? "Agent Memory" : "User Memory"}</span>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* Brain regions (compact) */}
        {(memory.regions || []).length > 0 && (
          <section className={styles.detailCard}>
            <h3 className={styles.detailCardTitle}>
              <span className={styles.detailIcon} aria-hidden="true">BRN</span>
              Brain Regions
            </h3>
            <div className={styles.detailCardBody}>
              <div className={styles.detailChips}>
                {memory.regions.map((r) => (
                  <span key={r.region} className={styles.detailChip}>
                    {humanize(r.region)}
                    <span className={styles.detailChipKind}>{formatPercent(r.weight)}</span>
                  </span>
                ))}
              </div>
            </div>
          </section>
        )}
      </div>
    );
  }

  function renderEntityDetail(id: string | number) {
    const entry = entityDetails[String(id)];
    if (!entry || entry.loading) {
      return <p className={styles.detailMsg}>Loading details…</p>;
    }
    if (entry.error) {
      return (
        <p className={`${styles.detailMsg} ${styles.detailError}`}>
          Unable to load details: {entry.error}
        </p>
      );
    }
    const graph = entry.data;
    if (!graph) return null;

    return (
      <div className={styles.detailGrid}>
        <MetaSection
          title="Entity"
          entries={[
            ["Name", graph.entity.canonical_name],
            ["Kind", capitalize(graph.entity.kind)],
            ["Created", formatDate(graph.entity.created_at)],
          ]}
        />
        <ListSection
          title="Known aliases"
          items={(graph.aliases || []).map((a) => a.alias)}
        />
        <ListSection
          title="Linked memories"
          wide
          items={(graph.memories || []).map(
            (m) => m.summary || m.title || m.raw_text,
          )}
        />
        <ListSection
          title="Explicit relationships"
          wide
          items={(graph.relationships || []).map(
            (r) =>
              `${r.source.canonical_name} ${r.predicate} ${r.target.canonical_name}`,
          )}
        />
        <SuggestionSection
          suggestions={graph.suggestions || []}
          onDecide={(suggestionId, decision) =>
            decideSuggestion(suggestionId, decision, id)
          }
        />
      </div>
    );
  }
}

/* ---------------------------------------------------------------- subcomponents */

/* Fragment wrapper so a data row and its detail row stay sibling <tr>s. */
function RowGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function DetailSection({
  title,
  wide,
  children,
}: {
  title: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={wide ? styles.sectionWide : styles.section}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {children}
    </section>
  );
}

function ListSection({
  title,
  items,
  wide,
}: {
  title: string;
  items: string[];
  wide?: boolean;
}) {
  const values = items.length ? items : ["None"];
  return (
    <section className={wide ? styles.sectionWide : styles.section}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <ul className={styles.list}>
        {values.map((value, i) => (
          <li key={i}>{value}</li>
        ))}
      </ul>
    </section>
  );
}

function SuggestionSection({
  suggestions,
  onDecide,
}: {
  suggestions: EntityResolutionSuggestion[];
  onDecide: (id: number, decision: "merge" | "reject") => Promise<void>;
}) {
  const [pending, setPending] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = async (id: number, decision: "merge" | "reject") => {
    setPending(id);
    setError(null);
    try {
      await onDecide(id, decision);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Review failed");
      setPending(null);
    }
  };

  return (
    <section className={styles.sectionWide}>
      <h2 className={styles.sectionTitle}>Entity resolution review</h2>
      {!suggestions.length ? (
        <p className={styles.detailMsg}>No ambiguous aliases need review.</p>
      ) : (
        <div className={styles.suggestionList}>
          {suggestions.map((s) => {
            const sourceName =
              s.source_name
              || s.source_canonical_name
              || `Entity ${s.source_entity_id}`;
            const targetName =
              s.target_name
              || s.target_canonical_name
              || `Entity ${s.target_entity_id}`;
            const busy = pending === s.id;
            return (
              <article key={s.id} className={styles.suggestionItem}>
                <div>
                  <strong>
                    {sourceName} may be {targetName}
                  </strong>
                  <p>{s.reason || `Ambiguous alias: ${s.alias || "unknown"}`}</p>
                </div>
                <div className={styles.suggestionActions}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => decide(s.id, "merge")}
                  >
                    Merge
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => decide(s.id, "reject")}
                  >
                    Keep separate
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {error ? (
        <p className={`${styles.detailMsg} ${styles.detailError}`}>{error}</p>
      ) : null}
    </section>
  );
}

function MetaSection({
  title,
  entries,
}: {
  title: string;
  entries: [string, string][];
}) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <dl className={styles.meta}>
        {entries.map(([label, value]) => (
          <div key={label} className={styles.metaRow}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
