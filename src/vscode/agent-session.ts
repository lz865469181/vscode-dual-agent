import * as pty from "node-pty";

import type { AgentId } from "../core/types";
import type { AgentLaunchConfig } from "./cli-adapter";
import { resolveLaunchExecutable } from "./launch-resolution";

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

interface DisposableLike {
  dispose(): void;
}

export interface TerminalBridge {
  attachInputHandler?(handler: (data: string) => void): void;
  attachResizeHandler?(handler: (dimensions: { columns: number; rows: number }) => void): void;
}

export interface PtyProcess {
  write(data: string): void;
  resize(columns: number, rows: number): void;
  kill(): void;
  onData(listener: (data: string) => void): DisposableLike;
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): DisposableLike;
}

export interface AgentSessionOptions {
  actor: AgentId;
  launch: AgentLaunchConfig;
  workspaceRoot: string;
  createProcess?: () => PtyProcess;
  terminal?: TerminalBridge;
  writeTerminal: (data: string) => void;
}

export class AgentSession {
  private process: PtyProcess | null = null;
  private status: AgentSessionStatus = "not_started";
  private activeStage: ActiveStage | null = null;
  private readonly stageCompleteListeners = new Set<(event: StageCompleteEvent) => void>();
  private readonly exitListeners = new Set<(event: ExitEvent) => void>();
  private readonly subscriptions: DisposableLike[] = [];

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
      this.process = this.options.createProcess?.() ?? (await this.createDefaultProcess());

      this.subscriptions.push(
        this.process.onData((data) => {
          this.handleOutput(data);
        }),
        this.process.onExit((event) => {
          this.status = "stopped";
          this.emitExit({
            code: event.exitCode,
            signal: null
          });
        })
      );

      this.options.terminal?.attachInputHandler?.((data) => {
        this.process?.write(data);
      });
      this.options.terminal?.attachResizeHandler?.((dimensions) => {
        this.process?.resize(dimensions.columns, dimensions.rows);
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

    this.process.write(`\u001b[200~${prompt}\u001b[201~`);
    this.process.write("\r");
  }

  stop(): void {
    this.process?.kill();
    this.process = null;
    this.activeStage = null;
    this.status = "stopped";

    for (const subscription of this.subscriptions.splice(0)) {
      subscription.dispose();
    }
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

  private async createDefaultProcess(): Promise<PtyProcess> {
    const executable = await resolveLaunchExecutable(this.options.launch.executable);
    const ptyProcess = pty.spawn(executable, this.options.launch.args, {
      name: "xterm-256color",
      cols: 120,
      rows: 30,
      cwd: this.options.workspaceRoot,
      env: {
        ...process.env,
        ...this.options.launch.env
      }
    });

    return {
      write: (data: string) => {
        ptyProcess.write(data);
      },
      resize: (columns: number, rows: number) => {
        ptyProcess.resize(columns, rows);
      },
      kill: () => {
        ptyProcess.kill();
      },
      onData: (listener: (data: string) => void) => ptyProcess.onData(listener),
      onExit: (listener: (event: { exitCode: number; signal?: number }) => void) =>
        ptyProcess.onExit((event) => {
          listener(event);
        })
    };
  }

  private handleOutput(data: string): void {
    this.options.writeTerminal(data);

    if (
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
