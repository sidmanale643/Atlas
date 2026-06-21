import { z } from "zod";

export const SEMANTIC_EXTRACTION_SCHEMA_VERSION = 4;
export const COGNITIVE_ANNOTATION_SCHEMA_VERSION = 1;
export const SEMANTIC_SCHEMA_VERSION = SEMANTIC_EXTRACTION_SCHEMA_VERSION;
export const COGNITIVE_SCHEMA_VERSION = COGNITIVE_ANNOTATION_SCHEMA_VERSION;
// Backward-compatible name used by the existing persistence layer.
export const EXTRACTION_SCHEMA_VERSION = SEMANTIC_EXTRACTION_SCHEMA_VERSION;
export const MEMORY_COMPARISON_SCHEMA_VERSION = 1;

// --- Request Schemas ---

export const MemoryRequest = z.object({
  text: z.string().min(1, "text is required").max(2000, "text must be 2000 characters or fewer"),
  ingestionDate: z.string().datetime().optional(),
});

export const AddMemorySchema = z.object({
  text: z
    .string()
    .min(1, "text is required")
    .max(2000, "text must be 2000 characters or fewer")
    .describe("Conversational text containing one or more durable memories"),
  type: z
    .enum([
      "relationship",
      "preference",
      "fact",
      "decision",
      "learning",
      "event",
      "instruction",
      "observation",
      "error",
    ])
    .optional()
    .describe("Fallback classification for the submitted source"),
  title: z
    .string()
    .min(1, "title is required")
    .max(50, "title must be 50 characters or fewer")
    .optional()
    .describe("Fallback title for the submitted source"),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .default(0.6)
    .describe("Confidence in the memory"),
  tags: z
    .array(z.string().min(1))
    .default([])
    .describe("Tags used to organize the memory"),
});

export const SummaryRequest = z.object({
  summary: z.string(),
});

export const MemoryComparisonRequest = z.object({
  leftMemoryId: z.string().trim().min(1, "leftMemoryId is required"),
  rightMemoryId: z.string().trim().min(1, "rightMemoryId is required"),
  regenerate: z.boolean().optional().default(false),
}).strict().superRefine((data, ctx) => {
  if (data.leftMemoryId === data.rightMemoryId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Memory IDs must be different",
      path: ["rightMemoryId"],
    });
  }
});

// --- LLM Extraction Schema ---

export const OccurredAtSchema = z.object({
  text: z.string(),
  normalized: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

export const MemoryTypeSchema = z.object({
  type: z.enum(["episodic", "semantic", "procedural", "emotional", "spatial", "working"]),
  weight: z.number().min(0).max(1),
});

export const MemoryCategorySchema = z.enum([
  "relationship",
  "preference",
  "fact",
  "decision",
  "learning",
  "event",
  "instruction",
  "observation",
  "error",
]);

export const ContentCueSchema = z.object({
  kind: z.enum(["verbal", "spatial"]),
  weight: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  evidence: z.string().min(1),
});

export const EmotionSchema = z.object({
  label: z.string(),
  valence: z.number().min(-1).max(1),
  arousal: z.number().min(0).max(1),
  intensity: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  evidence: z.string(),
});

export const EntitySchema = z.object({
  mention: z.string(),
  kind: z.enum(["person", "place", "object", "concept", "organization"]),
  canonicalName: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

export const RelationshipSchema = z.object({
  subject: z.string(),
  predicate: z.string(),
  object: z.string(),
  confidence: z.number().min(0).max(1),
  evidence: z.string(),
});

// The legacy schema remains exported so stored extractions can be classified by
// shape during migration. New extraction and persistence use the schemas below.
export const LegacyAtomicMemorySchema = z.object({
  text: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  types: z.array(MemoryTypeSchema).superRefine((types, ctx) => {
    const totalWeight = types.reduce((sum, type) => sum + type.weight, 0);
    if (totalWeight > 1.0001) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Type weights sum to ${totalWeight.toFixed(3)}, which exceeds 1.0`,
      });
    }
  }),
  occurredAt: OccurredAtSchema,
  entities: z.array(EntitySchema),
  relationships: z.array(RelationshipSchema),
  actions: z.array(z.string().min(1)),
  topics: z.array(z.string().min(1)),
}).strict();

export const LegacySemanticExtractionSchema = z.object({
  memories: z.array(LegacyAtomicMemorySchema),
}).strict();

const WeightedMemoryTypesSchema = z.array(MemoryTypeSchema).superRefine(
  (types, ctx) => {
    const totalWeight = types.reduce((sum, type) => sum + type.weight, 0);
    if (totalWeight > 1.0001) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Type weights sum to ${totalWeight.toFixed(3)}, which exceeds 1.0`,
      });
    }
  },
);

const V3TextSchema = (maximum) => z.string().trim().min(1).max(maximum);

function isValidIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d))?$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  return calendarDate.getUTCFullYear() === year
    && calendarDate.getUTCMonth() === month - 1
    && calendarDate.getUTCDate() === day
    && !Number.isNaN(Date.parse(value));
}

