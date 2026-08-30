import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  filterFilesByExclude,
  isQuotaError,
  parseReviewResult,
  pathExcluded,
  processFindings,
} from "../src/findings";
import { buildDiffContext } from "../src/github/diff";
import { renderFindingBody } from "../src/github/review";
import type { PullFile, ReviewFinding, ReviewResult } from "../src/types";

const patch = readFileSync(join(__dirname, "fixtures", "modified-file.patch"), "utf8");

function contextFromPatch(): ReturnType<typeof buildDiffContext> {
  const files: PullFile[] = [
    {
      filename: "src/auth.ts",
      status: "modified",
      additions: 2,
      deletions: 1,
      changes: 3,
      patch,
    },
  ];
  return buildDiffContext(files);
}

function finding(over: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    path: "src/auth.ts",
    line: 13,
    side: "RIGHT",
    severity: "high",
    category: "bug",
    title: "Token leak",
    body: "The token is returned without hashing.",
    confidence: 0.9,
    ...over,
  };
}

describe("parseReviewResult", () => {
  it("accepts a valid structured_output payload", () => {
    const result = parseReviewResult({
      summary: "One issue.",
      verdict: "comment",
      findings: [finding()],
    });
    assert.equal(result.findings.length, 1);
    assert.equal(result.verdict, "comment");
  });

  it("drops malformed findings instead of failing the whole review", () => {
    const result = parseReviewResult({
      summary: "ok",
      verdict: "approve",
      findings: [{ path: "x.ts" }, finding()],
    });
    assert.equal(result.findings.length, 1);
  });

  it("rejects a missing verdict", () => {
    assert.throws(() => parseReviewResult({ summary: "x", findings: [] }));
  });
});

describe("processFindings", () => {
  const context = contextFromPatch();
  const config = { minConfidence: 0.7, minSeverity: "medium" as const, maxComments: 20 };

  it("keeps an exact commentable finding", () => {
    const processed = processFindings(
      { summary: "", verdict: "comment", findings: [finding()] },
      context,
      config,
    );
    assert.equal(processed.inline.length, 1);
    assert.equal(processed.inline[0].line, 13);
  });

  it("drops findings on paths that are not in the diff", () => {
    const processed = processFindings(
      { summary: "", verdict: "comment", findings: [finding({ path: "nope.ts" })] },
      context,
      config,
    );
    assert.equal(processed.inline.length, 0);
    assert.equal(processed.dropped.length, 1);
  });

  it("demotes findings that cannot snap onto a hunk", () => {
    const processed = processFindings(
      { summary: "", verdict: "comment", findings: [finding({ line: 900 })] },
      context,
      config,
    );
    assert.equal(processed.inline.length, 0);
    assert.equal(processed.demoted.length, 1);
  });

  it("snaps a near-miss onto the hunk instead of dropping it", () => {
    const processed = processFindings(
      { summary: "", verdict: "comment", findings: [finding({ line: 16 })] },
      context,
      config,
    );
    assert.equal(processed.inline.length, 1);
    assert.notEqual(processed.inline[0].line, 16);
  });

  it("filters by confidence and severity", () => {
    const processed = processFindings(
      {
        summary: "",
        verdict: "comment",
        findings: [
          finding({ confidence: 0.2, title: "low conf" }),
          finding({ severity: "low", title: "low sev", line: 8 }),
        ],
      },
      context,
      config,
    );
    assert.equal(processed.inline.length, 0);
    assert.equal(processed.dropped.length, 2);
  });

  it("ranks by severity then confidence and caps inline comments", () => {
    const findings: ReviewFinding[] = [
      finding({ severity: "medium", confidence: 0.99, title: "med", line: 8 }),
      finding({ severity: "critical", confidence: 0.71, title: "crit", line: 13 }),
      finding({ severity: "high", confidence: 0.95, title: "high", line: 9 }),
    ];
    const processed = processFindings(
      { summary: "", verdict: "comment", findings },
      context,
      { ...config, maxComments: 2 },
    );
    assert.equal(processed.inline.length, 2);
    assert.equal(processed.inline[0].title, "crit");
    assert.equal(processed.demoted.length, 1);
  });
});

describe("suggestion rendering", () => {
  it("wraps a suggestion in a GitHub suggestion fence", () => {
    const body = renderFindingBody(
      finding({ suggestion: "  return hash(session);\n" }),
    );
    assert.match(body, /```suggestion\n {2}return hash\(session\);\n```/);
  });
});

describe("exclude globs", () => {
  it("matches lockfiles and generated paths", () => {
    assert.equal(pathExcluded("package-lock.json", ["**/package-lock.json"]), true);
    assert.equal(pathExcluded("dist/index.js", ["**/dist/**"]), true);
    assert.equal(pathExcluded("src/main.ts", ["**/dist/**"]), false);
  });

  it("filters a file list", () => {
    const kept = filterFilesByExclude(
      [{ filename: "src/a.ts" }, { filename: "yarn.lock" }],
      ["**/yarn.lock"],
    );
    assert.deepEqual(
      kept.map((f) => f.filename),
      ["src/a.ts"],
    );
  });
});

describe("quota detection", () => {
  it("recognizes quota and rate-limit phrasing", () => {
    assert.equal(isQuotaError("RESOURCE_EXHAUSTED: quota"), true);
    assert.equal(isQuotaError("rate limit exceeded"), true);
    assert.equal(isQuotaError("HTTP 429 Too Many Requests"), true);
    assert.equal(isQuotaError("weekly limit reached"), true);
    assert.equal(isQuotaError("model not found"), false);
  });
});

describe("empty findings", () => {
  it("is a valid review result", () => {
    const result: ReviewResult = parseReviewResult({
      summary: "Clean.",
      verdict: "approve",
      findings: [],
    });
    const processed = processFindings(result, contextFromPatch(), {
      minConfidence: 0.7,
      minSeverity: "medium",
      maxComments: 20,
    });
    assert.equal(processed.inline.length, 0);
  });
});
