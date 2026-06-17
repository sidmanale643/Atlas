import { z } from "zod";

export const SEMANTIC_EXTRACTION_SCHEMA_VERSION = 2;
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
    .describe("Fallback classification for the submitted source"),
  title: z
    .string()
    .min(1, "title is required")
    .max(50, "title must be 50 characters or fewer")
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

export const AtomicMemorySchema = z.object({
  text: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  types: WeightedMemoryTypesSchema,
  occurredAt: OccurredAtSchema,
  entities: z.array(EntitySchema),
  relationships: z.array(RelationshipSchema),
  actions: z.array(z.string().min(1)),
  topics: z.array(z.string().min(1)),
}).strict();

export const SemanticExtractionSchema = z.object({
  memories: z.array(AtomicMemorySchema),
}).strict();

export const SemanticExtractionJsonSchema =
  SemanticExtractionSchema.toJSONSchema();

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
