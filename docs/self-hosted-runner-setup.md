# Self-hosted runner setup

This Action reviews pull requests by spawning the Antigravity CLI (`agy`) on the
runner. `agy` spends your **Google AI Pro / Antigravity subscription quota** only
when it can read a token from the **OS keyring**. That is why the runner has to
be self-hosted on a machine you have already logged into.

Setting `GEMINI_API_KEY` switches `agy` into a **separate pay-per-token** Gemini
API mode. That will not touch your Antigravity quota. Only use the Action's
`gemini-api-key` input if you intend to pay per token.

## 1. Install `agy` on the runner machine

Windows (winget):

```powershell
winget install --id Google.AntigravityCLI --accept-package-agreements --accept-source-agreements
```

Windows (official script):

```powershell
irm https://antigravity.google/cli/install.ps1 | iex
```

macOS / Linux:

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
```

Confirm:

```bash
agy --version
agy models
```

`agy models` succeeding is the cheapest proof that headless auth works.

## 2. Sign in as the same OS user the runner will use

Run `agy` once interactively in a logged-in desktop session. The CLI writes a
token to:

| OS | Store |
| --- | --- |
| Windows | Credential Manager |
| macOS | Keychain |
| Linux | libsecret / GNOME Keyring |

Headless jobs reuse that cached session. They will not open a browser. If the
keyring is empty, `agy` exits with `authentication required`.

In Antigravity / Google AI settings, set **AI Credit Overages** to **Never** so a
quota miss pauses reviews instead of spending extra credits.

## 3. Install the GitHub Actions runner as that user

1. In the GitHub repo (or org): **Settings → Actions → Runners → New self-hosted runner**.
2. Follow the download / configure steps.
3. Add a custom label **`antigravity`** so workflows can target this machine:
   `runs-on: [self-hosted, antigravity]`.
4. The runner process must run as the **same OS user** that ran `agy` login, with
   that user's profile loaded.

### Windows

Simplest and most reliable: start the runner in a logged-in session with
`run.cmd` (not as `NT AUTHORITY\SYSTEM`).

If you install it as a Windows service, set the Log On account to your user
(`--windowslogonaccount` / `--windowslogonpassword`, or the Log On tab in
`services.msc`). A runner under Local System cannot read your Credential
Manager entry.

A runner self-update can drop the loaded user profile. If reviews start failing
with `authentication required` after an update, restart the service (or
`run.cmd`) while that user is logged in.

### macOS

Run the listener as the logged-in user. A LaunchDaemon running as root will not
see your Keychain item.

### Linux

`libsecret` needs an unlocked session keyring. A bare headless box typically
needs `dbus-run-session` plus an unlocked keyring; a desktop session or your
workstation is much easier.

## 4. Security: forks and public repos

A self-hosted runner executes workflow code on **your** machine, with **your**
`agy` token. A pull request from a fork can change workflow YAML.

- Prefer **private** repositories.
- The example workflow includes:

  ```yaml
  if: github.event.pull_request.head.repo.full_name == github.repository
  ```

  so fork PRs never start the job.
- In repo settings, enable **Require approval for all outside collaborators**
  (and for first-time contributors on public repos).
- Do **not** attach this runner to a public repo without those guards.
- This Action does **not** pass `--dangerously-skip-permissions`. `agy` may
  read files in the checkout; shell commands stay soft-denied.

## 5. What the Action checks on startup

Before calling the model it:

1. Locates `agy` (`agy-path` input, `AGY_PATH`, `PATH`, then well-known install
   locations including the Windows winget package directory).
2. Runs `agy --version`.
3. Runs `agy models` and fails with a pointer to this doc if the CLI reports
   `authentication required`.

## 6. Quota behavior

Google AI Pro quota refreshes about every five hours, with a weekly cap. When
`agy` reports quota / rate-limit exhaustion, the Action posts a short note on
the PR and exits **neutral** (not a red X). It does not advance the incremental
`lastSha`, so the same range is retried after quota returns.
