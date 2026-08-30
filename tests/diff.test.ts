import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  annotatePatch,
  buildDiffContext,
  isCommentable,
  parsePatch,
  snapToCommentable,
} from "../src/github/diff";
import type { PullFile } from "../src/types";

const fixtures = join(__dirname, "fixtures");

function load(name: string): string {
  return readFileSync(join(fixtures, name), "utf8");
}

describe("parsePatch", () => {
  it("maps added, removed, and context lines from a recorded GitHub patch", () => {
    const patch = load("modified-file.patch");
    const { hunks, commentable } = parsePatch("src/auth.ts", patch);

    assert.equal(hunks.length, 1);
    // Old 8–14 / new 8–15: removed return is LEFT 13, added token is RIGHT 13.
    assert.ok(commentable.some((p) => p.side === "RIGHT" && p.line === 13));
    assert.ok(commentable.some((p) => p.side === "LEFT" && p.line === 13));
    assert.ok(commentable.some((p) => p.side === "RIGHT" && p.line === 8));
  });

  it("treats a new file as RIGHT-side lines starting at 1", () => {
    const patch = load("new-file.patch");
    const { commentable } = parsePatch("src/new.ts", patch);
    const right = commentable.filter((p) => p.side === "RIGHT").map((p) => p.line);
    assert.deepEqual(right, [1, 2, 3, 4]);
    assert.equal(
      commentable.filter((p) => p.side === "LEFT").length,
      0,
    );
  });

  it("treats a deleted file as LEFT-side lines", () => {
    const patch = load("deleted-file.patch");
    const { commentable } = parsePatch("src/gone.ts", patch);
    const left = commentable.filter((p) => p.side === "LEFT").map((p) => p.line);
    assert.deepEqual(left, [1, 2, 3]);
  });

  it("parses multiple hunks independently", () => {
    const patch = load("multi-hunk.patch");
    const { hunks, commentable } = parsePatch("src/util.ts", patch);
    assert.equal(hunks.length, 2);
    assert.ok(commentable.some((p) => p.side === "RIGHT" && p.line === 4));
    assert.ok(commentable.some((p) => p.side === "RIGHT" && p.line === 40));
  });
});

describe("annotatePatch", () => {
  it("tags added lines with RIGHT and removed lines with LEFT", () => {
    const annotated = annotatePatch("src/auth.ts", load("modified-file.patch"));
    assert.match(annotated, /\[RIGHT 12\] \+.*token/);
    assert.match(annotated, /\[LEFT {2}\d+\] -/);
  });
});

describe("commentable map and snap", () => {
  const files: PullFile[] = [
    {
      filename: "src/auth.ts",
      status: "modified",
      additions: 2,
      deletions: 1,
      changes: 3,
      patch: load("modified-file.patch"),
    },
  ];
  const context = buildDiffContext(files);

  it("accepts exact commentable positions", () => {
    assert.equal(isCommentable(context, "src/auth.ts", 13, "RIGHT"), true);
  });

  it("rejects lines outside the diff", () => {
    assert.equal(isCommentable(context, "src/auth.ts", 999, "RIGHT"), false);
    assert.equal(isCommentable(context, "other.ts", 13, "RIGHT"), false);
  });

  it("snaps a near-miss to the nearest line in the same hunk", () => {
    const snapped = snapToCommentable(context, "src/auth.ts", 16, "RIGHT", 3);
    assert.ok(snapped);
    assert.equal(snapped.side, "RIGHT");
    assert.equal(snapped.path, "src/auth.ts");
    assert.ok(Math.abs(snapped.line - 16) <= 3);
  });

  it("does not snap when the line is far from every hunk", () => {
    const snapped = snapToCommentable(context, "src/auth.ts", 400, "RIGHT", 3);
    assert.equal(snapped, undefined);
  });

  it("counts patch bytes and changed lines", () => {
    assert.ok(context.totalPatchBytes > 0);
    assert.equal(context.totalChangedLines, 3);
    assert.ok(context.changedPaths.has("src/auth.ts"));
  });
});
