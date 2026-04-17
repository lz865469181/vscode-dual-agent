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
        mode: DEFAULT_AGENT_A.mode,
        executable: DEFAULT_AGENT_A.executable,
        args: [...DEFAULT_AGENT_A.args],
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

  it("builds an interactive launch config for the built-in Claude preset", () => {
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
        mode: DEFAULT_AGENT_A.mode,
        executable: DEFAULT_AGENT_A.executable,
        args: [...DEFAULT_AGENT_A.args],
        prompts: DEFAULT_AGENT_A.prompts
      },
      "D:/repo",
      paths
    );

    const launch = adapter.getLaunchConfig();

    expect(launch.executable).toBe("claude");
    expect(launch.args).toEqual([]);
  });

  it("renders an interactive prompt with sentinel instructions", () => {
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
        mode: DEFAULT_AGENT_A.mode,
        executable: DEFAULT_AGENT_A.executable,
        args: [...DEFAULT_AGENT_A.args],
        prompts: DEFAULT_AGENT_A.prompts
      },
      "D:/repo",
      paths
    );

    const prompt = adapter.buildInteractivePrompt(
      {
        id: "agent_a_generate",
        actor: "agent_a",
        mode: "generate"
      },
      {
        workflowId: "wf-1",
        stageId: "agent_a_generate",
        sentinel: "[DUAL_AGENT] workflow=wf-1 stage=agent_a_generate token=t1 status=done"
      }
    );

    expect(prompt).toContain("print this sentinel line exactly once");
    expect(prompt).toContain("[DUAL_AGENT] workflow=wf-1 stage=agent_a_generate token=t1 status=done");
    expect(prompt).toContain(".vscode/dual-agent/task.md");
  });
});
