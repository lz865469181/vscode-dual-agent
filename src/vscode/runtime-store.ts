import { promises as fs } from "node:fs";

import { createRuntimePaths } from "../core/runtime-paths";
import type { GenerationOutput, ReviewOutput, RuntimePaths, WorkflowState } from "../core/types";
import type { ExtensionSettings } from "./config";

const INITIAL_REVIEW: ReviewOutput = {
  type: "review",
  reviewer: "agent_b",
  target: "agent_a",
  issues: [],
  summary: "Session initialized"
};

const INITIAL_AGENT_A_OUTPUT: GenerationOutput = {
  type: "code_generation",
  author: "agent_a",
  changedFiles: [],
  summary: "Session initialized"
};

const INITIAL_AGENT_B_OUTPUT: GenerationOutput = {
  type: "code_generation",
  author: "agent_b",
  changedFiles: [],
  summary: "Session initialized"
};

export class RuntimeStore {
  readonly paths: RuntimePaths;

  constructor(
    private readonly workspaceRoot: string,
    private readonly settings: ExtensionSettings
  ) {
    this.paths = createRuntimePaths(this.workspaceRoot, this.settings.workflow.files);
  }

  async initializeSession(initialState: WorkflowState): Promise<void> {
    await fs.mkdir(this.paths.promptsDir, { recursive: true });
    await this.ensureTaskFile();
    await this.writeState(initialState);
    await this.writeJson(this.paths.reviewFile, INITIAL_REVIEW);
    await this.writeJson(this.paths.agentAOutputFile, INITIAL_AGENT_A_OUTPUT);
    await this.writeJson(this.paths.agentBOutputFile, INITIAL_AGENT_B_OUTPUT);
    await this.appendLog(`Initialized workflow ${initialState.workflowId}`);
  }

  async resetSession(initialState: WorkflowState): Promise<void> {
    await this.initializeSession(initialState);
  }

  async ensureTaskFile(): Promise<void> {
    try {
      await fs.access(this.paths.taskFile);
    } catch {
      await fs.writeFile(
        this.paths.taskFile,
        "# Dual Agent Task\n\nDescribe the coding task for Agent A and Agent B here.\n",
        "utf8"
      );
    }
  }

  async readState(): Promise<WorkflowState | null> {
    try {
      const raw = await fs.readFile(this.paths.stateFile, "utf8");
      return JSON.parse(raw) as WorkflowState;
    } catch {
      return null;
    }
  }

  async writeState(state: WorkflowState): Promise<void> {
    await this.writeJson(this.paths.stateFile, state);
  }

  async readText(filePath: string): Promise<string> {
    return fs.readFile(filePath, "utf8");
  }

  async writePrompt(filePath: string, content: string): Promise<void> {
    await fs.mkdir(this.paths.promptsDir, { recursive: true });
    await fs.writeFile(filePath, content, "utf8");
  }

  async appendLog(message: string): Promise<void> {
    const timestamp = new Date().toISOString();
    await fs.appendFile(this.paths.logFile, `[${timestamp}] ${message}\n`, "utf8");
  }

  async stat(filePath: string) {
    return fs.stat(filePath);
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async writeJson(filePath: string, value: unknown): Promise<void> {
    await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
  }
}
