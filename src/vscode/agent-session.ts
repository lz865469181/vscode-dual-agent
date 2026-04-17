import { spawn } from "node:child_process";

import type { AgentId } from "../core/types";
import type { AgentLaunchConfig } from "./cli-adapter";

export type AgentSessionStatus =
  | "not_started"
  | "starting"
  | "ready"
  | "busy"
  | "stopped"
  | "failed";

export interface StageCompleteEvent {
  stageId: string;
  sentinel: string;
}

export interface ExitEvent {
  code: number | null;
  signal: NodeJS.Signals | null;
}

interface ActiveStage {
  stageId: string;
  sentinel: string;
  matched: boolean;
}

interface SpawnedProcess {
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  stdin: NodeJS.WritableStream;
  kill(): void;
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
}

export interface AgentSessionOptions {
  actor: AgentId;
  launch: AgentLaunchConfig;
  workspaceRoot: string;
  spawnProcess?: () => SpawnedProcess;
  writeTerminal: (data: string) => void;
}

export class AgentSession {
  private process: SpawnedProcess | null = null;
  private status: AgentSessionStatus = "not_started";
  private activeStage: ActiveStage | null = null;
  private readonly stageCompleteListeners = new Set<(event: StageCompleteEvent) => void>();
  private readonly exitListeners = new Set<(event: ExitEvent) => void>();

  constructor(private readonly options: AgentSessionOptions) {}

  getStatus(): AgentSessionStatus {
    return this.status;
  }

  async start(): Promise<void> {
    if (this.process) {
      return;
    }

    this.status = "starting";

    try {
      this.process = this.options.spawnProcess?.() ?? this.spawnChildProcess();
      this.process.stdout.on("data", (chunk) => {
        this.handleOutput(chunk.toString("utf8"), "stdout");
      });
      this.process.stderr.on("data", (chunk) => {
        this.handleOutput(chunk.toString("utf8"), "stderr");
      });
      this.process.on("exit", (code, signal) => {
        this.status = "stopped";
        this.emitExit({
          code,
          signal
        });
      });
      this.status = "ready";
    } catch (error) {
      this.status = "failed";
      throw error;
    }
  }

  beginStage(stageId: string, sentinel: string): void {
    this.activeStage = {
      stageId,
      sentinel,
      matched: false
    };
    this.status = "busy";
  }

  sendPrompt(prompt: string): void {
    if (!this.process) {
      throw new Error("Agent session has not been started.");
    }

    this.process.stdin.write(prompt);
    this.process.stdin.write("\n");
  }

  stop(): void {
    this.process?.kill();
    this.process = null;
    this.activeStage = null;
    this.status = "stopped";
  }

  onStageComplete(listener: (event: StageCompleteEvent) => void): () => void {
    this.stageCompleteListeners.add(listener);
    return () => {
      this.stageCompleteListeners.delete(listener);
    };
  }

  onExit(listener: (event: ExitEvent) => void): () => void {
    this.exitListeners.add(listener);
    return () => {
      this.exitListeners.delete(listener);
    };
  }

  private spawnChildProcess(): SpawnedProcess {
    return spawn(this.options.launch.executable, this.options.launch.args, {
      cwd: this.options.workspaceRoot,
      env: {
        ...process.env,
        ...this.options.launch.env
      },
      stdio: "pipe"
    });
  }

  private handleOutput(data: string, source: "stdout" | "stderr"): void {
    this.options.writeTerminal(source === "stderr" ? `[stderr] ${data}` : data);

    if (
      source === "stdout" &&
      this.activeStage &&
      !this.activeStage.matched &&
      data.includes(this.activeStage.sentinel)
    ) {
      this.activeStage.matched = true;
      this.status = "ready";
      this.emitStageComplete({
        stageId: this.activeStage.stageId,
        sentinel: this.activeStage.sentinel
      });
    }
  }

  private emitStageComplete(event: StageCompleteEvent): void {
    for (const listener of this.stageCompleteListeners) {
      listener(event);
    }
  }

  private emitExit(event: ExitEvent): void {
    for (const listener of this.exitListeners) {
      listener(event);
    }
  }
}
