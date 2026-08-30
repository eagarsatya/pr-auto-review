import type {
  CommentablePosition,
  DiffContext,
  DiffHunk,
  FileDiff,
  PullFile,
  Side,
} from "../types";
import { positionKey } from "../types";

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parsePatch(path: string, patch: string): { hunks: DiffHunk[]; commentable: CommentablePosition[] } {
  const hunks: DiffHunk[] = [];
  const commentable: CommentablePosition[] = [];
  let current: DiffHunk | undefined;
  let leftLine = 0;
  let rightLine = 0;

  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  for (const raw of lines) {
    const header = raw.match(HUNK_RE);
    if (header) {
      current = {
        path,
        leftStart: Number(header[1]),
        leftCount: header[2] === undefined ? 1 : Number(header[2]),
        rightStart: Number(header[3]),
        rightCount: header[4] === undefined ? 1 : Number(header[4]),
        leftLines: [],
        rightLines: [],
      };
      hunks.push(current);
      leftLine = current.leftStart;
      rightLine = current.rightStart;
      continue;
    }

    if (!current) continue;
    if (raw.startsWith("\\")) continue;
    // Trailing newline after split becomes ""; real empty context is " ".
    if (raw === "") continue;

    const marker = raw[0];
    if (marker === "+") {
      commentable.push({ path, line: rightLine, side: "RIGHT" });
      current.rightLines.push(rightLine);
      rightLine += 1;
    } else if (marker === "-") {
      commentable.push({ path, line: leftLine, side: "LEFT" });
      current.leftLines.push(leftLine);
      leftLine += 1;
    } else if (marker === " " || raw === "") {
      // Context lines are commentable on the new (RIGHT) side, which is
      // what GitHub's review API accepts for unchanged lines in a hunk.
      if (current.rightCount > 0 && rightLine > 0) {
        commentable.push({ path, line: rightLine, side: "RIGHT" });
        current.rightLines.push(rightLine);
      }
      if (current.leftCount > 0 && leftLine > 0) {
        current.leftLines.push(leftLine);
      }
      if (current.leftCount > 0) leftLine += 1;
      if (current.rightCount > 0) rightLine += 1;
    }
  }

  return { hunks, commentable };
}

export function annotatePatch(path: string, patch: string): string {
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [`--- ${path}`];
  let leftLine = 0;
  let rightLine = 0;

  for (const raw of lines) {
    const header = raw.match(HUNK_RE);
    if (header) {
      leftLine = Number(header[1]);
      rightLine = Number(header[3]);
      out.push(raw);
      continue;
    }
    if (raw.startsWith("\\")) {
      out.push(raw);
      continue;
    }
    if (raw === "") continue;

    const marker = raw[0] ?? " ";
    const content = raw.slice(1);
    if (marker === "+") {
      out.push(`[RIGHT ${rightLine}] +${content}`);
      rightLine += 1;
    } else if (marker === "-") {
      out.push(`[LEFT  ${leftLine}] -${content}`);
      leftLine += 1;
    } else {
      out.push(`[RIGHT ${rightLine}]  ${content}`);
      if (leftLine > 0) leftLine += 1;
      if (rightLine > 0) rightLine += 1;
    }
  }

  return out.join("\n");
}

export function buildDiffContext(files: PullFile[]): DiffContext {
  const fileDiffs: FileDiff[] = [];
  const commentableKeys = new Set<string>();
  const changedPaths = new Set<string>();
  let totalPatchBytes = 0;
  let totalChangedLines = 0;

  for (const file of files) {
    changedPaths.add(file.filename);
    if (file.previousFilename) changedPaths.add(file.previousFilename);
    totalChangedLines += file.additions + file.deletions;
    const patch = file.patch ?? "";
    totalPatchBytes += Buffer.byteLength(patch, "utf8");

    const parsed = patch ? parsePatch(file.filename, patch) : { hunks: [], commentable: [] };
    for (const pos of parsed.commentable) {
      commentableKeys.add(positionKey(pos.path, pos.line, pos.side));
    }

    fileDiffs.push({
      file,
      hunks: parsed.hunks,
      commentable: parsed.commentable,
      annotatedPatch: patch ? annotatePatch(file.filename, patch) : `(no patch available for ${file.filename}; binary or too large)`,
    });
  }

  return {
    files: fileDiffs,
    commentableKeys,
    changedPaths,
    totalPatchBytes,
    totalChangedLines,
  };
}

export function isCommentable(
  context: DiffContext,
  path: string,
  line: number,
  side: Side,
): boolean {
  return context.commentableKeys.has(positionKey(path, line, side));
}

const DEFAULT_SNAP_DISTANCE = 3;

export function snapToCommentable(
  context: DiffContext,
  path: string,
  line: number,
  side: Side,
  maxDistance = DEFAULT_SNAP_DISTANCE,
): CommentablePosition | undefined {
  if (isCommentable(context, path, line, side)) {
    return { path, line, side };
  }

  const file = context.files.find((f) => f.file.filename === path);
  if (!file) return undefined;

  const hunk = file.hunks.find((h) => {
    const lines = side === "RIGHT" ? h.rightLines : h.leftLines;
    if (lines.length === 0) return false;
    const min = Math.min(...lines);
    const max = Math.max(...lines);
    return line >= min - maxDistance && line <= max + maxDistance;
  });
  if (!hunk) return undefined;

  const candidates = side === "RIGHT" ? hunk.rightLines : hunk.leftLines;
  if (candidates.length === 0) return undefined;

  let best = candidates[0];
  let bestDist = Math.abs(best - line);
  for (const candidate of candidates) {
    const dist = Math.abs(candidate - line);
    if (dist < bestDist) {
      best = candidate;
      bestDist = dist;
    }
  }
  if (bestDist > maxDistance) return undefined;
  return { path, line: best, side };
}
