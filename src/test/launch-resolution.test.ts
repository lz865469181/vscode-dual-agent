import { describe, expect, it } from "vitest";

import { resolveLaunchExecutable } from "../vscode/launch-resolution";

describe("resolveLaunchExecutable", () => {
  it("keeps explicit absolute paths unchanged", async () => {
    const resolved = await resolveLaunchExecutable("C:/tools/claude.exe", "win32", async () => {
      throw new Error("locator should not run");
    });

    expect(resolved).toBe("C:/tools/claude.exe");
  });

  it("prefers Windows executable extensions returned by where", async () => {
    const resolved = await resolveLaunchExecutable("codex", "win32", async () => [
      "C:/Users/test/AppData/Roaming/npm/codex",
      "C:/Users/test/AppData/Roaming/npm/codex.cmd"
    ]);

    expect(resolved).toBe("C:/Users/test/AppData/Roaming/npm/codex.cmd");
  });

  it("falls back to the bare executable when no locator result is available", async () => {
    const resolved = await resolveLaunchExecutable("claude", "win32", async () => []);

    expect(resolved).toBe("claude");
  });

  it("returns the original executable on non-Windows platforms", async () => {
    const resolved = await resolveLaunchExecutable("claude", "linux", async () => [
      "/usr/local/bin/claude"
    ]);

    expect(resolved).toBe("claude");
  });
});
