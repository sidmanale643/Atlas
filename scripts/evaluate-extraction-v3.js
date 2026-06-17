#!/usr/bin/env node
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { extractAtomicMemories } from "../src/llm.js";

const fixtureUrl = new URL("../tests/fixtures/extraction-v3-golden.json", import.meta.url);
const cases = JSON.parse(await readFile(fixtureUrl, "utf8"));
const results = [];

for (const fixture of cases) {
  const startedAt = performance.now();
  try {
    const extraction = await extractAtomicMemories(
      fixture.source,
      fixture.ingestionDate,
      { entities: [] },
    );
    const serialized = extraction.memories.map((memory) => memory.text).join("\n");
    const evidenceValid = extraction.memories.every((memory) =>
      memory.evidenceSpans.every((span) =>
        fixture.source.slice(span.start, span.end) === span.text));
    const requiredFactsPresent = fixture.requiredFacts.every((fact) =>
      serialized.toLocaleLowerCase().includes(fact.toLocaleLowerCase()));
    const forbiddenFactsAbsent = fixture.forbiddenFacts.every((fact) =>
      !serialized.toLocaleLowerCase().includes(fact.toLocaleLowerCase()));
    results.push({
      name: fixture.name,
      passed: extraction.memories.length === fixture.expectedAtomCount
        && evidenceValid && requiredFactsPresent && forbiddenFactsAbsent,
      expectedAtomCount: fixture.expectedAtomCount,
      actualAtomCount: extraction.memories.length,
      evidenceValid,
      requiredFactsPresent,
      forbiddenFactsAbsent,
      latencyMs: Math.round(performance.now() - startedAt),
    });
  } catch (error) {
    results.push({
      name: fixture.name,
      passed: false,
      error: error.message,
      latencyMs: Math.round(performance.now() - startedAt),
    });
  }
}

const passed = results.filter((result) => result.passed).length;
console.log(JSON.stringify({
  model: process.env.TOKENROUTER_MODEL || process.env.OPENROUTER_MODEL || null,
  schemaVersion: 3,
  cases: results.length,
  passed,
  passRate: results.length ? passed / results.length : 0,
  results,
}, null, 2));
process.exitCode = passed === results.length ? 0 : 1;
