import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findingsSchemaJson } from "./schema";
import { isQuotaError, parseReviewResult } from "../findings";
import type { AgyEnvelope, AgyRunOutcome, ReviewConfig } from "../types";

function parseTimeoutMs(raw: string): number {
  const match = raw.trim().match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/i);
  if (!match) return 15 * 60 * 1000;
  const n = Number(match[1]);
  const unit = (match[2] ?? "s").toLowerCase();
  if (unit === "ms") return n;
  if (unit === "s") return n * 1000;
  if (unit === "m") return n * 60 * 1000;
  return n * 60 * 60 * 1000;
}

function parseEnvelope(stdout: string): AgyEnvelope {
  const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // stream-json: take the last result event. json: a single object, possibly pretty-printed.
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(lines[i]) as Record<string, unknown>;
      if (parsed.event === "result" && parsed.result && typeof parsed.result === "object") {
        return parsed.result as AgyEnvelope;
      }
      if (typeof parsed.status === "string") {
        return parsed as unknown as AgyEnvelope;
      }
    } catch {
      continue;
    }
  }

  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(stdout.slice(start, end + 1)) as AgyEnvelope;
  }
  throw new Error("agy produced no JSON envelope on stdout");
}

const MODEL_EFFORT_SUFFIX = /-(low|medium|high)$/i;

export function buildAgyArgs(options: {
  schemaPath: string;
  model: string;
  effort: ReviewConfig["effort"];
  printTimeout: string;
  sandbox: boolean;
}): string[] {
  const args = [
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--json-schema",
    options.schemaPath,
    "--model",
    options.model,
  ];
  // agy 1.1.22 rejects `--effort` when the model slug already encodes it
  // (`gemini-3.6-flash-medium` + `--effort high` → conflict).
  if (!MODEL_EFFORT_SUFFIX.test(options.model)) {
    args.push("--effort", options.effort);
  }
  args.push("--print-timeout", options.printTimeout);
  if (options.sandbox) args.push("--sandbox");
  return args;
}

function spawnAgy(options: {
  agyPath: string;
  args: string[];
  cwd: string;
  stdin: string;
  timeoutMs: number;
  env: NodeJS.ProcessEnv;
}): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(options.agyPath, options.args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`agy timed out after ${options.timeoutMs}ms`));
    }, options.timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });

    child.stdin?.write(options.stdin, "utf8");
    child.stdin?.end();
  });
}

export async function runAgyReview(options: {
  agyPath: string;
  prompt: string;
  cwd: string;
  config: Pick<ReviewConfig, "effort" | "printTimeout" | "sandbox" | "geminiApiKey">;
  model: string;
}): Promise<AgyRunOutcome> {
  const timeoutMs = parseTimeoutMs(options.config.printTimeout) + 30_000;
  const tmp = mkdtempSync(join(tmpdir(), "pr-auto-review-"));
  const schemaPath = join(tmp, "schema.json");
  writeFileSync(schemaPath, findingsSchemaJson(), "utf8");

  const args = buildAgyArgs({
    schemaPath,
    model: options.model,
    effort: options.config.effort,
    printTimeout: options.config.printTimeout,
    sandbox: options.config.sandbox,
  });

  const stdin = `${JSON.stringify({
    event: "user",
    message: { content: options.prompt },
  })}\n`;

  const env = { ...process.env };
  if (options.config.geminiApiKey) {
    env.GEMINI_API_KEY = options.config.geminiApiKey;
  } else {
    delete env.GEMINI_API_KEY;
  }

  try {
    const first = await spawnAgy({
      agyPath: options.agyPath,
      args,
      cwd: options.cwd,
      stdin,
      timeoutMs,
      env,
    });
    const outcome = interpret(first);
    if (outcome.ok || outcome.quota) return outcome;

    const retry = await spawnAgy({
      agyPath: options.agyPath,
      args,
      cwd: options.cwd,
      stdin,
      timeoutMs,
      env,
    });
    return interpret(retry);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, quota: isQuotaError(message), message };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function interpret(proc: { stdout: string; stderr: string; code: number | null }): AgyRunOutcome {
  const combined = `${proc.stderr}\n${proc.stdout}`;
  let envelope: AgyEnvelope | undefined;
  try {
    envelope = parseEnvelope(proc.stdout);
  } catch (err) {
    const message =
      (err instanceof Error ? err.message : String(err)) +
      (proc.stderr ? `\n${proc.stderr}` : "");
    if (!proc.stdout.trim() && proc.code === 0) {
      return {
        ok: false,
        quota: false,
        message:
          "agy exited 0 but stdout was empty. This environment may be dropping piped output; retry on a real TTY or upgrade agy.",
        stderr: proc.stderr,
      };
    }
    return {
      ok: false,
      quota: isQuotaError(combined),
      message,
      stderr: proc.stderr,
    };
  }

  const errorText = `${envelope.error ?? ""} ${envelope.status ?? ""} ${combined}`;
  if (envelope.status && envelope.status !== "SUCCESS") {
    return {
      ok: false,
      quota: isQuotaError(errorText),
      message: envelope.error || `agy status ${envelope.status}`,
      envelope,
      stderr: proc.stderr,
    };
  }
  if (proc.code !== 0) {
    return {
      ok: false,
      quota: isQuotaError(errorText),
      message: envelope.error || `agy exited ${proc.code}`,
      envelope,
      stderr: proc.stderr,
    };
  }

  try {
    const result = parseReviewResult(envelope.structured_output);
    return { ok: true, envelope, result };
  } catch (err) {
    return {
      ok: false,
      quota: false,
      message: err instanceof Error ? err.message : String(err),
      envelope,
      stderr: proc.stderr,
    };
  }
}

export { parseEnvelope, parseTimeoutMs };
