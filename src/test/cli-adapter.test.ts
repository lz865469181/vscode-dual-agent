import { describe, expect, it } from "vitest";

import { DEFAULT_AGENT_A } from "../core/defaults";
import { createRuntimePaths } from "../core/runtime-paths";
import { CliAgentAdapter } from "../vscode/cli-adapter";

describe("CliAgentAdapter prompt rendering", () => {
  it("renders workspace-relative runtime paths in prompts", () => {
    const paths = createRuntimePaths("D:/repo", {
      runtimeDirectory: ".vscode/dual-agent",
      state: "state.json",
      review: "review.json",
      agentAOutput: "agent-a-output.json",
      agentBOutput: "agent-b-output.json"
    });

    const adapter = new CliAgentAdapter(
      {
        id: "agent_a",
        name: DEFAULT_AGENT_A.name,
        commandTemplate: DEFAULT_AGENT_A.commandTemplate,
        prompts: DEFAULT_AGENT_A.prompts
      },
      "D:/repo",
      paths
    );

    const prompt = adapter.buildPrompt({
      id: "agent_a_generate",
      actor: "agent_a",
      mode: "generate"
    });

    expect(prompt).toContain(".vscode/dual-agent/task.md");
    expect(prompt).toContain(".vscode/dual-agent/state.json");
    expect(prompt).toContain(".vscode/dual-agent/review.json");
    expect(prompt).toContain(".vscode/dual-agent/agent-a-output.json");
    expect(prompt).not.toContain("D:/repo/.vscode/dual-agent");
  });
});
