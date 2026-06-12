import assert from "node:assert/strict";
import test from "node:test";

process.env.TOKENROUTER_API_KEY = "test-key";

const { extractMemory } = await import("./llm.js");

test("uses a schema-backed tool call for MiniMax extraction", async (t) => {
  const originalFetch = globalThis.fetch;
  let requestBody;

  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: "",
          tool_calls: [{
            type: "function",
            function: {
              name: "submit_memory_extraction",
              arguments: JSON.stringify({
                occurredAt: {
                  text: "today",
                  normalized: "2026-06-12",
                  confidence: 1,
                },
                types: [{ type: "episodic", weight: 1 }],
                emotions: [],
                entities: [],
                relationships: [],
                actions: ["went jogging"],
                topics: ["jogging"],
                salience: 0.2,
                summary: "The speaker went jogging today.",
              }),
            },
          }],
        },
      }],
    }));
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await extractMemory(
    "I went jogging today.",
    "2026-06-12T00:00:00.000Z",
  );

  assert.equal(requestBody.response_format, undefined);
  assert.deepEqual(requestBody.thinking, { type: "disabled" });
  assert.equal(requestBody.tools[0].function.name, "submit_memory_extraction");
  assert.equal(requestBody.tools[0].function.parameters.type, "object");
  assert.equal(result.summary, "The speaker went jogging today.");
});
