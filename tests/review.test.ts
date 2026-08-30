import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  encodeState,
  parseStateMarker,
  renderSummaryBody,
  STATE_MARKER_PREFIX,
} from "../src/github/review";

describe("sticky state marker", () => {
  it("round-trips lastSha through a comment body", () => {
    const marker = encodeState({ lastSha: "abc123def", lastReviewedAt: "2026-08-30T00:00:00.000Z" });
    const body = `## Antigravity PR review\n\nLooks good.\n\n${marker}`;
    const parsed = parseStateMarker(body);
    assert.deepEqual(parsed, {
      lastSha: "abc123def",
      lastReviewedAt: "2026-08-30T00:00:00.000Z",
    });
    assert.ok(marker.startsWith(STATE_MARKER_PREFIX));
  });

  it("returns undefined for comments without a marker", () => {
    assert.equal(parseStateMarker("just a comment"), undefined);
  });

  it("returns undefined for a truncated marker", () => {
    assert.equal(parseStateMarker("<!-- pr-auto-review:state {\"lastSha\""), undefined);
  });
});

describe("renderSummaryBody", () => {
  it("includes demoted findings and the COMMENT-only disclaimer", () => {
    const md = renderSummaryBody({
      verdict: "comment",
      summary: "Two issues.",
      model: "gemini-3.1-pro-high",
      headSha: "0123456789abcdef",
      inlineCount: 1,
      demoted: [
        {
          path: "src/a.ts",
          line: 3,
          side: "RIGHT",
          severity: "high",
          category: "bug",
          title: "Off-diff",
          body: "Could not attach.",
          confidence: 0.8,
        },
      ],
      usageTokens: 14000,
      incremental: true,
    });
    assert.match(md, /Two issues/);
    assert.match(md, /Off-diff/);
    assert.match(md, /never approves/);
    assert.match(md, /Incremental/);
    assert.match(md, /14000/);
  });
});
