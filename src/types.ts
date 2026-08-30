export type Severity = "critical" | "high" | "medium" | "low";
export type Side = "LEFT" | "RIGHT";
export type Verdict = "approve" | "comment" | "request_changes";
export type Category =
  | "bug"
  | "security"
  | "performance"
  | "missing_test"
  | "correctness"
  | "api_misuse";

export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export interface ReviewFinding {
  path: string;
  line: number;
  side: Side;
  severity: Severity;
  category: Category;
  title: string;
  body: string;
  suggestion?: string;
  confidence: number;
}

export interface ReviewResult {
  summary: string;
  verdict: Verdict;
  findings: ReviewFinding[];
}

export interface PullFile {
  filename: string;
  previousFilename?: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

export interface CommentablePosition {
  path: string;
  line: number;
  side: Side;
}

export interface DiffHunk {
  path: string;
  leftStart: number;
  leftCount: number;
  rightStart: number;
  rightCount: number;
  leftLines: number[];
  rightLines: number[];
}

export interface FileDiff {
  file: PullFile;
  hunks: DiffHunk[];
  commentable: CommentablePosition[];
  annotatedPatch: string;
}

export interface DiffContext {
  files: FileDiff[];
  commentableKeys: Set<string>;
  changedPaths: Set<string>;
  totalPatchBytes: number;
  totalChangedLines: number;
}

export interface ReviewConfig {
  githubToken: string;
  model: string;
  smallPrModel: string;
  effort: "low" | "medium" | "high";
  printTimeout: string;
  sandbox: boolean;
  maxFiles: number;
  maxDiffBytes: number;
  minChangedLines: number;
  maxComments: number;
  minConfidence: number;
  minSeverity: Severity;
  skipDrafts: boolean;
  skipLabels: string[];
  exclude: string[];
  largePrThresholdFiles: number;
  largePrThresholdBytes: number;
  configPath: string;
  workingDirectory: string;
  agyPath: string;
  geminiApiKey: string;
  pullRequestNumber: number | undefined;
}

export interface StickyState {
  lastSha: string;
  lastReviewedAt?: string;
}

export interface AgyEnvelope {
  conversation_id?: string;
  status?: string;
  response?: string;
  error?: string;
  duration_seconds?: number;
  num_turns?: number;
  structured_output?: unknown;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    thinking_tokens?: number;
    cache_read_tokens?: number;
    total_tokens?: number;
  };
}

export interface AgyRunSuccess {
  ok: true;
  envelope: AgyEnvelope;
  result: ReviewResult;
}

export interface AgyRunFailure {
  ok: false;
  quota: boolean;
  message: string;
  envelope?: AgyEnvelope;
  stderr?: string;
}

export type AgyRunOutcome = AgyRunSuccess | AgyRunFailure;

export function positionKey(path: string, line: number, side: Side): string {
  return `${side}:${path}:${line}`;
}
