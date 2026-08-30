import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEnvelope, parseTimeoutMs } from "../src/agy/run";
import { FINDINGS_SCHEMA, findingsSchemaJson } from "../src/agy/schema";
import { buildReviewPrompt } from "../src/agy/prompt";
import { buildDiffContext } from "../src/github/diff";
import type { PullFile } from "../src/types";

describe("parseTimeoutMs", () => {
  it("parses m/s/h suffixes", () => {
    assert.equal(parseTimeoutMs("15m"), 15 * 60 * 1000);
    assert.equal(parseTimeoutMs("30s"), 30_000);
    assert.equal(parseTimeoutMs("1h"), 60 * 60 * 1000);
    assert.equal(parseTimeoutMs("500ms"), 500);
  });
});

describe("parseEnvelope", () => {
  it("reads a json-mode envelope", () => {
    const env = parseEnvelope(
      JSON.stringify({
        status: "SUCCESS",
        structured_output: { summary: "ok", verdict: "approve", findings: [] },
        usage: { total_tokens: 10 },
      }),
    );
    assert.equal(env.status, "SUCCESS");
    assert.equal(env.usage?.total_tokens, 10);
  });

  it("prefers the last stream-json result event", () => {
    const stdout = [
      JSON.stringify({ event: "init", init: {} }),
      JSON.stringify({ event: "result", result: { status: "ERROR", error: "first" } }),
      JSON.stringify({
        event: "result",
        result: { status: "SUCCESS", structured_output: { summary: "done" } },
      }),
    ].join("\n");
    const env = parseEnvelope(stdout);
    assert.equal(env.status, "SUCCESS");
    assert.deepEqual(env.structured_output, { summary: "done" });
  });

  it("throws when stdout has no JSON", () => {
    assert.throws(() => parseEnvelope("not json"), /no JSON envelope/);
  });
});

describe("findings schema", () => {
  it("matches the plan's required shape", () => {
    assert.deepEqual(FINDINGS_SCHEMA.required, ["summary", "verdict", "findings"]);
    const json = JSON.parse(findingsSchemaJson()) as typeof FINDINGS_SCHEMA;
    assert.equal(json.properties.verdict.enum.length, 3);
  });
});

describe("buildReviewPrompt", () => {
  it("embeds annotated line tags and incremental instructions", () => {
    const files: PullFile[] = [
      {
        filename: "src/a.ts",
        status: "added",
        additions: 1,
        deletions: 0,
        changes: 1,
        patch: "@@ -0,0 +1,1 @@\n+export const x = 1;\n",
      },
    ];
    const prompt = buildReviewPrompt(
      {
        title: "Add x",
        body: "n/a",
        author: "octocat",
        baseRef: "main",
        headRef: "feat",
        incremental: true,
        sinceSha: "deadbeef",
      },
      buildDiffContext(files),
    );
    assert.match(prompt, /\[RIGHT 1\] \+export const x = 1;/);
    assert.match(prompt, /incremental review of commits after deadbeef/);
    assert.match(prompt, /Do not modify files/);
  });
});
