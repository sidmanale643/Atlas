import type {
  CatalogResponse,
  ComparisonResult,
  EntityCatalogItem,
  GraphData,
  Memory,
  MemoryCatalogItem,
} from "./types";

/* A pending alias-merge suggestion surfaced in an entity's resolution review. */
export type EntityResolutionSuggestion = {
  id: number;
  alias?: string;
  reason?: string;
  source_entity_id?: number;
  source_name?: string;
  source_canonical_name?: string;
  target_entity_id?: number;
  target_name?: string;
  target_canonical_name?: string;
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message =
      data && typeof data.error === "string"
        ? data.error
        : `Request failed (${res.status})`;
    const error = new Error(message) as Error & { payload?: unknown; status?: number };
    error.payload = data;
    error.status = res.status;
    throw error;
  }
  return data as T;
}

function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

export const api = {
  listMemories: (params: { limit?: number; offset?: number; source?: string } = {}) =>
    request<Memory[]>(`/api/memories${qs(params)}`),

  getMemory: (id: string) => request<Memory>(`/api/memories/${encodeURIComponent(id)}`),

  createMemory: (text: string) =>
    request<Memory>("/api/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }),

  deleteMemory: (id: string) =>
    request<{ ok: true }>(`/api/memories/${encodeURIComponent(id)}`, { method: "DELETE" }),

  deleteAllMemories: () => request<{ ok: true }>("/api/memories", { method: "DELETE" }),

  searchMemories: (q: string, limit = 12) =>
    request<{ query: string; memories: Memory[] }>(
      `/api/memories/search${qs({ q, limit })}`,
    ),

  catalogMemories: (params: Record<string, string | number | undefined>) =>
    request<CatalogResponse<MemoryCatalogItem>>(`/api/catalog/memories${qs(params)}`),

  catalogEntities: (params: Record<string, string | number | undefined>) =>
    request<CatalogResponse<EntityCatalogItem>>(`/api/catalog/entities${qs(params)}`),

  entityGraph: (id: number) =>
    request<{
      entity: { id: number; canonical_name: string; kind: string; created_at: string };
      aliases: { alias: string }[];
      memories: Memory[];
      relationships: { source: { canonical_name: string }; predicate: string; target: { canonical_name: string } }[];
      suggestions: EntityResolutionSuggestion[];
    }>(`/api/entities/${id}/graph`),

  resolveSuggestion: (suggestionId: number, decision: "merge" | "reject") =>
    request<unknown>(
      `/api/entity-resolution/suggestions/${encodeURIComponent(suggestionId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      },
    ),

  compare: (leftMemoryId: string, rightMemoryId: string, regenerate = false) =>
    request<ComparisonResult>("/api/memory-comparisons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leftMemoryId, rightMemoryId, regenerate }),
    }),

  graph: () => request<GraphData>("/api/graph"),
};
