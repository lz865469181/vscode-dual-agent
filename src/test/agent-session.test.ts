import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import type { AgentLaunchConfig } from "../vscode/cli-adapter";
import { AgentSession } from "../vscode/agent-session";

class FakeChildProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin = new PassThrough();
  readonly kill = vi.fn();
}

function createLaunch(): AgentLaunchConfig {
  return {
    executable: "claude",
    args: []
  };
}

describe("AgentSession", () => {
  it("writes prompts to stdin with a trailing newline", async () => {
    const child = new FakeChildProcess();
    const stdinChunks: string[] = [];
    child.stdin.on("data", (chunk) => {
      stdinChunks.push(chunk.toString("utf8"));
    });

    const session = new AgentSession({
      actor: "agent_a",
      launch: createLaunch(),
      workspaceRoot: "D:/repo",
      spawnProcess: () => child,
      writeTerminal: () => {}
    });

    await session.start();
    session.sendPrompt("hello agent");

    expect(stdinChunks.join("")).toBe("hello agent\n");
  });

  it("emits a stage completion event when stdout contains the active sentinel", async () => {
    const child = new FakeChildProcess();
    const writes: string[] = [];
    const completed: Array<{ stageId: string; sentinel: string }> = [];
    const session = new AgentSession({
      actor: "agent_a",
      launch: createLaunch(),
      workspaceRoot: "D:/repo",
      spawnProcess: () => child,
      writeTerminal: (data) => {
        writes.push(data);
      }
    });

    session.onStageComplete((event) => {
      completed.push(event);
    });

    await session.start();
    session.beginStage("agent_a_generate", "[DUAL_AGENT] workflow=wf-1 stage=agent_a_generate token=t1 status=done");

    child.stdout.write("working...\n");
    child.stdout.write("[DUAL_AGENT] workflow=wf-1 stage=agent_a_generate token=t1 status=done\n");

    expect(writes.join("")).toContain("working...");
    expect(completed).toEqual([
      {
        stageId: "agent_a_generate",
        sentinel: "[DUAL_AGENT] workflow=wf-1 stage=agent_a_generate token=t1 status=done"
      }
    ]);
  });

  it("emits an exit event when the child process exits", async () => {
    const child = new FakeChildProcess();
    const exits: Array<{ code: number | null; signal: NodeJS.Signals | null }> = [];
    const session = new AgentSession({
      actor: "agent_b",
      launch: {
        executable: "codex",
        args: []
      },
      workspaceRoot: "D:/repo",
      spawnProcess: () => child,
      writeTerminal: () => {}
    });

    session.onExit((event) => {
      exits.push(event);
    });

    await session.start();
    child.emit("exit", 2, null);

    expect(exits).toEqual([{ code: 2, signal: null }]);
  });
});