export const EvidenceSpanSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  text: z.string().min(1),
}).strict().superRefine((span, ctx) => {
  if (span.end <= span.start) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "evidence span end must be greater than start",
      path: ["end"],
    });
  }
});

export const DurabilitySchema = z.object({
  durable: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: V3TextSchema(500),
}).strict();

export const V3OccurredAtSchema = z.object({
  text: z.string().max(200),
  normalized: z.string().refine(
    isValidIsoDate,
    "normalized must be a valid ISO-8601 date or timestamp",
  ).nullable(),
  confidence: z.number().min(0).max(1),
}).strict();

export const V3MemoryTypeSchema = z.object({
  type: MemoryTypeSchema.shape.type,
  weight: z.number().positive().max(1),
}).strict();

const V3MemoryTypesSchema = z.array(V3MemoryTypeSchema).max(6).superRefine(
  (types, ctx) => {
    const seen = new Set();
    for (const [index, item] of types.entries()) {
      if (seen.has(item.type)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate memory type: ${item.type}`,
          path: [index, "type"],
        });
      }
      seen.add(item.type);
    }
    const totalWeight = types.reduce((sum, item) => sum + item.weight, 0);
    if (totalWeight > 1.0001) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Type weights sum to ${totalWeight.toFixed(3)}, which exceeds 1.0`,
      });
    }
  },
);

const EvidenceSpanIndexesSchema = z.array(
  z.number().int().nonnegative(),
).min(1).max(5).superRefine((indexes, ctx) => {
  if (new Set(indexes).size !== indexes.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "evidence span indexes must be unique",
    });
  }
});

export const V3EntitySchema = z.object({
  mention: V3TextSchema(200),
  kind: EntitySchema.shape.kind,
  canonicalName: V3TextSchema(200).nullable(),
  confidence: z.number().min(0).max(1),
  evidenceSpanIndexes: EvidenceSpanIndexesSchema,
}).strict();

export const V3RelationshipSchema = z.object({
  subject: V3TextSchema(200),
  predicate: V3TextSchema(120),
  object: V3TextSchema(200),
  confidence: z.number().min(0).max(1),
  evidenceSpanIndexes: EvidenceSpanIndexesSchema,
}).strict();

export const AtomicMemorySchema = z.object({
  text: V3TextSchema(2000),
  summary: V3TextSchema(500),
  category: MemoryCategorySchema.optional(),
  evidenceSpans: z.array(EvidenceSpanSchema).min(1).max(5),
  durability: DurabilitySchema,
  boundaryReason: V3TextSchema(500),
  types: V3MemoryTypesSchema,
  occurredAt: V3OccurredAtSchema,
  entities: z.array(V3EntitySchema).max(12),
  relationships: z.array(V3RelationshipSchema).max(12),
  actions: z.array(V3TextSchema(120)).max(8),
  topics: z.array(V3TextSchema(100)).max(8),
}).strict().superRefine((memory, ctx) => {
  for (let index = 1; index < memory.evidenceSpans.length; index += 1) {
    if (memory.evidenceSpans[index].start < memory.evidenceSpans[index - 1].end) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "evidence spans must be ordered and non-overlapping",
        path: ["evidenceSpans", index],
      });
    }
  }
});

