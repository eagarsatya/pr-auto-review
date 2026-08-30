# pr-auto-review

A GitHub Action that reviews pull requests with the [Antigravity CLI](https://www.antigravity.google/docs/cli/headless/) (`agy`) on a **self-hosted runner**, then posts inline comments through the GitHub API.

It is a stand-in for CodeRabbit / Bugbot, funded by a Google AI Pro (Antigravity) subscription you are already paying for.

## Why a self-hosted runner

`agy` spends Antigravity subscription quota only through credentials cached in the OS keyring after an interactive login. Setting `GEMINI_API_KEY` bills the Gemini API separately and **does not** use that quota.

The review therefore has to run on a machine you have logged into. GitHub-hosted runners cannot see your keyring.

Full runner, auth, and fork-safety notes: [docs/self-hosted-runner-setup.md](docs/self-hosted-runner-setup.md). CLI spike notes: [docs/spike-agy.md](docs/spike-agy.md).

## Consumer setup

1. Install `agy` on your workstation (or a VM you control) and sign in once. Confirm `agy models` works.
2. Register a GitHub Actions self-hosted runner on that machine, running as the **same OS user**, with the label `antigravity`.
3. Add the workflow below (or copy [examples/ai-review.yml](examples/ai-review.yml)).

```yaml
name: AI PR Review
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

permissions:
  contents: read
  pull-requests: write

concurrency:
  group: ai-review-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  review:
    if: github.event.pull_request.head.repo.full_name == github.repository
    runs-on: [self-hosted, antigravity]
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - uses: eagarsatya/pr-auto-review@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

Optional repo config file (`.pr-review.yml`):

```yaml
model: gemini-3.1-pro-high
small-pr-model: gemini-3.6-flash-medium
effort: high
skip-drafts: true
skip-labels:
  - skip-review
  - dependencies
min-severity: medium
min-confidence: 0.7
max-comments: 20
```

Action inputs override the YAML when set. Pin `@v1` (moving major tag) or a full SHA.

## What it does

1. Loads `.pr-review.yml` and Action inputs.
2. Skips drafts, skip-labels, tiny diffs, excluded globs, and oversized PRs.
3. Builds a commentable-line map from the GitHub PR diff (or the incremental range since the last reviewed SHA).
4. Runs `agy` headless with `--json-schema` so findings are structured.
5. Drops or demotes comments that GitHub would 422, ranks by severity, caps volume.
6. Posts a `COMMENT` review (never `APPROVE` / `REQUEST_CHANGES`) plus a sticky summary that stores `lastSha`.

On quota exhaustion it notes the PR and exits **neutral**, not failed.

## Security

- **Do not** attach a self-hosted runner to a public repo without the same-repo `if:` guard and collaborator approval. Fork PRs would otherwise run on your machine with your keyring.
- The Action does not pass `--dangerously-skip-permissions`.
- Reviews are comments only; they cannot block merges by themselves.

## Inputs

See [action.yml](action.yml). Notable ones:

| Input | Default | Purpose |
| --- | --- | --- |
| `github-token` | required | Read the diff, post the review |
| `model` | `gemini-3.1-pro-high` | Large-PR model |
| `small-pr-model` | `gemini-3.6-flash-medium` | Small-PR model |
| `gemini-api-key` | unset | Metered Gemini API fallback — **not** the subscription |
| `agy-path` | auto-detect | Path to `agy` / `agy.exe` |

## Development

```bash
npm ci
npm test
npm run build
```

Review a local diff with the same `agy` pipeline (no GitHub, uses your keyring quota):

```bash
npm run local-review -- --fixture tests/fixtures/modified-file.patch --path src/auth.ts
git diff | npm run local-review -- --stdin
```

CI fails if `dist/` is not committed and current. The Action runtime is Node 24 (`runs.using: node24`).

Pin consumers at `eagarsatya/pr-auto-review@v1`. The GitHub repo is private so this Action's self-hosted runner is not exposed to fork PRs from the public internet. Make it public only if you intend to publish to the Marketplace and have the fork-safety guards in place.

## Marketplace

Listing this Action on the GitHub Marketplace is optional. After the repo is public, add a release with `action.yml` at the repository root and follow [Publishing actions in GitHub Marketplace](https://docs.github.com/en/actions/creating-actions/publishing-actions-in-github-marketplace).
