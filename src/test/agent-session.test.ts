import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import type { AgentLaunchConfig } from "../vscode/cli-adapter";
import { AgentSession } from "../vscode/agent-session";

class FakePtyProcess extends EventEmitter {
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<(event: { exitCode: number; signal?: number }) => void>();
  readonly write = vi.fn();
  readonly resize = vi.fn();
  readonly kill = vi.fn();

  onData(listener: (data: string) => void): { dispose: () => void } {
    this.dataListeners.add(listener);
    return {
      dispose: () => {
        this.dataListeners.delete(listener);
      }
    };
  }

  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose: () => void } {
    this.exitListeners.add(listener);
    return {
      dispose: () => {
        this.exitListeners.delete(listener);
      }
    };
  }

  emitData(data: string): void {
    for (const listener of this.dataListeners) {
      listener(data);
    }
  }

  emitExit(event: { exitCode: number; signal?: number }): void {
    for (const listener of this.exitListeners) {
      listener(event);
    }
  }
}

class FakeTerminalBridge {
  private inputHandler: ((data: string) => void) | undefined;
  private resizeHandler: ((dimensions: { columns: number; rows: number }) => void) | undefined;

  attachInputHandler(handler: (data: string) => void): void {
    this.inputHandler = handler;
  }

  attachResizeHandler(handler: (dimensions: { columns: number; rows: number }) => void): void {
    this.resizeHandler = handler;
  }

  emitInput(data: string): void {
    this.inputHandler?.(data);
  }

  emitResize(columns: number, rows: number): void {
    this.resizeHandler?.({ columns, rows });
  }
}

function createLaunch(): AgentLaunchConfig {
  return {
    executable: "claude",
    args: []
  };
}

describe("AgentSession", () => {
  it("writes prompts to the PTY using bracketed paste and submit", async () => {
    const pty = new FakePtyProcess();

    const session = new AgentSession({
      actor: "agent_a",
      launch: createLaunch(),
      workspaceRoot: "D:/repo",
      createProcess: () => pty,
      writeTerminal: () => {}
    });

    await session.start();
    session.sendPrompt("hello agent");

    expect(pty.write).toHaveBeenCalledWith("\u001b[200~hello agent\u001b[201~");
    expect(pty.write).toHaveBeenCalledWith("\r");
  });

  it("emits a stage completion event when stdout contains the active sentinel", async () => {
    const pty = new FakePtyProcess();
    const writes: string[] = [];
    const completed: Array<{ stageId: string; sentinel: string }> = [];
    const session = new AgentSession({
      actor: "agent_a",
      launch: createLaunch(),
      workspaceRoot: "D:/repo",
      createProcess: () => pty,
      writeTerminal: (data) => {
        writes.push(data);
      }
    });

    session.onStageComplete((event) => {
      completed.push(event);
    });

    await session.start();
    session.beginStage("agent_a_generate", "[DUAL_AGENT] workflow=wf-1 stage=agent_a_generate token=t1 status=done");

    pty.emitData("working...\n");
    pty.emitData("[DUAL_AGENT] workflow=wf-1 stage=agent_a_generate token=t1 status=done\n");

    expect(writes.join("")).toContain("working...");
    expect(completed).toEqual([
      {
        stageId: "agent_a_generate",
        sentinel: "[DUAL_AGENT] workflow=wf-1 stage=agent_a_generate token=t1 status=done"
      }
    ]);
  });

  it("emits an exit event when the child process exits", async () => {
    const pty = new FakePtyProcess();
    const exits: Array<{ code: number | null; signal: NodeJS.Signals | null }> = [];
    const session = new AgentSession({
      actor: "agent_b",
      launch: {
        executable: "codex",
        args: []
      },
      workspaceRoot: "D:/repo",
      createProcess: () => pty,
      writeTerminal: () => {}
    });

    session.onExit((event) => {
      exits.push(event);
    });

    await session.start();
    pty.emitExit({ exitCode: 2 });

    expect(exits).toEqual([{ code: 2, signal: null }]);
  });

  it("forwards terminal input and resize events to the PTY", async () => {
    const pty = new FakePtyProcess();
    const terminal = new FakeTerminalBridge();
    const session = new AgentSession({
      actor: "agent_a",
      launch: createLaunch(),
      workspaceRoot: "D:/repo",
      createProcess: () => pty,
      terminal,
      writeTerminal: () => {}
    });

    await session.start();
    terminal.emitInput("typed input");
    terminal.emitResize(120, 40);

    expect(pty.write).toHaveBeenCalledWith("typed input");
    expect(pty.resize).toHaveBeenCalledWith(120, 40);
  });

  it("auto-confirms the Codex trust prompt once when all match fragments are present", async () => {
    const pty = new FakePtyProcess();
    const session = new AgentSession({
      actor: "agent_b",
      launch: {
        executable: "codex",
        args: [],
        startupAutoResponses: [
          {
            matchAll: ["Do you trust the contents of this directory?", "Press enter to continue"],
            response: "\r",
            once: true
          }
        ]
      },
      workspaceRoot: "D:/repo",
      createProcess: () => pty,
      writeTerminal: () => {}
    });

    await session.start();
    pty.emitData("Do you trust the contents of this directory?\n");
    pty.emitData("Press enter to continue\n");
    pty.emitData("Do you trust the contents of this directory?\nPress enter to continue\n");

    expect(pty.write).toHaveBeenCalledTimes(1);
    expect(pty.write).toHaveBeenCalledWith("\r");
  });

  it("auto-confirms even when the trust prompt contains ANSI control sequences", async () => {
    const pty = new FakePtyProcess();
    const session = new AgentSession({
      actor: "agent_b",
      launch: {
        executable: "codex",
        args: [],
        startupAutoResponses: [
          {
            matchAll: ["Do you trust the contents of this directory?", "Press enter to continue"],
            response: "\r",
            once: true
          }
        ]
      },
      workspaceRoot: "D:/repo",
      createProcess: () => pty,
      writeTerminal: () => {}
    });

    await session.start();
    pty.emitData("\u001b[5;3HDo\u001b[1Cyou\u001b[1Ctrust\u001b[1Cthe\u001b[1Ccontents\u001b[1Cof\u001b[1Cthis\u001b[1Cdirectory?\u001b[K");
    pty.emitData("\u001b[11;3HPress enter to continue\u001b[22m\u001b[K");

    expect(pty.write).toHaveBeenCalledTimes(1);
    expect(pty.write).toHaveBeenCalledWith("\r");
  });
});
