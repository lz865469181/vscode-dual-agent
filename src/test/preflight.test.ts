import { describe, expect, it } from "vitest";

import { classifyCommandTemplate } from "../vscode/preflight";

describe("preflight command template classification", () => {
  it("marks old powershell pipeline templates as legacy", () => {
    const legacy = classifyCommandTemplate('Get-Content -Raw "{{promptFile}}" | claude');

    expect(legacy.kind).toBe("legacy_template");
  });

  it("accepts current cross-platform templates", () => {
    const current = classifyCommandTemplate("builtin:claude");

    expect(current.kind).toBe("ok");

    if (current.kind !== "ok") {
      throw new Error("Expected an executable classification");
    }

    expect(current.executable).toBe("claude");
  });
});
