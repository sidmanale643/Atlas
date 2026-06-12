import { z } from "zod";

// --- Request Schemas ---

export const MemoryRequest = z.object({
  text: z.string().min(1, "text is required").max(180, "text must be 180 characters or fewer"),
  ingestionDate: z.string().datetime().optional(),
});

export const SummaryRequest = z.object({
  summary: z.string(),
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

export const ExtractionSchema = z.object({
  occurredAt: OccurredAtSchema,
  types: z.array(MemoryTypeSchema),
  emotions: z.array(EmotionSchema),
  entities: z.array(EntitySchema),
  relationships: z.array(RelationshipSchema),
  actions: z.array(z.string()),
  topics: z.array(z.string()),
  salience: z.number().min(0).max(1),
  summary: z.string(),
}).superRefine((data, ctx) => {
  const totalWeight = data.types.reduce((sum, t) => sum + t.weight, 0);
  if (totalWeight > 1.0001) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Type weights sum to ${totalWeight.toFixed(3)}, which exceeds 1.0`,
      path: ["types"],
    });
  }
});

export const ExtractionJsonSchema = ExtractionSchema.toJSONSchema();
