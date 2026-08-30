import { minimatch } from "minimatch";
import { snapToCommentable } from "./github/diff";
import type {
  Category,
  DiffContext,
  ReviewConfig,
  ReviewFinding,
  ReviewResult,
  Severity,
  Side,
  Verdict,
} from "./types";
import { SEVERITY_RANK } from "./types";

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];
const SIDES: Side[] = ["LEFT", "RIGHT"];
const VERDICTS: Verdict[] = ["approve", "comment", "request_changes"];
const CATEGORIES: Category[] = [
  "bug",
  "security",
  "performance",
  "missing_test",
  "correctness",
  "api_misuse",
];

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[], fallback?: T): T | undefined {
  if (isString(value) && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  return fallback;
}

export function parseReviewResult(raw: unknown): ReviewResult {
  if (!raw || typeof raw !== "object") {
    throw new Error("agy structured_output was missing or not an object");
  }
  const obj = raw as Record<string, unknown>;
  const verdict = asEnum(obj.verdict, VERDICTS);
  if (!verdict) {
    throw new Error(`agy structured_output.verdict is invalid: ${String(obj.verdict)}`);
  }
  if (!isString(obj.summary)) {
    throw new Error("agy structured_output.summary must be a string");
  }
  if (!Array.isArray(obj.findings)) {
    throw new Error("agy structured_output.findings must be an array");
  }

  const findings: ReviewFinding[] = [];
  for (const item of obj.findings) {
    const parsed = parseFinding(item);
    if (parsed) findings.push(parsed);
  }

  return { summary: obj.summary, verdict, findings };
}

function parseFinding(item: unknown): ReviewFinding | undefined {
  if (!item || typeof item !== "object") return undefined;
  const obj = item as Record<string, unknown>;
  if (!isString(obj.path) || !obj.path.trim()) return undefined;
  const line = typeof obj.line === "number" ? obj.line : Number(obj.line);
  if (!Number.isInteger(line) || line < 0) return undefined;
  const side = asEnum(obj.side, SIDES);
  const severity = asEnum(obj.severity, SEVERITIES);
  const category = asEnum(obj.category, CATEGORIES);
  if (!side || !severity || !category) return undefined;
  if (!isString(obj.title) || !isString(obj.body)) return undefined;
  const confidence = typeof obj.confidence === "number" ? obj.confidence : Number(obj.confidence);
  if (!Number.isFinite(confidence)) return undefined;

  const finding: ReviewFinding = {
    path: obj.path.replace(/\\/g, "/"),
    line,
    side,
    severity,
    category,
    title: obj.title.trim(),
    body: obj.body.trim(),
    confidence,
  };
  if (isString(obj.suggestion) && obj.suggestion.trim()) {
    finding.suggestion = obj.suggestion;
  }
  return finding;
}

export function pathExcluded(path: string, patterns: string[]): boolean {
  const normalized = path.replace(/\\/g, "/");
  return patterns.some((pattern) =>
    minimatch(normalized, pattern, { dot: true, nocase: true }),
  );
}

export function filterFilesByExclude<T extends { filename: string }>(
  files: T[],
  patterns: string[],
): T[] {
  return files.filter((file) => !pathExcluded(file.filename, patterns));
}

export interface ProcessedFindings {
  inline: ReviewFinding[];
  demoted: ReviewFinding[];
  dropped: ReviewFinding[];
}

export function processFindings(
  result: ReviewResult,
  context: DiffContext,
  config: Pick<ReviewConfig, "minConfidence" | "minSeverity" | "maxComments">,
): ProcessedFindings {
  const minRank = SEVERITY_RANK[config.minSeverity];
  const inline: ReviewFinding[] = [];
  const demoted: ReviewFinding[] = [];
  const dropped: ReviewFinding[] = [];

  for (const finding of result.findings) {
    if (finding.confidence < config.minConfidence) {
      dropped.push(finding);
      continue;
    }
    if (SEVERITY_RANK[finding.severity] < minRank) {
      dropped.push(finding);
      continue;
    }
    if (!context.changedPaths.has(finding.path)) {
      dropped.push(finding);
      continue;
    }

    const snapped = snapToCommentable(context, finding.path, finding.line, finding.side);
    if (!snapped) {
      demoted.push(finding);
      continue;
    }
    inline.push({ ...finding, line: snapped.line, side: snapped.side });
  }

  inline.sort((a, b) => {
    const sev = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (sev !== 0) return sev;
    return b.confidence - a.confidence;
  });

  const capped = inline.slice(0, config.maxComments);
  const overflow = inline.slice(config.maxComments);
  demoted.push(...overflow);

  return { inline: capped, demoted, dropped };
}

const QUOTA_PATTERNS = [
  /quota/i,
  /rate[\s_-]*limit/i,
  /resource[_ ]exhausted/i,
  /\b429\b/,
  /usage limit/i,
  /weekly limit/i,
  /too many requests/i,
  /credit/i,
  /insufficient[_ ]quota/i,
];

export function isQuotaError(message: string): boolean {
  return QUOTA_PATTERNS.some((re) => re.test(message));
}
