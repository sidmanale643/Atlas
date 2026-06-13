import assert from "node:assert/strict";
import test from "node:test";

process.env.TOKENROUTER_API_KEY = "test-key";

const {
  compareMemories,
  decideMemoryWrite,
  extractMemory,
} = await import("../src/llm.js");

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
                contentCues: [],
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
  assert.ok(
    requestBody.tools[0].function.parameters.required.includes("contentCues"),
  );
  assert.equal(result.summary, "The speaker went jogging today.");
});

test("uses a schema-backed tool call and validates comparison evidence", async (t) => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      choices: [{
        message: {
          tool_calls: [{
            type: "function",
            function: {
              name: "submit_memory_comparison",
              arguments: JSON.stringify({
                relationship: "overlapping",
                confidence: 0.9,
                overview: "Both memories involve Maya.",
                sharedFacts: [{
                  statement: "Maya appears in both memories.",
                  leftEvidence: "Maya",
                  rightEvidence: "Maya",
                  confidence: 1,
                }],
                differences: [{
                  statement: "The actions differ.",
                  leftEvidence: "visited",
                  rightEvidence: "called",
                  confidence: 0.95,
                }],
                contradictions: [],
                caveats: [],
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

  const result = await compareMemories(
    { id: "left", raw_text: "Maya visited the museum." },
    { id: "right", raw_text: "Maya called later." },
  );

  assert.equal(
    requestBody.tools[0].function.name,
    "submit_memory_comparison",
  );
  assert.equal(requestBody.tools[0].function.parameters.type, "object");
  assert.equal(result.relationship, "overlapping");
});

test("drops comparison findings with evidence not in memory text or summary", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({
      choices: [{
        message: {
          tool_calls: [{
            type: "function",
            function: {
              name: "submit_memory_comparison",
              arguments: JSON.stringify({
                relationship: "overlapping",
                confidence: 0.8,
                overview: "Both involve Maya.",
                sharedFacts: [
                  {
                    statement: "Both involve Maya.",
                    leftEvidence: "Maya",
                    rightEvidence: "Maya Patel",
                    confidence: 1,
                  },
                  {
                    statement: "Both mention a visit.",
                    leftEvidence: "visited",
                    rightEvidence: "called",
                    confidence: 0.9,
                  },
                ],
                differences: [],
                contradictions: [],
                caveats: [],
              }),
            },
          }],
        },
      }],
    }));
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await compareMemories(
    { id: "left", raw_text: "Maya visited." },
    { id: "right", raw_text: "Maya called." },
  );

  assert.equal(result.sharedFacts.length, 1);
  assert.equal(result.sharedFacts[0].statement, "Both mention a visit.");
  assert.equal(result.sharedFacts[0].leftEvidence, "visited");
  assert.equal(result.sharedFacts[0].rightEvidence, "called");
});

test("recovers fenced comparison JSON and normalizes evidence casing", async (t) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: `Here is the result:
\`\`\`json
${JSON.stringify({
  relationship: "overlapping",
  confidence: 0.8,
  overview: "Both memories mention Maya.",
  sharedFacts: [{
    statement: "Both mention Maya.",
    leftEvidence: "maya",
    rightEvidence: "maya",
    confidence: 1,
  }],
  differences: [],
  contradictions: [],
  caveats: [],
})}
\`\`\``,
        },
      }],
    }));
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await compareMemories(
    { id: "left", raw_text: "Maya visited." },
    { id: "right", raw_text: "Maya called." },
  );
  assert.equal(calls, 1);
  assert.equal(result.sharedFacts[0].leftEvidence, "Maya");
  assert.equal(result.sharedFacts[0].rightEvidence, "Maya");
});

test("normalizes quotation marks added around exact evidence", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({
      choices: [{
        message: {
          tool_calls: [{
            type: "function",
            function: {
              name: "submit_memory_comparison",
              arguments: JSON.stringify({
                relationship: "overlapping",
                confidence: 0.9,
                overview: "Both memories reference swimming.",
                sharedFacts: [{
                  statement: "Both memories reference swimming.",
                  leftEvidence: "swimming",
                  rightEvidence: "I am going swimming today",
                  confidence: 0.9,
                }],
                differences: [{
                  statement: "Only the right memory states a plan.",
                  leftEvidence: "  \"swimming\"  ",
                  rightEvidence: "The speaker plans to go swimming today.",
                  confidence: 0.9,
                }],
                contradictions: [],
                caveats: [],
              }),
            },
          }],
        },
      }],
    }));
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await compareMemories(
    {
      id: "left",
      raw_text: "swimming",
      summary: "Standalone word \"swimming,\" likely referring to the activity.",
    },
    {
      id: "right",
      raw_text: "I am going swimming today",
      summary: "The speaker plans to go swimming today.",
    },
  );

  assert.equal(result.differences[0].leftEvidence, "swimming");
});

