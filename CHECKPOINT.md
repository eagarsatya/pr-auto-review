# Checkpoint — resume this project next session

Saved 2026-08-30 so work can continue in a later Cursor session. Full product spec is in `PLAN.md` (leave it as-is unless a later session explicitly updates the plan). The Cursor plan file at `c:\Users\Eagar Satya\.cursor\plans\antigravity_pr_reviewer_28209048.plan.md` was **not** edited.

## Project goal

Publishable Node 24 GitHub Action that reviews pull requests with the Antigravity CLI (`agy`) on a **self-hosted runner** (same OS user as the interactive `agy` login, so Google AI Pro quota comes from the OS keyring). It builds a commentable-line map from the GitHub PR diff, runs `agy` headless with a JSON schema, validates findings against that map, and posts a **COMMENT-only** review plus a sticky summary. This is a self-hosted CodeRabbit / Bugbot stand-in; it must not use `GEMINI_API_KEY` as the default path because that is metered billing, not the subscription.

## Git

- **`git init` was required** — this folder was not a repository.
- **No push.** No git config changes. Hooks were not skipped.
- **Checkpoint commit:** `_pending — filled immediately after the checkpoint commit_`
- After that commit, `git status` is recorded in the Git status footer below.

## agy spike (done — do not re-do unless the CLI version changes)

Recorded in `docs/spike-agy.md`.

| Fact | Value |
| --- | --- |
| Version | **agy 1.1.22** |
| Install | `winget install --id Google.AntigravityCLI` (`Google.AntigravityCLI`) |
| Binary | `%LOCALAPPDATA%\Microsoft\WinGet\Packages\Google.AntigravityCLI_Microsoft.Winget.Source_8wekyb3d8bbwe\agy.exe` |
| Auth | Already in **Windows Credential Manager** (no interactive login needed on this machine) |
| Structured output | `agy -p --output-format json --json-schema <file>` returns `structured_output` |
| Windows stdout | Pipe/redirect does **not** drop stdout on 1.1.22 — no PTY wrapper |
| Schema files | **Must be UTF-8 without BOM.** PowerShell `Set-Content -Encoding utf8` writes a BOM and agy treats the file as a string schema. Use Node `fs.writeFileSync` (already how `src/agy/run.ts` writes the temp schema). |
| Large prompts | Windows cmdline is **~8191 chars**. Do **not** pass the full diff as `-p "..."`. Use `--input-format stream-json` with one `{"event":"user","message":{"content":"..."}}` line on stdin. |
| Default models | Large PR: `gemini-3.1-pro-high`. Small PR: `gemini-3.6-flash-medium`. |

Working Action invocation (already implemented in `src/agy/run.ts`):

```
agy --input-format stream-json --output-format stream-json --json-schema <schema.json> --model <slug> --effort <effort> --print-timeout <timeout>
```

stdin: `{"event":"user","message":{"content":"<prompt>"}}\n`  
Deliberately **no** `--dangerously-skip-permissions`.

`action.yml` already exists with **`runs.using: node24`** and `main: dist/index.js`.

## Disk vs previous-session briefing

The briefing described an in-progress scaffold with partial `src/` and almost everything else missing. A sibling implementation agent **kept writing while this checkpoint was prepared**. The table below is actual disk state at commit time, not the briefing.

| Briefing said | Actual disk |
| --- | --- |
| `src/main.ts` missing | **Present** — full orchestration |
| tests missing | **Present** — diff, findings, config, review, agy tests + 4 patch fixtures |
| `.github/workflows/ci.yml` missing | **Present** |
| `self-review.yml` missing | **Present** (`.github/workflows/self-review.yml`) |
| `examples/ai-review.yml` missing | **Present** (placeholder `OWNER/pr-auto-review@v1`) |
| `docs/self-hosted-runner-setup.md` missing | **Present** |
| `README.md` missing | **Present** |
| `.pr-review.yml` missing | **Present** |
| `npm install` not run | **Done** — `package-lock.json` exists; `node_modules/` is gitignored |
| `dist/` bundle missing | **Still missing** — `npm run build` has not been run |
| git init not done | This checkpoint runs it |
| runner-docs / dogfood / publish not started | Docs + dogfood workflow + README **exist**; operational dogfood and `v1` publish remain |

## File inventory

### Present (do not recreate)

**Scaffold / metadata**

- `.gitignore` — `node_modules/`, `.env*`, `agent-tools/`; `dist/` is **not** ignored (CI expects it committed)
- `package.json` — `build` (`ncc` → `dist/`), `typecheck`, `test`, `all`
- `package-lock.json`
- `tsconfig.json`
- `action.yml` — **`runs.using: node24`**, `main: dist/index.js`
- `LICENSE` — MIT
- `PLAN.md` — full spec
- `README.md` — consumer setup, security, inputs
- `CHECKPOINT.md` — this file
- `.pr-review.yml` — this repo’s self-review defaults

**Source (wired together; untested against a live runner)**

