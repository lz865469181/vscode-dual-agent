import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type SupportedPlatform = NodeJS.Platform;
type LocateExecutable = (executable: string) => Promise<string[]>;

async function defaultLocateExecutable(executable: string): Promise<string[]> {
  const locator = process.platform === "win32" ? "where.exe" : "which";
  const { stdout } = await execFileAsync(locator, [executable], { windowsHide: true });

  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function isExplicitPath(executable: string): boolean {
  return path.isAbsolute(executable) || executable.includes("/") || executable.includes("\\");
}

function pickWindowsCandidate(candidates: string[]): string | null {
  const normalized = candidates.map((candidate) => candidate.replace(/\\/g, "/"));
  const preferredExtensions = [".exe", ".cmd", ".bat", ".com"];

  for (const extension of preferredExtensions) {
    const match = normalized.find((candidate) => candidate.toLowerCase().endsWith(extension));
    if (match) {
      return match;
    }
  }

  return normalized[0] ?? null;
}

export async function resolveLaunchExecutable(
  executable: string,
  platform: SupportedPlatform = process.platform,
  locateExecutable: LocateExecutable = defaultLocateExecutable
): Promise<string> {
  if (platform !== "win32" || isExplicitPath(executable)) {
    return executable;
  }

  try {
    const candidates = await locateExecutable(executable);
    return pickWindowsCandidate(candidates) ?? executable;
  } catch {
    return executable;
  }
}
