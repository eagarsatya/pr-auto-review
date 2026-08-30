import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

const WIN = process.platform === "win32";

function isExecutable(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function which(bin: string): string | undefined {
  const pathEnv = process.env.PATH ?? "";
  const sep = WIN ? ";" : ":";
  const names = WIN ? [`${bin}.exe`, bin] : [bin];
  for (const dir of pathEnv.split(sep)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = join(dir, name);
      if (existsSync(candidate) && isExecutable(candidate)) return candidate;
    }
  }
  return undefined;
}

function findInWinGetPackages(): string | undefined {
  const root = process.env.LOCALAPPDATA;
  if (!root) return undefined;
  const packages = join(root, "Microsoft", "WinGet", "Packages");
  if (!existsSync(packages)) return undefined;
  try {
    for (const entry of readdirSync(packages)) {
      if (!entry.startsWith("Google.AntigravityCLI")) continue;
      const candidate = join(packages, entry, "agy.exe");
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function locateAgy(explicitPath?: string): string {
  if (explicitPath) {
    if (!existsSync(explicitPath)) {
      throw new Error(`agy-path does not exist: ${explicitPath}`);
    }
    return explicitPath;
  }
  const fromPath = which("agy");
  if (fromPath) return fromPath;

  const home = process.env.USERPROFILE || process.env.HOME || "";
  const candidates = [
    join(process.env.LOCALAPPDATA ?? "", "agy", "bin", "agy.exe"),
    join(home, ".local", "bin", "agy"),
    join(home, ".local", "bin", "agy.exe"),
  ];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }

  const winget = findInWinGetPackages();
  if (winget) return winget;

  throw new Error(
    [
      "agy was not found on PATH.",
      "Install Antigravity CLI on the self-hosted runner (same OS user that will run jobs),",
      "then sign in once with an interactive `agy` session so the OS keyring has a token.",
      "See docs/self-hosted-runner-setup.md.",
    ].join(" "),
  );
}

function runCapture(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
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
      reject(new Error(`Timed out running ${command} ${args.join(" ")}`));
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });
}

export interface AgyDetection {
  path: string;
  version: string;
}

export async function detectAgy(explicitPath?: string): Promise<AgyDetection> {
  const path = locateAgy(explicitPath);
  const versionResult = await runCapture(path, ["--version"], 15_000);
  const version = versionResult.stdout.trim().split(/\s+/)[0] || "unknown";
  if (versionResult.code !== 0) {
    throw new Error(
      `agy --version failed (exit ${versionResult.code}): ${versionResult.stderr || versionResult.stdout}`,
    );
  }

  const models = await runCapture(path, ["models"], 30_000);
  const combined = `${models.stdout}\n${models.stderr}`;
  if (/authentication required/i.test(combined) || models.code !== 0) {
    throw new Error(
      [
        "agy is installed but not authenticated for headless use.",
        "On the runner machine, log in once with an interactive `agy` session as the same OS user the runner runs as,",
        "so the credential lands in the OS keyring (Windows Credential Manager / Keychain / libsecret).",
        "Do not set GEMINI_API_KEY unless you intend to pay per token instead of using the Antigravity subscription.",
        "See docs/self-hosted-runner-setup.md.",
        models.stderr.trim() || models.stdout.trim(),
      ].join(" "),
    );
  }

  return { path, version };
}