- `src/types.ts` — findings, config, diff, agy envelope types
- `src/config.ts` — action inputs + `.pr-review.yml` merge, defaults, `chooseModel`
- `src/findings.ts` — parse `structured_output`, exclude globs, snap/demote/cap, quota-error heuristics
- `src/main.ts` — skip guards, incremental range, agy run, COMMENT review, sticky `lastSha`, quota → neutral
- `src/agy/schema.ts` — findings JSON schema + `findingsSchemaJson()` (no BOM)
- `src/agy/prompt.ts` — review prompt builder
- `src/agy/detect.ts` — PATH / WinGet locate, `--version`, `agy models` auth preflight
- `src/agy/run.ts` — stream-json stdin, temp schema, retry once, parse envelope
- `src/github/diff.ts` — hunk parse, annotated patch, commentable map, snap-to-hunk
- `src/github/client.ts` — paginated `listFiles`, `compareCommits`, `getPullRequest`
- `src/github/review.ts` — COMMENT-only `createReview`, sticky summary + `lastSha` marker

**Tests**

- `tests/diff.test.ts` + `tests/fixtures/{modified-file,new-file,deleted-file,multi-hunk}.patch`
- `tests/findings.test.ts`
- `tests/config.test.ts`
- `tests/review.test.ts`
- `tests/agy.test.ts`

**Workflows / docs / example**

- `.github/workflows/ci.yml` — Node 24, `npm ci`, typecheck, test, build, `git diff --exit-code dist`
- `.github/workflows/self-review.yml` — fork guard, `runs-on: [self-hosted, antigravity]`, `uses: ./`
- `examples/ai-review.yml` — consumer copy; still has `OWNER/pr-auto-review@v1` placeholder
- `docs/spike-agy.md`
- `docs/self-hosted-runner-setup.md`

### Missing / not done

- **`dist/`** — ncc bundle. `action.yml` and CI both require `dist/index.js`. Next session: `npm run build` and commit `dist/`.
- **Remote / push / `v1` tag** — no `git remote`, nothing published, Marketplace not listed.
- **Operational dogfood** — workflow file exists, but no self-hosted runner is registered on this repo yet and the Action cannot run without `dist/`.
- **`examples/ai-review.yml`** still says `OWNER/pr-auto-review@v1` — replace when the repo has a GitHub remote and a `v1` tag.

`node_modules/` exists on disk and is correctly gitignored. Do not commit it.

## Known pitfalls (carry these into every later session)

1. **Never pass `--dangerously-skip-permissions`.** Review is read-only; default agy policy soft-denies shell/writes.
2. **Reviews are `event: "COMMENT"` only** — never `APPROVE` / `REQUEST_CHANGES`. Verdict is text in the sticky summary. (`submitPullReview` already does this.)
3. **Fork guard** belongs in the consumer workflow: `if: github.event.pull_request.head.repo.full_name == github.repository`. A self-hosted runner + fork PR is code execution on the owner's machine with their keyring. `self-review.yml` and `examples/ai-review.yml` already include this.
4. **Runner must be the same OS user** that ran interactive `agy` login. A service under `NT AUTHORITY\SYSTEM` cannot read Windows Credential Manager → `authentication required`.
5. **`GEMINI_API_KEY` is metered pay-per-token**, not the Antigravity subscription. Only use the optional action input when the consumer explicitly wants that fallback. `run.ts` deletes `GEMINI_API_KEY` from the child env unless the input is set.
6. **Schema files: no UTF-8 BOM.**
7. **Prompts via `--input-format stream-json` stdin**, not `-p` on the Windows command line.
8. **Any invalid inline comment 422s the entire GitHub review.** Always filter/snap against the commentable-line map before `createReview`.
9. **Quota exhaustion must exit neutral**, not red. `main.ts` already posts a sticky quota note and calls `setNeutral` when `@actions/core` supports it.
10. **`action.yml` already exists with `runs.using: node24`.** Do not change the runtime without a reason.
11. **CI uses `npm ci`**, so `package-lock.json` must stay committed. CI also fails if `dist/` is missing or stale.

## How to resume (first commands)

Workspace: `D:\Working Space\Personal Projects\pr-auto-review`

```powershell
cd "D:\Working Space\Personal Projects\pr-auto-review"
git log -1 --oneline
npm ci
npm test
npm run typecheck
npm run build
```

Then commit `dist/` (ncc output: `index.js`, source map, `licenses.txt`) so CI and the Action entrypoint work.

Do not commit secrets or `node_modules/`. Open `PLAN.md` for the full spec and this file for where we stopped.

## Remaining plan todos (in order)

Do not restart the agy spike unless the installed CLI version is no longer 1.1.22.

Code for stages **scaffold → github-layer → agy-layer → review-submission → config-guards → runner-docs** is on disk. What is left is build/publish/operate:

1. **Build `dist/`** — `npm run build`; commit the bundle so `action.yml` → `dist/index.js` is real and `.github/workflows/ci.yml` can pass `git diff --exit-code dist`.
2. **Verify tests locally** — `npm test` (unit tests exist but were not necessarily run in this checkpoint session).
3. **Dogfood (operational)** — register a self-hosted runner labeled `antigravity` as the same OS user as the agy login (see `docs/self-hosted-runner-setup.md`). Open a PR on this repo so `self-review.yml` runs. Tune the prompt if signal-to-noise is poor.
4. **Publish** — add a GitHub remote, push, create a moving `v1` tag, replace `OWNER` in `examples/ai-review.yml` / README, optional Marketplace listing.

## Suggested next-session order

1. `npm ci && npm test && npm run build`
2. Commit `dist/`
3. Follow `docs/self-hosted-runner-setup.md` and dogfood `self-review.yml`
4. Push and tag `v1` when a remote exists

## Git status footer

_Filled after `git commit`._
