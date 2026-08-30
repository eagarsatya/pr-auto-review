import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as core from "@actions/core";
import { parse as parseYaml } from "yaml";
import type { ReviewConfig, Severity } from "./types";

const DEFAULT_EXCLUDE = [
  "**/package-lock.json",
  "**/yarn.lock",
  "**/pnpm-lock.yaml",
  "**/bun.lock",
  "**/bun.lockb",
  "**/Cargo.lock",
  "**/composer.lock",
  "**/poetry.lock",
  "**/Gemfile.lock",
  "**/go.sum",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/node_modules/**",
  "**/vendor/**",
  "**/*.min.js",
  "**/*.min.css",
  "**/*.snap",
  "**/*.generated.*",
  "**/*.lock",
];

const DEFAULT_SKIP_LABELS = ["skip-review", "dependencies"];

export const DEFAULTS: Omit<
  ReviewConfig,
  "githubToken" | "workingDirectory" | "agyPath" | "geminiApiKey" | "pullRequestNumber"
> = {
  model: "gemini-3.1-pro-high",
  smallPrModel: "gemini-3.6-flash-medium",
  effort: "high",
  printTimeout: "15m",
  sandbox: false,
  maxFiles: 40,
  maxDiffBytes: 400_000,
  minChangedLines: 4,
  maxComments: 20,
  minConfidence: 0.7,
  minSeverity: "medium",
  skipDrafts: true,
  skipLabels: [...DEFAULT_SKIP_LABELS],
  exclude: [...DEFAULT_EXCLUDE],
  largePrThresholdFiles: 8,
  largePrThresholdBytes: 40_000,
  configPath: ".pr-review.yml",
};

interface FileConfig {
  model?: string;
  "small-pr-model"?: string;
  effort?: string;
  "print-timeout"?: string;
  sandbox?: boolean;
  "max-files"?: number;
  "max-diff-bytes"?: number;
  "min-changed-lines"?: number;
  "max-comments"?: number;
  "min-confidence"?: number;
  "min-severity"?: string;
  "skip-drafts"?: boolean;
  "skip-labels"?: string[];
  exclude?: string[];
  "large-pr-threshold-files"?: number;
  "large-pr-threshold-bytes"?: number;
}

function input(name: string): string {
  return core.getInput(name).trim();
}

function parseBool(raw: string | boolean | undefined, fallback: boolean): boolean {
  if (typeof raw === "boolean") return raw;
  if (raw === undefined || raw === "") return fallback;
  return ["true", "1", "yes", "on"].includes(String(raw).toLowerCase());
}

function parseNumber(raw: string | number | undefined, fallback: number): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function parseList(raw: string | string[] | undefined, fallback: string[]): string[] {
  if (Array.isArray(raw)) {
    return raw.map((s) => String(s).trim()).filter(Boolean);
  }
  if (raw === undefined || raw === "") return fallback;
  return String(raw)
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseSeverity(raw: string | undefined, fallback: Severity): Severity {
  const v = (raw ?? "").toLowerCase();
  if (v === "critical" || v === "high" || v === "medium" || v === "low") return v;
  return fallback;
}

function parseEffort(raw: string | undefined, fallback: ReviewConfig["effort"]): ReviewConfig["effort"] {
  const v = (raw ?? "").toLowerCase();
  if (v === "low" || v === "medium" || v === "high") return v;
  return fallback;
}

export function loadFileConfig(configPath: string, workspace: string): FileConfig {
  const resolved = resolve(workspace, configPath);
  if (!existsSync(resolved)) return {};
  const text = readFileSync(resolved, "utf8");
  if (!text.trim()) return {};
  const parsed = parseYaml(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Config file ${configPath} must be a YAML object`);
  }
  return parsed as FileConfig;
}

function pickString(
  inputValue: string,
  fileValue: string | undefined,
  fallback: string,
): string {
  if (inputValue) return inputValue;
  if (fileValue) return fileValue;
  return fallback;
}

export function resolveConfig(options?: {
  workspace?: string;
  fileConfig?: FileConfig;
}): ReviewConfig {
  const workspace = options?.workspace ?? process.env.GITHUB_WORKSPACE ?? process.cwd();
  const configPath = input("config-path") || DEFAULTS.configPath;
  const file = options?.fileConfig ?? loadFileConfig(configPath, workspace);

  const skipLabelsInput = input("skip-labels");
  const excludeInput = input("exclude");

  return {
    githubToken: input("github-token") || process.env.GITHUB_TOKEN || "",
    model: pickString(input("model"), file.model, DEFAULTS.model),
    smallPrModel: pickString(input("small-pr-model"), file["small-pr-model"], DEFAULTS.smallPrModel),
    effort: parseEffort(input("effort") || file.effort, DEFAULTS.effort),
    printTimeout: pickString(input("print-timeout"), file["print-timeout"], DEFAULTS.printTimeout),
    sandbox: parseBool(input("sandbox") || file.sandbox, DEFAULTS.sandbox),
    maxFiles: parseNumber(input("max-files") || file["max-files"], DEFAULTS.maxFiles),
    maxDiffBytes: parseNumber(input("max-diff-bytes") || file["max-diff-bytes"], DEFAULTS.maxDiffBytes),
    minChangedLines: parseNumber(
      input("min-changed-lines") || file["min-changed-lines"],
      DEFAULTS.minChangedLines,
    ),
    maxComments: parseNumber(input("max-comments") || file["max-comments"], DEFAULTS.maxComments),
    minConfidence: parseNumber(
      input("min-confidence") || file["min-confidence"],
      DEFAULTS.minConfidence,
    ),
    minSeverity: parseSeverity(input("min-severity") || file["min-severity"], DEFAULTS.minSeverity),
    skipDrafts: parseBool(
      input("skip-drafts") !== "" ? input("skip-drafts") : file["skip-drafts"],
      DEFAULTS.skipDrafts,
    ),
    skipLabels: skipLabelsInput
      ? parseList(skipLabelsInput, DEFAULTS.skipLabels)
      : parseList(file["skip-labels"], DEFAULTS.skipLabels),
    exclude: excludeInput
      ? parseList(excludeInput, DEFAULTS.exclude)
      : parseList(file.exclude, DEFAULTS.exclude),
    largePrThresholdFiles: parseNumber(
      input("large-pr-threshold-files") || file["large-pr-threshold-files"],
      DEFAULTS.largePrThresholdFiles,
    ),
    largePrThresholdBytes: parseNumber(
      input("large-pr-threshold-bytes") || file["large-pr-threshold-bytes"],
      DEFAULTS.largePrThresholdBytes,
    ),
    configPath,
    workingDirectory: input("working-directory") || workspace,
    agyPath: input("agy-path") || process.env.AGY_PATH || "",
    geminiApiKey: input("gemini-api-key") || process.env.GEMINI_API_KEY || "",
    pullRequestNumber: parseOptionalInt(input("pull-request-number")),
  };
}

function parseOptionalInt(raw: string): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export function chooseModel(
  config: ReviewConfig,
  fileCount: number,
  patchBytes: number,
): string {
  const large =
    fileCount >= config.largePrThresholdFiles || patchBytes >= config.largePrThresholdBytes;
  return large ? config.model : config.smallPrModel;
}
