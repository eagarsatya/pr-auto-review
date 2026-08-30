import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chooseModel, DEFAULTS, loadFileConfig, resolveConfig } from "../src/config";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ReviewConfig } from "../src/types";

describe("loadFileConfig", () => {
  it("returns {} when the file is missing", () => {
    assert.deepEqual(loadFileConfig("no-such.yml", tmpdir()), {});
  });

  it("parses YAML keys used by the Action", () => {
    const dir = join(tmpdir(), `pr-auto-review-cfg-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, ".pr-review.yml");
    writeFileSync(
      path,
      ["model: gemini-3.1-pro-high", "skip-drafts: false", "exclude:", "  - '**/foo/**'", ""].join("\n"),
      "utf8",
    );
    try {
      const parsed = loadFileConfig(".pr-review.yml", dir);
      assert.equal(parsed.model, "gemini-3.1-pro-high");
      assert.equal(parsed["skip-drafts"], false);
      assert.deepEqual(parsed.exclude, ["**/foo/**"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("resolveConfig", () => {
  it("applies file config over defaults when inputs are empty", () => {
    const cfg = resolveConfig({
      workspace: tmpdir(),
      fileConfig: {
        model: "gemini-3.6-flash-low",
        "max-comments": 5,
        "skip-labels": ["wip"],
      },
    });
    assert.equal(cfg.model, "gemini-3.6-flash-low");
    assert.equal(cfg.maxComments, 5);
    assert.deepEqual(cfg.skipLabels, ["wip"]);
    assert.equal(cfg.effort, DEFAULTS.effort);
    assert.equal(cfg.skipDrafts, true);
  });
});

describe("chooseModel", () => {
  const base = {
    ...DEFAULTS,
    githubToken: "",
    workingDirectory: "",
    agyPath: "",
    geminiApiKey: "",
    pullRequestNumber: undefined,
    model: "gemini-3.1-pro-high",
    smallPrModel: "gemini-3.6-flash-medium",
    largePrThresholdFiles: 8,
    largePrThresholdBytes: 40_000,
  } as ReviewConfig;

  it("uses the flash model for small PRs", () => {
    assert.equal(chooseModel(base, 2, 1000), "gemini-3.6-flash-medium");
  });

  it("uses the large model when file count hits the threshold", () => {
    assert.equal(chooseModel(base, 8, 100), "gemini-3.1-pro-high");
  });

  it("uses the large model when patch bytes hit the threshold", () => {
    assert.equal(chooseModel(base, 1, 40_000), "gemini-3.1-pro-high");
  });
});
