import { z } from "zod";
import {
  formatAddSummary,
  printError,
  printJson,
} from "../format.js";

const TYPE_VALUES = [
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

const AddInputSchema = z.object({
  text: z
    .string()
    .min(1, "text is required")
    .max(2000, "text must be 2000 characters or fewer"),
  type: z.enum(TYPE_VALUES).optional(),
  title: z
    .string()
    .min(1, "title must not be empty")
    .max(50, "title must be 50 characters or fewer")
    .optional(),
  confidence: z.number().min(0).max(1).optional(),
  tags: z.array(z.string().min(1)).optional(),
});

const HELP = `Usage: atlas add <text...> [options]

Save a NEW personal memory. The text is split into atomic memories, each
matched against existing memories, and either created, updated, or left
unchanged based on similarity. The LLM infers a per-atom type from the
extraction; --type is an optional caller-level fallback.

Options:
  --type <enum>        Optional fallback: relationship | preference | fact |
                       decision | learning | event | instruction | observation |
                       error
  --title <str>        Optional short title (max 50 chars).
  --confidence <0-1>   Optional confidence in the memory. Default: 0.6
  --tags a,b,c         Comma-separated tags. Repeat to add more.
  --json               Emit the raw result object instead of a summary.
`;

export const meta = {
  name: "add",
  help: HELP,
  options: ["type", "title", "confidence", "tags", "json"],
};

export async function run({ positional, flags, deps, json }) {
  const text = positional.join(" ").trim();
  if (!text) {
    printError("add requires text. Try: atlas add \"I prefer dark roast coffee\"");
    return { exitCode: 2 };
  }

  const parsed = AddInputSchema.safeParse({
    text,
    type: flags.type,
    title: flags.title,
    confidence: flags.confidence,
    tags: flags.tags,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    printError(`${issue.path.join(".") || "input"}: ${issue.message}`);
    return { exitCode: 2 };
  }

  const { type, title, confidence, tags } = parsed.data;
  const metadata = {};
  if (type !== undefined) metadata.type = type;
  if (title !== undefined) metadata.title = title;
  if (confidence !== undefined) metadata.confidence = confidence;
  if (tags !== undefined) metadata.tags = tags;

  try {
    await deps.getModel();
    const { memories } = await deps.ingestionService.ingest({
      text: parsed.data.text,
      source: "cli",
      metadata,
    });

    if (json) {
      printJson({ memories });
    } else {
      console.log(formatAddSummary(memories));
    }
    return { exitCode: 0 };
  } catch (error) {
    printError(`Could not add memory: ${error.message}`);
    return { exitCode: 1 };
  }
}
