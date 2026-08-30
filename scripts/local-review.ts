/**
 * Review a local unified diff with the same agy pipeline the Action uses.
 * Does not talk to GitHub — useful before a runner is registered.
 *
 *   npm run local-review -- --fixture tests/fixtures/modified-file.patch --path src/auth.ts
 *   npm run local-review
 *   git diff origin/main...HEAD | npm run local-review -- --stdin --path -
 */
import { readFileSync } from "node:fs";
import { detectAgy } from "../src/agy/detect";
import { buildReviewPrompt } from "../src/agy/prompt";
import { runAgyReview } from "../src/agy/run";
import { processFindings } from "../src/findings";
import { DEFAULTS } from "../src/config";
import { buildDiffContext } from "../src/github/diff";
import type { PullFile, ReviewConfig } from "../src/types";

interface Args {
  fixture?: string;
  path: string;
  stdin: boolean;
  model: string;
  noAgy: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    path: "reviewed-file.ts",
    stdin: false,
    model: DEFAULTS.smallPrModel,
    noAgy: false,
  };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--fixture") args.fixture = argv[++i];
    else if (a === "--path") args.path = argv[++i];
    else if (a === "--model") args.model = argv[++i];
    else if (a === "--stdin") args.stdin = true;
    else if (a === "--no-agy") args.noAgy = true;
    else if (!a.startsWith("-")) positional.push(a);
  }
  if (!args.fixture && positional[0]) args.fixture = positional[0];
  if (args.path === "reviewed-file.ts" && positional[1]) args.path = positional[1];
  return args;
}

function parseGitDiff(text: string): PullFile[] {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.includes("diff --git ")) {
    return [];
  }
  const chunks = normalized.split(/^diff --git /m).filter(Boolean);
  const files: PullFile[] = [];
  for (const chunk of chunks) {
    const plus = chunk.match(/^\+\+\+ (?:b\/)?(.+)$/m);
    const minus = chunk.match(/^--- (?:a\/)?(.+)$/m);
    let filename = plus?.[1] ?? minus?.[1] ?? "unknown";
    if (filename === "/dev/null") {
      filename = minus?.[1] ?? "unknown";
    }
    const hunkStart = chunk.indexOf("\n@@");
    const patch = hunkStart >= 0 ? chunk.slice(hunkStart + 1).trimEnd() : undefined;
    let additions = 0;
    let deletions = 0;
    if (patch) {
      for (const line of patch.split("\n")) {
        if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
        else if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
      }
    }
    files.push({
      filename,
      status: plus?.[1] === "/dev/null" ? "removed" : minus?.[1] === "/dev/null" ? "added" : "modified",
      additions,
      deletions,
      changes: additions + deletions,
      patch,
    });
  }
  return files;
}

function filesFromPatch(patch: string, path: string): PullFile[] {
  const gitFiles = parseGitDiff(patch);
  if (gitFiles.length > 0) return gitFiles;
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return [
    {
      filename: path,
      status: "modified",
      additions,
      deletions,
      changes: additions + deletions,
      patch,
    },
  ];
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  let patch: string;
  if (args.stdin) {
    patch = await readStdin();
  } else if (args.fixture) {
    patch = readFileSync(args.fixture, "utf8");
  } else {
    const { execSync } = await import("node:child_process");
    patch = execSync("git diff --no-color", { encoding: "utf8" });
    if (!patch.trim()) {
      patch = execSync("git diff --no-color HEAD", { encoding: "utf8" });
    }
  }
  if (!patch.trim()) {
    console.error("No diff to review. Pass --fixture, --stdin, or make a working-tree change.");
    process.exit(1);
  }

  const files = filesFromPatch(patch, args.path);
  const diff = buildDiffContext(files);
  const prompt = buildReviewPrompt(
    {
      title: "Local dry-run review",
      body: "Offline review of a local diff; not a GitHub pull request.",
      author: "local",
      baseRef: "HEAD",
      headRef: "working-tree",
      incremental: false,
    },
    diff,
  );

  if (args.noAgy) {
    console.log(prompt);
    return;
  }

  const agy = await detectAgy();
  console.error(`agy ${agy.version} at ${agy.path} model=${args.model}`);

  const config: Pick<ReviewConfig, "effort" | "printTimeout" | "sandbox" | "geminiApiKey"> = {
    effort: DEFAULTS.effort,
    printTimeout: DEFAULTS.printTimeout,
    sandbox: false,
    geminiApiKey: "",
  };

  const outcome = await runAgyReview({
    agyPath: agy.path,
    prompt,
    cwd: process.cwd(),
    config,
    model: args.model,
  });

  if (!outcome.ok) {
    console.error(outcome.message);
    process.exit(outcome.quota ? 0 : 1);
  }

  const processed = processFindings(outcome.result, diff, {
    minConfidence: DEFAULTS.minConfidence,
    minSeverity: DEFAULTS.minSeverity,
    maxComments: DEFAULTS.maxComments,
  });

  console.log(
    JSON.stringify(
      {
        verdict: outcome.result.verdict,
        summary: outcome.result.summary,
        usage: outcome.envelope.usage,
        inline: processed.inline,
        demoted: processed.demoted,
        dropped: processed.dropped,
      },
      null,
      2,
    ),
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
