export type EntityKind =
  | "person"
  | "place"
  | "object"
  | "concept"
  | "organization";

export type MemorySource = "ui" | "mcp";

export interface Entity {
  id: number;
  canonical_name: string;
  kind: EntityKind;
  confidence?: number;
}

export interface Relationship {
  id: number;
  predicate: string;
  memory_id: string;
  confidence: number;
  evidence: string;
  created_at?: string;
  source: { id: number; canonical_name: string; kind: EntityKind };
  target: { id: number; canonical_name: string; kind: EntityKind };
  // legacy flat fields sometimes present
  source_name?: string;
  target_name?: string;
}

export interface RegionActivation {
  region: string;
  weight: number;
}

export interface Extraction {
  summary?: string;
  salience?: number;
  types?: { type: string; weight: number }[];
  emotions?: { label: string; intensity?: number }[];
  topics?: string[];
  [key: string]: unknown;
}

export interface Memory {
  id: string;
  raw_text: string;
  ingestion_date: string;
  summary: string;
  type: string;
  title: string;
  confidence: number;
  tags: string[];
  scope: string;
  source: MemorySource;
  created_at: string;
  updated_at: string;
  extraction?: Extraction | { extraction_json?: Extraction; model?: string; schema_version?: number };
  entities: Entity[];
  relationships: Relationship[];
  regions: RegionActivation[];
  similarity?: number;
}

export interface CatalogResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface MemoryCatalogItem {
  id: string;
  title: string;
  summary: string;
  raw_text: string;
  type: string;
  source: MemorySource;
  confidence: number;
  created_at: string;
  entities: Entity[];
}

export interface EntityCatalogItem {
  id: number;
  canonical_name: string;
  kind: EntityKind;
  memory_count: number;
  relationship_count: number;
  alias_count: number;
  pending_suggestion_count: number;
  created_at: string;
}

export interface ComparisonResult {
  left: Memory;
  right: Memory;
  structuralDiff: unknown;
  analysis: {
    relationship: string;
    confidence: number;
    overview: string;
    sharedFacts: ComparisonFact[];
    differences: ComparisonFact[];
    contradictions: ComparisonFact[];
    caveats: string[];
  } | null;
  generation: {
    cached: boolean;
    saved: boolean;
    model: string;
    schemaVersion: number;
    inputHash: string;
    generatedAt: string | null;
  };
  error?: string;
  detail?: string;
}

export interface ComparisonFact {
  statement: string;
  leftEvidence?: string;
  rightEvidence?: string;
  confidence: number;
}

export interface GraphNode {
  id: string;
  label: string;
  type: "memory" | "entity";
  memoryType?: string;
  kind?: EntityKind;
  [key: string]: unknown;
}

export interface GraphEdge {
  source: string;
  target: string;
  label?: string;
  predicate?: string;
  [key: string]: unknown;
}

export interface GraphData {
  nodes: GraphNode[];
  edges?: GraphEdge[];
  links?: GraphEdge[];
}
