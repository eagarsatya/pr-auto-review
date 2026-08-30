# Spike: Antigravity CLI (`agy`) headless contract

Recorded 2026-08-30 on Windows 10 against **agy 1.1.22** (winget `Google.AntigravityCLI`).

## Install

```powershell
winget install --id Google.AntigravityCLI --accept-package-agreements --accept-source-agreements
```

Binary landed at:

`%LOCALAPPDATA%\Microsoft\WinGet\Packages\Google.AntigravityCLI_Microsoft.Winget.Source_8wekyb3d8bbwe\agy.exe`

The official `irm https://antigravity.google/cli/install.ps1 | iex` path hung with no output in this environment. The install script itself is valid (downloads a ~180 MB Go binary from the updater service).

## Auth

`agy models` succeeded without an interactive browser login. The CLI silently used a token already in Windows Credential Manager (from the Antigravity IDE / Google AI Pro session on this machine). This is the subscription-quota path the Action depends on.

## Model slugs (`agy models`)

| Slug | Label |
| --- | --- |
| `gemini-3.7-flash-high` | Gemini 3.7 Flash (High) |
| `gemini-3.7-flash-medium` | Gemini 3.7 Flash (Medium) |
| `gemini-3.7-flash-low` | Gemini 3.7 Flash (Low) |
| `gemini-3.6-flash-high` | Gemini 3.6 Flash (High) |
| `gemini-3.6-flash-medium` | Gemini 3.6 Flash (Medium) |
| `gemini-3.6-flash-low` | Gemini 3.6 Flash (Low) |
| `gemini-3.5-flash-high` | Gemini 3.5 Flash (High) |
| `gemini-3.5-flash-medium` | Gemini 3.5 Flash (Medium) |
| `gemini-3.5-flash-low` | Gemini 3.5 Flash (Low) |
| `gemini-3.1-pro-high` | Gemini 3.1 Pro (High) |
| `gemini-3.1-pro-low` | Gemini 3.1 Pro (Low) |
| `claude-sonnet-4-6` | Claude Sonnet 4.6 (Thinking) |
| `claude-opus-4-6-thinking` | Claude Opus 4.6 (Thinking) |
| `gpt-oss-120b-medium` | GPT-OSS 120B (Medium) |

Defaults used by this Action: **`gemini-3.1-pro-high`** for large PRs, **`gemini-3.6-flash-medium`** for small PRs.

## `--json-schema` / `structured_output`

Confirmed. A run with `--output-format json --json-schema <file>` returns a JSON envelope whose `structured_output` object matches the schema, independent of extra keys the model stuffed into `response`.

**BOM trap:** PowerShell `Set-Content -Encoding utf8` writes a UTF-8 BOM. `agy` then treated the file as a string schema (`{"type":"string","description":"<bom+json>"}`) and failed. Node `fs.writeFileSync` (no BOM) is required.

## Stdout under pipe / redirect (Windows)

No drop on 1.1.22. Direct stdout, `>` redirect, and `|` pipe all returned the full JSON envelope. No pseudo-TTY wrapper is needed.

## `--effort` vs model slugs

`agy 1.1.22` rejects combining `--effort` with a slug that already ends in `-low`/`-medium`/`-high`:

```
invalid model selection (--model "gemini-3.6-flash-medium" --effort "high"): --model gemini-3.6-flash-medium conflicts with --effort=high
```

The Action omits `--effort` when the model slug already encodes it.

## Large prompts

Windows command-line length is ~8191 characters, so `-p "<entire diff>"` will truncate real PRs. Confirmed working alternative:

```
agy --input-format stream-json --output-format stream-json --json-schema schema.json
```

with one `{"event":"user","message":{"content":"..."}}` line on stdin. The terminal `result` event includes `structured_output`. This is the invocation the Action uses.