test("retries once after malformed comparison output", async (t) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    const message = calls === 1
      ? { content: "not valid json" }
      : {
          tool_calls: [{
            type: "function",
            function: {
              name: "submit_memory_comparison",
              arguments: JSON.stringify({
                relationship: "unrelated",
                confidence: 0.7,
                overview: "The memories describe different subjects.",
                sharedFacts: [],
                differences: [{
                  statement: "The subjects differ.",
                  leftEvidence: "Maya",
                  rightEvidence: "Paris",
                  confidence: 1,
                }],
                contradictions: [],
                caveats: [],
              }),
            },
          }],
        };
    return new Response(JSON.stringify({ choices: [{ message }] }));
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await compareMemories(
    { id: "left", raw_text: "Maya visited." },
    { id: "right", raw_text: "Paris is large." },
  );
  assert.equal(calls, 2);
  assert.equal(result.relationship, "unrelated");
});

test("requests and validates a structured memory write decision", async (t) => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      choices: [{
        message: {
          tool_calls: [{
            type: "function",
            function: {
              name: "submit_memory_write_decision",
              arguments: JSON.stringify({
                action: "update",
                matchedMemoryId: "mem_coffee",
                confidence: 0.94,
                reason: "The same preference has a new value.",
                replacementText: "I prefer tea.",
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

  const result = await decideMemoryWrite(
    {
      text: "I prefer tea now.",
      type: "preference",
      summary: "The speaker prefers tea.",
    },
    [{
      id: "mem_coffee",
      raw_text: "I prefer coffee.",
      type: "preference",
      summary: "The speaker prefers coffee.",
    }],
  );

  assert.equal(
    requestBody.tools[0].function.name,
    "submit_memory_write_decision",
  );
  assert.equal(requestBody.tools[0].function.parameters.additionalProperties, false);
  assert.match(requestBody.messages[0].content, /distinct events, observations, errors, or learnings/i);
  assert.match(requestBody.messages[0].content, /ambiguous/i);
  assert.match(requestBody.messages[0].content, /at least 0\.85/i);
  assert.deepEqual(
    JSON.parse(requestBody.messages[1].content).candidates[0],
    {
      id: "mem_coffee",
      text: "I prefer coffee.",
      type: "preference",
      title: null,
      summary: "The speaker prefers coffee.",
      tags: [],
    },
  );
  assert.deepEqual(result, {
    action: "update",
    matchedMemoryId: "mem_coffee",
    confidence: 0.94,
    reason: "The same preference has a new value.",
    replacementText: "I prefer tea.",
  });
});

test("rejects a memory write match outside the supplied candidates", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({
      choices: [{
        message: {
          tool_calls: [{
            type: "function",
            function: {
              name: "submit_memory_write_decision",
              arguments: JSON.stringify({
                action: "unchanged",
                matchedMemoryId: "mem_invented",
                confidence: 0.99,
                reason: "The memories are equivalent.",
                replacementText: "I prefer coffee.",
              }),
            },
          }],
        },
      }],
    }));
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await assert.rejects(
    () => decideMemoryWrite(
      { text: "I prefer coffee." },
      [{ id: "mem_coffee", raw_text: "I prefer coffee." }],
    ),
    /matchedMemoryId is not a supplied candidate: mem_invented/,
  );
});

test("rejects low-confidence update decisions", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({
      choices: [{
        message: {
          tool_calls: [{
            type: "function",
            function: {
              name: "submit_memory_write_decision",
              arguments: JSON.stringify({
                action: "update",
                matchedMemoryId: "mem_1",
                confidence: 0.84,
                reason: "This may be the same fact.",
                replacementText: "The launch is Tuesday.",
              }),
            },
          }],
        },
      }],
    }));
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await assert.rejects(
    () => decideMemoryWrite(
      { text: "The launch is Tuesday." },
      [{ id: "mem_1", raw_text: "The launch is Monday." }],
    ),
    /require confidence of at least 0\.85/,
  );
});
