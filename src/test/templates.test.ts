import { describe, expect, it } from "vitest";

import { renderTemplate } from "../core/templates";

describe("renderTemplate", () => {
  it("replaces prompt placeholders with runtime values", () => {
    const result = renderTemplate("Task: {{taskFile}} -> {{outputFile}}", {
      taskFile: "D:/repo/.vscode/dual-agent/task.md",
      outputFile: "D:/repo/.vscode/dual-agent/agent-a-output.json"
    });

    expect(result).toBe(
      "Task: D:/repo/.vscode/dual-agent/task.md -> D:/repo/.vscode/dual-agent/agent-a-output.json"
    );
  });

  it("replaces missing placeholders with empty strings", () => {
    const result = renderTemplate("Missing={{unknown}}", {});

    expect(result).toBe("Missing=");
  });
});