export const SemanticExtractionSchema = z.object({
  memories: z.array(AtomicMemorySchema).max(25),
}).strict();

export const SemanticExtractionJsonSchema =
  SemanticExtractionSchema.toJSONSchema();

const LlmEvidenceSpanSchema = z.object({
  text: z.string().min(1),
}).strict();

const LlmAtomicMemorySchema = z.object({
  ...AtomicMemorySchema.shape,
  category: MemoryCategorySchema,
  evidenceSpans: z.array(LlmEvidenceSpanSchema).min(1).max(5),
}).strict();

const LlmSemanticExtractionSchema = z.object({
  memories: z.array(LlmAtomicMemorySchema).max(25),
}).strict();

export const LlmSemanticExtractionJsonSchema =
  LlmSemanticExtractionSchema.toJSONSchema();

export const CognitiveAnnotationSchema = z.object({
  emotions: z.array(EmotionSchema),
  salience: z.number().min(0).max(1),
  contentCues: z.array(ContentCueSchema),
}).strict();

export const CognitiveAnnotationJsonSchema =
  CognitiveAnnotationSchema.toJSONSchema();

export const ExtractionSchema = z.object({
  occurredAt: OccurredAtSchema,
  types: WeightedMemoryTypesSchema,
  emotions: z.array(EmotionSchema),
  entities: z.array(EntitySchema),
  relationships: z.array(RelationshipSchema),
  actions: z.array(z.string()),
  topics: z.array(z.string()),
  contentCues: z.array(ContentCueSchema),
  salience: z.number().min(0).max(1),
  summary: z.string(),
});

export const ExtractionJsonSchema = ExtractionSchema.toJSONSchema();

const ComparisonFindingSchema = z.object({
  statement: z.string().min(1),
  leftEvidence: z.string().min(1).nullable(),
  rightEvidence: z.string().min(1).nullable(),
  confidence: z.number().min(0).max(1),
}).strict();

const TwoSidedComparisonFindingSchema = ComparisonFindingSchema.superRefine(
  (finding, ctx) => {
    if (!finding.leftEvidence) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "leftEvidence is required",
        path: ["leftEvidence"],
      });
    }
    if (!finding.rightEvidence) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "rightEvidence is required",
        path: ["rightEvidence"],
      });
    }
  },
);

export const MemoryComparisonSchema = z.object({
  relationship: z.enum([
    "duplicate",
    "overlapping",
    "complementary",
    "contradictory",
    "unrelated",
    "uncertain",
  ]),
  confidence: z.number().min(0).max(1),
  overview: z.string().min(1),
  sharedFacts: z.array(TwoSidedComparisonFindingSchema),
  differences: z.array(ComparisonFindingSchema).superRefine((findings, ctx) => {
    findings.forEach((finding, index) => {
      if (!finding.leftEvidence && !finding.rightEvidence) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "At least one evidence field is required",
          path: [index],
        });
      }
    });
  }),
  contradictions: z.array(TwoSidedComparisonFindingSchema),
  caveats: z.array(z.string().min(1)),
}).strict();

export const MemoryComparisonJsonSchema =
  MemoryComparisonSchema.toJSONSchema();

export const MemoryWriteDecisionSchema = z.object({
  action: z.enum(["create", "update", "unchanged"]),
  matchedMemoryId: z.string().trim().min(1).nullable(),
  confidence: z.number().min(0).max(1),
  reason: z.string().trim().min(1),
  replacementText: z.string().trim().min(1),
}).strict().superRefine((decision, ctx) => {
  if (decision.action === "create" && decision.matchedMemoryId !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "matchedMemoryId must be null when action is create",
      path: ["matchedMemoryId"],
    });
  }
  if (
    decision.action !== "create" &&
    decision.matchedMemoryId === null
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "matchedMemoryId is required for update and unchanged actions",
      path: ["matchedMemoryId"],
    });
  }
  if (decision.action !== "create" && decision.confidence < 0.85) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "update and unchanged actions require confidence of at least 0.85",
      path: ["confidence"],
    });
  }
});

export const MemoryWriteDecisionJsonSchema =
  MemoryWriteDecisionSchema.toJSONSchema();
