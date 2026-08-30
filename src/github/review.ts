import type { Octokit } from "./client";
import type { ReviewFinding, StickyState, Verdict } from "../types";

export const STATE_MARKER_PREFIX = "<!-- pr-auto-review:state ";
export const STATE_MARKER_SUFFIX = " -->";
export const STICKY_HEADING = "## Antigravity PR review";

export function encodeState(state: StickyState): string {
  return `${STATE_MARKER_PREFIX}${JSON.stringify(state)}${STATE_MARKER_SUFFIX}`;
}

export function parseStateMarker(body: string): StickyState | undefined {
  const start = body.indexOf(STATE_MARKER_PREFIX);
  if (start < 0) return undefined;
  const jsonStart = start + STATE_MARKER_PREFIX.length;
  const end = body.indexOf(STATE_MARKER_SUFFIX, jsonStart);
  if (end < 0) return undefined;
  try {
    const parsed = JSON.parse(body.slice(jsonStart, end)) as StickyState;
    if (parsed && typeof parsed.lastSha === "string" && parsed.lastSha) {
      return parsed;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function renderFindingBody(finding: ReviewFinding): string {
  const parts = [
    `**[${finding.severity}] ${finding.category}:** ${finding.title}`,
    "",
    finding.body.trim(),
  ];
  if (finding.suggestion?.trim()) {
    parts.push("", "```suggestion", finding.suggestion.replace(/\r\n/g, "\n").replace(/\n$/, ""), "```");
  }
  return parts.join("\n");
}

export function renderSummaryBody(options: {
  verdict: Verdict | "skipped" | "quota";
  summary: string;
  model: string;
  headSha: string;
  inlineCount: number;
  demoted: ReviewFinding[];
  usageTokens?: number;
  incremental?: boolean;
}): string {
  const verdictLabel: Record<string, string> = {
    approve: "Looks good",
    comment: "Comments",
    request_changes: "Issues found",
    skipped: "Skipped",
    quota: "Quota exhausted",
  };
  const lines = [
    STICKY_HEADING,
    "",
    `| | |`,
    `| --- | --- |`,
    `| Verdict | ${verdictLabel[options.verdict] ?? options.verdict} |`,
    `| Model | \`${options.model}\` |`,
    `| Commit | \`${options.headSha.slice(0, 12)}\` |`,
    `| Inline comments | ${options.inlineCount} |`,
  ];
  if (options.usageTokens !== undefined) {
    lines.push(`| Tokens | ${options.usageTokens} |`);
  }
  if (options.incremental) {
    lines.push(`| Mode | Incremental (since last reviewed SHA) |`);
  }
  lines.push("", options.summary.trim() || "_No summary._");

  if (options.demoted.length > 0) {
    lines.push("", "### Findings that could not be attached to a diff line", "");
    for (const finding of options.demoted) {
      lines.push(
        `- **[${finding.severity}] ${finding.category}** \`${finding.path}:${finding.line}\` — ${finding.title}: ${finding.body.trim()}`,
      );
    }
  }

  lines.push(
    "",
    "_Posted as `COMMENT` only — this bot never approves or requests changes as a GitHub review event._",
  );
  return lines.join("\n");
}

export async function findStickyComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<{ id: number; body: string; state?: StickyState } | undefined> {
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner,
    repo,
    issue_number: issueNumber,
    per_page: 100,
  });
  for (const comment of comments) {
    const body = comment.body ?? "";
    if (!body.includes(STATE_MARKER_PREFIX) && !body.includes(STICKY_HEADING)) continue;
    return { id: comment.id, body, state: parseStateMarker(body) };
  }
  return undefined;
}

export async function upsertStickyComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  body: string,
  existingId?: number,
): Promise<void> {
  if (existingId) {
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existingId,
      body,
    });
    return;
  }
  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body,
  });
}

export async function submitPullReview(
  octokit: Octokit,
  options: {
    owner: string;
    repo: string;
    pullNumber: number;
    commitId: string;
    body: string;
    comments: Array<{ path: string; line: number; side: "LEFT" | "RIGHT"; body: string }>;
  },
): Promise<void> {
  // GitHub 422s the entire review if any one inline comment is invalid.
  // Callers must already have filtered comments against the commentable-line map.
  await octokit.rest.pulls.createReview({
    owner: options.owner,
    repo: options.repo,
    pull_number: options.pullNumber,
    commit_id: options.commitId,
    event: "COMMENT",
    body: options.body,
    comments: options.comments.map((c) => ({
      path: c.path,
      body: c.body,
      line: c.line,
      side: c.side,
    })),
  });
}
