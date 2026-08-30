import * as core from "@actions/core";
import * as github from "@actions/github";
import { chooseModel, resolveConfig } from "./config";
import { detectAgy } from "./agy/detect";
import { buildReviewPrompt } from "./agy/prompt";
import { runAgyReview } from "./agy/run";
import { filterFilesByExclude, processFindings } from "./findings";
import { compareCommits, getPullRequest, listPullFiles } from "./github/client";
import { buildDiffContext } from "./github/diff";
import {
  encodeState,
  findStickyComment,
  renderFindingBody,
  renderSummaryBody,
  submitPullReview,
  upsertStickyComment,
} from "./github/review";
import type { ReviewConfig } from "./types";

function setNeutral(message: string): void {
  const maybe = core as typeof core & { setNeutral?: (m: string) => void };
  if (typeof maybe.setNeutral === "function") {
    maybe.setNeutral(message);
    return;
  }
  core.warning(message);
}

function skip(reason: string): void {
  core.info(`Skipping review: ${reason}`);
  core.setOutput("skipped", reason);
  core.setOutput("verdict", "skipped");
  core.setOutput("finding-count", "0");
  core.setOutput("posted-count", "0");
}

async function run(): Promise<void> {
  const config = resolveConfig();
  if (!config.githubToken) {
    core.setFailed("github-token is required");
    return;
  }

  const { owner, repo } = github.context.repo;
  const octokit = github.getOctokit(config.githubToken);
  const pullNumber =
    config.pullRequestNumber ?? github.context.payload.pull_request?.number;

  if (!pullNumber) {
    core.setFailed("Not a pull_request event and pull-request-number was not set");
    return;
  }

  const pr = await getPullRequest(octokit, owner, repo, pullNumber);

  if (config.skipDrafts && pr.draft) {
    skip("draft");
    return;
  }

  const labels = (pr.labels ?? []).map((label) =>
    typeof label === "string" ? label : (label.name ?? ""),
  );
  const skipLabel = config.skipLabels.find((name) => labels.includes(name));
  if (skipLabel) {
    skip(`label:${skipLabel}`);
    return;
  }

  const sticky = await findStickyComment(octokit, owner, repo, pullNumber);
  const action = github.context.payload.action;
  const incremental =
    Boolean(sticky?.state?.lastSha) &&
    sticky!.state!.lastSha !== pr.head.sha &&
    (action === "synchronize" || action === "edited");

  let files = incremental
    ? await compareCommits(octokit, owner, repo, sticky!.state!.lastSha, pr.head.sha)
    : await listPullFiles(octokit, owner, repo, pullNumber);

  files = filterFilesByExclude(files, config.exclude);

  if (files.length === 0) {
    skip("no-reviewable-files");
    return;
  }

  const diff = buildDiffContext(files);

  if (files.length > config.maxFiles) {
    await postSkipNote(
      octokit,
      owner,
      repo,
      pullNumber,
      sticky?.id,
      config,
      pr.head.sha,
      `Too many files after excludes (${files.length} > ${config.maxFiles}). Raise max-files or split the PR.`,
    );
    skip("max-files");
    return;
  }

  if (diff.totalChangedLines < config.minChangedLines) {
    skip("too-few-changed-lines");
    return;
  }

  if (diff.totalPatchBytes > config.maxDiffBytes) {
    await postSkipNote(
      octokit,
      owner,
      repo,
      pullNumber,
      sticky?.id,
      config,
      pr.head.sha,
      `Diff is ${diff.totalPatchBytes} bytes, above max-diff-bytes (${config.maxDiffBytes}).`,
    );
    skip("max-diff-bytes");
    return;
  }

  const model = chooseModel(config, files.length, diff.totalPatchBytes);
  core.setOutput("model", model);

  const agy = await detectAgy(config.agyPath || undefined);
  core.info(`Using agy ${agy.version} at ${agy.path} with model ${model}`);

  const prompt = buildReviewPrompt(
    {
      title: pr.title,
      body: pr.body ?? "",
      author: pr.user?.login ?? "unknown",
      baseRef: pr.base.ref,
      headRef: pr.head.ref,
      incremental,
      sinceSha: incremental ? sticky?.state?.lastSha : undefined,
    },
    diff,
  );

  const outcome = await runAgyReview({
    agyPath: agy.path,
    prompt,
    cwd: config.workingDirectory,
    config,
    model,
  });

  if (!outcome.ok) {
    if (outcome.quota) {
      const body = [
        renderSummaryBody({
          verdict: "quota",
          summary:
            "Antigravity quota is exhausted, so this review was skipped instead of failing the check. Retry after the quota refreshes (about every 5 hours on Google AI Pro). Keep AI Credit Overages set to Never so this does not spend extra credits.",
          model,
          headSha: pr.head.sha,
          inlineCount: 0,
          demoted: [],
        }),
        encodeState({
          lastSha: sticky?.state?.lastSha ?? "",
          lastReviewedAt: new Date().toISOString(),
        }),
      ].join("\n\n");
      await upsertStickyComment(octokit, owner, repo, pullNumber, body, sticky?.id);
      core.setOutput("verdict", "quota");
      core.setOutput("skipped", "quota");
      setNeutral("Antigravity quota exhausted; exiting neutral.");
      return;
    }
    core.setFailed(outcome.message);
    return;
  }

  const processed = processFindings(outcome.result, diff, config);
  const reviewComments = processed.inline.map((finding) => ({
    path: finding.path,
    line: finding.line,
    side: finding.side,
    body: renderFindingBody(finding),
  }));

  const usageTokens = outcome.envelope.usage?.total_tokens;
  const summaryMarkdown = renderSummaryBody({
    verdict: outcome.result.verdict,
    summary: outcome.result.summary,
    model,
    headSha: pr.head.sha,
    inlineCount: reviewComments.length,
    demoted: processed.demoted,
    usageTokens,
    incremental,
  });

  await submitPullReview(octokit, {
    owner,
    repo,
    pullNumber,
    commitId: pr.head.sha,
    body: summaryMarkdown,
    comments: reviewComments,
  });

  const stickyBody = [
    summaryMarkdown,
    encodeState({
      lastSha: pr.head.sha,
      lastReviewedAt: new Date().toISOString(),
    }),
  ].join("\n\n");
  await upsertStickyComment(octokit, owner, repo, pullNumber, stickyBody, sticky?.id);

  if (outcome.envelope.usage) {
    await core.summary
      .addHeading("Antigravity usage")
      .addTable([
        [
          { data: "Metric", header: true },
          { data: "Value", header: true },
        ],
        ["Model", model],
        ["Input tokens", String(outcome.envelope.usage.input_tokens ?? "")],
        ["Output tokens", String(outcome.envelope.usage.output_tokens ?? "")],
        ["Thinking tokens", String(outcome.envelope.usage.thinking_tokens ?? "")],
        ["Total tokens", String(outcome.envelope.usage.total_tokens ?? "")],
      ])
      .write();
  }

  core.setOutput("verdict", outcome.result.verdict);
  core.setOutput("finding-count", String(outcome.result.findings.length));
  core.setOutput("posted-count", String(reviewComments.length));
  core.info(
    `Posted ${reviewComments.length} inline comments (${processed.demoted.length} demoted, ${processed.dropped.length} dropped)`,
  );
}

async function postSkipNote(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  pullNumber: number,
  existingId: number | undefined,
  config: ReviewConfig,
  headSha: string,
  summary: string,
): Promise<void> {
  const body = [
    renderSummaryBody({
      verdict: "skipped",
      summary,
      model: config.model,
      headSha,
      inlineCount: 0,
      demoted: [],
    }),
    encodeState({ lastSha: headSha, lastReviewedAt: new Date().toISOString() }),
  ].join("\n\n");
  await upsertStickyComment(octokit, owner, repo, pullNumber, body, existingId);
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  core.setFailed(message);
});
