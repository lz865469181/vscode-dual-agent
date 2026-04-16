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

  it("builds a powershell wrapper for the built-in Claude preset", () => {
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

    const command = adapter.buildCommandWithPrompt(
      {
        id: "agent_a_generate",
        actor: "agent_a",
        mode: "generate"
      },
      "ignored inline prompt",
      "win32"
    );

    expect(command).toContain("Get-Content -Raw");
    expect(command).toContain(".vscode/dual-agent/prompts/current-agent_a_generate.md");
    expect(command).toContain("claude -p --dangerously-skip-permissions $dualAgentPrompt");
    expect(command).not.toContain("ignored inline prompt");
  });
});
