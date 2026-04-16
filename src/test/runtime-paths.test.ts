import { describe, expect, it } from "vitest";

import { createRuntimePaths } from "../core/runtime-paths";

describe("createRuntimePaths", () => {
  it("derives the runtime folder under .vscode/dual-agent", () => {
    const paths = createRuntimePaths("D:/repo", {
      runtimeDirectory: ".vscode/dual-agent",
      state: "state.json",
      review: "review.json",
      agentAOutput: "agent-a-output.json",
      agentBOutput: "agent-b-output.json"
    });

    expect(paths.runtimeDir).toBe("D:/repo/.vscode/dual-agent");
    expect(paths.stateFile).toBe("D:/repo/.vscode/dual-agent/state.json");
    expect(paths.promptsDir).toBe("D:/repo/.vscode/dual-agent/prompts");
  });
});
