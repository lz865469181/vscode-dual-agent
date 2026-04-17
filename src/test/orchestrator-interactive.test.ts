import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Listener<T> = (event: T) => void;

class MockEventEmitter<T> {
  private readonly listeners = new Set<Listener<T>>();

  readonly event = (listener: Listener<T>) => {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      }
    };
  };

  fire(event: T): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  dispose(): void {
    this.listeners.clear();
  }
}

class FakeWatcher {
  private readonly createListeners = new Set<() => void>();
  private readonly changeListeners = new Set<() => void>();

  onDidCreate(listener: () => void) {
    this.createListeners.add(listener);
    return { dispose: () => this.createListeners.delete(listener) };
  }

  onDidChange(listener: () => void) {
    this.changeListeners.add(listener);
    return { dispose: () => this.changeListeners.delete(listener) };
  }

  emitCreate(): void {
    for (const listener of this.createListeners) {
      listener();
    }
  }

  emitChange(): void {
    for (const listener of this.changeListeners) {
      listener();
    }
  }

  dispose(): void {
    this.createListeners.clear();
    this.changeListeners.clear();
  }
}

class FakeSession {
  private readonly stageCompleteListeners = new Set<(event: { stageId: string; sentinel: string }) => void>();
  private readonly exitListeners = new Set<(event: { code: number | null; signal: NodeJS.Signals | null }) => void>();
  private active: { stageId: string; sentinel: string } | null = null;

  readonly start = vi.fn(async () => {});
  readonly sendPrompt = vi.fn();
  readonly stop = vi.fn();

  beginStage(stageId: string, sentinel: string): void {
    this.active = { stageId, sentinel };
  }

  onStageComplete(listener: (event: { stageId: string; sentinel: string }) => void): () => void {
    this.stageCompleteListeners.add(listener);
    return () => {
      this.stageCompleteListeners.delete(listener);
    };
  }

  onExit(listener: (event: { code: number | null; signal: NodeJS.Signals | null }) => void): () => void {
    this.exitListeners.add(listener);
    return () => {
      this.exitListeners.delete(listener);
    };
  }

  emitSentinel(): void {
    if (!this.active) {
      throw new Error("No active stage");
    }

    for (const listener of this.stageCompleteListeners) {
      listener({ ...this.active });
    }
  }
}

async function waitForCondition(check: () => Promise<boolean>, timeoutMs = 500): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      if (await check()) {
        return;
      }
    } catch {
      // Ignore transient reads while the orchestrator is rewriting runtime files.
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("Timed out waiting for orchestrator condition.");
}

let workspaceRoot = "";
let latestWatcher: FakeWatcher | null = null;
const configurationOverrides = new Map<string, unknown>();
const workspaceFolders = [
  {
    uri: {
      fsPath: ""
    }
  }
];

vi.mock("vscode", () => {
  return {
    EventEmitter: MockEventEmitter,
    RelativePattern: class RelativePattern {
      constructor(
        readonly base: string,
        readonly pattern: string
      ) {}
    },
    Uri: {
      file: (filePath: string) => ({ fsPath: filePath })
    },
    workspace: {
      getConfiguration: () => ({
        get: (key: string, defaultValue: unknown) =>
          configurationOverrides.has(key) ? configurationOverrides.get(key) : defaultValue,
        inspect: () => undefined,
        update: vi.fn()
      }),
      workspaceFolders,
      createFileSystemWatcher: vi.fn(() => {
        latestWatcher = new FakeWatcher();
        return latestWatcher;
      }),
      asRelativePath: (target: string) => path.relative(workspaceRoot, target).replace(/\\/g, "/")
    },
    window: {
      createTerminal: vi.fn(() => ({
        show: vi.fn(),
        sendText: vi.fn(),
        dispose: vi.fn()
      })),
      showInformationMessage: vi.fn(async () => undefined),
      showWarningMessage: vi.fn(async () => undefined),
      showErrorMessage: vi.fn(async () => undefined),
      openTextDocument: vi.fn(),
      showTextDocument: vi.fn()
    },
    commands: {
      executeCommand: vi.fn(async () => undefined)
    }
  };
});

describe("DualAgentOrchestrator interactive completion", () => {
  beforeEach(async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "dual-agent-vscode-"));
    configurationOverrides.clear();
    configurationOverrides.set("agentA.executable", process.execPath);
    configurationOverrides.set("agentB.executable", process.execPath);
    configurationOverrides.set("runtime.watchDebounceMs", 0);
    configurationOverrides.set("workflow.timeoutSeconds", 30);
    workspaceFolders[0].uri.fsPath = workspaceRoot;
  });

  afterEach(async () => {
    latestWatcher = null;
    await rm(workspaceRoot, { recursive: true, force: true });
    vi.resetModules();
  });

  it("does not advance when only the sentinel arrives", async () => {
    const agentASession = new FakeSession();
    const agentBSession = new FakeSession();
    const { DualAgentOrchestrator } = await import("../vscode/orchestrator");

    const orchestrator = new DualAgentOrchestrator({
      createSession: (actor: "agent_a" | "agent_b") => (actor === "agent_a" ? agentASession : agentBSession)
    });

    await orchestrator.startWorkflow();
    agentASession.emitSentinel();

    const state = JSON.parse(
      await readFile(path.join(workspaceRoot, ".vscode/dual-agent/state.json"), "utf8")
    ) as { stage: string; status: string };

    expect(state.stage).toBe("agent_a_generate");
    expect(state.status).toBe("waiting_output");
  });

  it("advances only after both the sentinel and a valid output artifact arrive", async () => {
    const agentASession = new FakeSession();
    const agentBSession = new FakeSession();
    const { DualAgentOrchestrator } = await import("../vscode/orchestrator");

    const orchestrator = new DualAgentOrchestrator({
      createSession: (actor: "agent_a" | "agent_b") => (actor === "agent_a" ? agentASession : agentBSession)
    });

    await orchestrator.startWorkflow();

    await writeFile(
      path.join(workspaceRoot, ".vscode/dual-agent/agent-a-output.json"),
      JSON.stringify({
        type: "code_generation",
        author: "agent_a",
        changedFiles: ["src/example.ts"],
        summary: "done"
      }),
      "utf8"
    );

    latestWatcher?.emitChange();
    agentASession.emitSentinel();
    await waitForCondition(async () => {
      const state = JSON.parse(
        await readFile(path.join(workspaceRoot, ".vscode/dual-agent/state.json"), "utf8")
      ) as { stage: string; status: string };

      return state.stage === "agent_b_review" && state.status === "idle";
    });

    const state = JSON.parse(
      await readFile(path.join(workspaceRoot, ".vscode/dual-agent/state.json"), "utf8")
    ) as { stage: string; status: string };

    expect(state.stage).toBe("agent_b_review");
    expect(["idle", "waiting_output"]).toContain(state.status);
  });
});
