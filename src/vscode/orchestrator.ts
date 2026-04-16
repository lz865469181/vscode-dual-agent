import * as vscode from "vscode";

import { advanceWorkflow } from "../core/transitions";
import type { AgentId, FailureReason, StageDefinition, WorkflowState } from "../core/types";
import { CliAgentAdapter } from "./cli-adapter";
import { getActiveStage, getExtensionSettings, getWorkspaceRoot, type ExtensionSettings } from "./config";
import { runAgentPreflight } from "./preflight";
import { RuntimeStore } from "./runtime-store";

interface SidebarSectionItem {
  label: string;
  description?: string;
  command?: vscode.Command;
}

export interface SidebarSnapshot {
  session: SidebarSectionItem[];
  agents: SidebarSectionItem[];
  artifacts: SidebarSectionItem[];
  actions: SidebarSectionItem[];
}

function createWorkflowId(): string {
  return new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
}

function createInitialState(settings: ExtensionSettings): WorkflowState {
  const firstStage = settings.workflow.stages[0];

  if (!firstStage) {
    throw new Error("At least one workflow stage must be configured.");
  }

  return {
    workflowId: createWorkflowId(),
    stage: firstStage.id,
    lastActor: null,
    iteration: 0,
    maxIterations: settings.workflow.maxIterations,
    status: "idle",
    updatedAt: new Date().toISOString(),
    failureReason: null,
    history: [],
    lastIssueFingerprint: null
  };
}

export class DualAgentOrchestrator implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  private readonly terminals = new Map<AgentId, vscode.Terminal>();
  private activeWatcher: vscode.FileSystemWatcher | undefined;
  private activeTimeout: NodeJS.Timeout | undefined;
  private activeDebounce: NodeJS.Timeout | undefined;
  private activeRunToken = 0;

  dispose(): void {
    this.clearActiveMonitoring();
    this.changeEmitter.dispose();

    for (const terminal of this.terminals.values()) {
      terminal.dispose();
    }
  }

  async startWorkflow(): Promise<void> {
    try {
      const settings = getExtensionSettings();
      const preflightIssues = await runAgentPreflight(settings);
      if (preflightIssues.length > 0) {
        await this.showPreflightIssues(preflightIssues);
        return;
      }
      const store = this.createStore(settings);
      const initialState = createInitialState(settings);

      this.clearActiveMonitoring();
      await store.initializeSession(initialState);
      this.changeEmitter.fire();

      if (settings.workflow.autoRun) {
        await this.runActiveStage();
      }
    } catch (error) {
      this.showError(error);
    }
  }

  async runNextStage(): Promise<void> {
    try {
      await this.runActiveStage();
    } catch (error) {
      this.showError(error);
    }
  }

  async stopWorkflow(): Promise<void> {
    try {
      const settings = getExtensionSettings();
      const store = this.createStore(settings);
      const state = await store.readState();

      if (!state) {
        return;
      }

      this.clearActiveMonitoring();
      const stoppedState: WorkflowState = {
        ...state,
        status: "stopped",
        updatedAt: new Date().toISOString()
      };
      await store.writeState(stoppedState);
      await store.appendLog("Workflow stopped by user.");
      this.changeEmitter.fire();
    } catch (error) {
      this.showError(error);
    }
  }

  async resetWorkflowState(): Promise<void> {
    try {
      const settings = getExtensionSettings();
      const store = this.createStore(settings);
      const initialState = createInitialState(settings);

      this.clearActiveMonitoring();
      await store.resetSession(initialState);
      this.changeEmitter.fire();
    } catch (error) {
      this.showError(error);
    }
  }

  async openRuntimeFolder(): Promise<void> {
    try {
      const settings = getExtensionSettings();
      const store = this.createStore(settings);
      await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(store.paths.runtimeDir));
    } catch (error) {
      this.showError(error);
    }
  }

  async openReviewFile(): Promise<void> {
    try {
      const settings = getExtensionSettings();
      const store = this.createStore(settings);
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(store.paths.reviewFile));
      await vscode.window.showTextDocument(document, { preview: false });
    } catch (error) {
      this.showError(error);
    }
  }

  async openSettings(): Promise<void> {
    await vscode.commands.executeCommand("workbench.action.openSettings", "dualAgent");
  }

  async getSnapshot(): Promise<SidebarSnapshot> {
    try {
      const settings = getExtensionSettings();
      const store = this.createStore(settings);
      const state = await store.readState();
      const activeStage = state ? getActiveStage(settings.workflow.stages, state.stage) : null;
      const expectedOutput = activeStage ? this.getAdapter(activeStage, settings, store).getExpectedOutputFile(activeStage) : null;

      return {
        session: [
          { label: `Status: ${state?.status ?? "not_initialized"}` },
          { label: `Stage: ${state?.stage ?? "n/a"}` },
          { label: `Iteration: ${state ? `${state.iteration}/${state.maxIterations}` : "0/0"}` },
          { label: `Runtime: ${store.paths.runtimeDir}` },
          { label: `Waiting For: ${expectedOutput ?? "n/a"}` }
        ],
        agents: [
          {
            label: `${settings.agents.agent_a.name}`,
            description: settings.agents.agent_a.commandTemplate
          },
          {
            label: `${settings.agents.agent_b.name}`,
            description: settings.agents.agent_b.commandTemplate
          }
        ],
        artifacts: [
          {
            label: "task.md",
            description: store.paths.taskFile,
            command: this.createOpenFileCommand(store.paths.taskFile)
          },
          {
            label: "state.json",
            description: store.paths.stateFile,
            command: this.createOpenFileCommand(store.paths.stateFile)
          },
          {
            label: "review.json",
            description: store.paths.reviewFile,
            command: this.createOpenFileCommand(store.paths.reviewFile)
          },
          {
            label: "agent-a-output.json",
            description: store.paths.agentAOutputFile,
            command: this.createOpenFileCommand(store.paths.agentAOutputFile)
          },
          {
            label: "agent-b-output.json",
            description: store.paths.agentBOutputFile,
            command: this.createOpenFileCommand(store.paths.agentBOutputFile)
          },
          {
            label: "session.log",
            description: store.paths.logFile,
            command: this.createOpenFileCommand(store.paths.logFile)
          }
        ],
        actions: [
          { label: "Start Workflow", command: { command: "dualAgent.startWorkflow", title: "Start Workflow" } },
          { label: "Run Next Stage", command: { command: "dualAgent.runNextStage", title: "Run Next Stage" } },
          { label: "Stop Workflow", command: { command: "dualAgent.stopWorkflow", title: "Stop Workflow" } },
          { label: "Reset Workflow State", command: { command: "dualAgent.resetWorkflowState", title: "Reset Workflow State" } },
          { label: "Open Runtime Folder", command: { command: "dualAgent.openRuntimeFolder", title: "Open Runtime Folder" } },
          { label: "Open Settings", command: { command: "dualAgent.openSettings", title: "Open Settings" } }
        ]
      };
    } catch {
      return {
        session: [{ label: "Status: no workspace" }],
        agents: [],
        artifacts: [],
        actions: [{ label: "Open Settings", command: { command: "dualAgent.openSettings", title: "Open Settings" } }]
      };
    }
  }

  private createOpenFileCommand(filePath: string): vscode.Command {
    return {
      command: "vscode.open",
      title: "Open File",
      arguments: [vscode.Uri.file(filePath)]
    };
  }

  private createStore(settings: ExtensionSettings): RuntimeStore {
    return new RuntimeStore(getWorkspaceRoot(), settings);
  }

  private getAdapter(stage: StageDefinition, settings: ExtensionSettings, store: RuntimeStore): CliAgentAdapter {
    return new CliAgentAdapter(settings.agents[stage.actor], getWorkspaceRoot(), store.paths);
  }

  private getOrCreateTerminal(actor: AgentId, settings: ExtensionSettings): vscode.Terminal {
    const existing = this.terminals.get(actor);

    if (existing) {
      return existing;
    }

    const terminal = vscode.window.createTerminal({
      name: `Dual Agent: ${settings.agents[actor].name}`,
      cwd: getWorkspaceRoot()
    });
    this.terminals.set(actor, terminal);
    return terminal;
  }

  private async runActiveStage(): Promise<void> {
    const settings = getExtensionSettings();
    const preflightIssues = await runAgentPreflight(settings);
    if (preflightIssues.length > 0) {
      await this.showPreflightIssues(preflightIssues);
      return;
    }
    const store = this.createStore(settings);
    const state = await store.readState();

    if (!state) {
      throw new Error("Workflow has not been initialized. Run Start Workflow first.");
    }

    if (state.status === "done" || state.status === "failed") {
      vscode.window.showInformationMessage(`Workflow already ${state.status}. Reset or start a new session to continue.`);
      return;
    }

    const stage = getActiveStage(settings.workflow.stages, state.stage);
    const adapter = this.getAdapter(stage, settings, store);
    const promptFile = adapter.getPromptFile(stage);
    const prompt = adapter.buildPrompt(stage);
    const command = adapter.buildCommandWithPrompt(stage, prompt);
    const outputFile = adapter.getExpectedOutputFile(stage);
    const startedAt = new Date().toISOString();
    const runningState: WorkflowState = {
      ...state,
      status: "waiting_output",
      updatedAt: startedAt,
      failureReason: null
    };

    this.clearActiveMonitoring();
    await store.writePrompt(promptFile, prompt);
    await store.writeState(runningState);
    await store.appendLog(`Starting stage ${stage.id}. Expecting output: ${outputFile}`);

    this.startMonitoring(settings, store, stage, runningState, outputFile, adapter);

    const terminal = this.getOrCreateTerminal(stage.actor, settings);
    terminal.show(false);
    terminal.sendText(command, true);

    this.changeEmitter.fire();
  }

  private startMonitoring(
    settings: ExtensionSettings,
    store: RuntimeStore,
    stage: StageDefinition,
    stageState: WorkflowState,
    outputFile: string,
    adapter: CliAgentAdapter
  ): void {
    const runToken = ++this.activeRunToken;
    const relativeOutputFile = vscode.workspace.asRelativePath(outputFile, false);
    let invalidAttempts = 0;
    const stageStartedAt = Date.parse(stageState.updatedAt);

    const processOutput = async () => {
      if (runToken !== this.activeRunToken) {
        return;
      }

      try {
        const exists = await store.exists(outputFile);
        if (!exists) {
          return;
        }

        const stat = await store.stat(outputFile);
        if (stat.mtimeMs < stageStartedAt) {
          return;
        }

        const raw = await store.readText(outputFile);
        if (!raw.trim()) {
          invalidAttempts += 1;
          await this.handleInvalidOutput(store, stageState, "empty_output", invalidAttempts, settings);
          return;
        }

        const parsed = adapter.parseOutput(stage, raw);
        const nextState = advanceWorkflow(stageState, settings.workflow.stages, parsed, new Date().toISOString());

        this.clearActiveMonitoring();
        await store.writeState(nextState);
        await store.appendLog(`Stage ${stage.id} completed with status ${nextState.status}.`);
        this.changeEmitter.fire();

        if (nextState.status === "idle" && settings.workflow.autoRun) {
          await this.runActiveStage();
        }
      } catch (error) {
        invalidAttempts += 1;
        const reason = error instanceof SyntaxError ? "invalid_json" : "conflicting_result";
        await this.handleInvalidOutput(store, stageState, reason, invalidAttempts, settings, error);
      }
    };

    const scheduleProcess = () => {
      if (this.activeDebounce) {
        clearTimeout(this.activeDebounce);
      }

      this.activeDebounce = setTimeout(() => {
        void processOutput();
      }, settings.runtime.watchDebounceMs);
    };

    this.activeWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(getWorkspaceRoot(), relativeOutputFile));
    this.activeWatcher.onDidCreate(scheduleProcess);
    this.activeWatcher.onDidChange(scheduleProcess);
    this.activeTimeout = setTimeout(() => {
      void this.failStage(store, stageState, "timeout", `Stage ${stage.id} timed out waiting for output.`);
    }, settings.workflow.timeoutSeconds * 1000);
  }

  private async handleInvalidOutput(
    store: RuntimeStore,
    stageState: WorkflowState,
    reason: FailureReason,
    invalidAttempts: number,
    settings: ExtensionSettings,
    error?: unknown
  ): Promise<void> {
    await store.appendLog(
      `Invalid output for stage ${stageState.stage} (${reason}, attempt ${invalidAttempts}/${settings.runtime.invalidOutputRetries}).`
    );

    if (invalidAttempts > settings.runtime.invalidOutputRetries) {
      await this.failStage(store, stageState, reason, error instanceof Error ? error.message : undefined);
      return;
    }

    this.changeEmitter.fire();
  }

  private async failStage(
    store: RuntimeStore,
    stageState: WorkflowState,
    reason: FailureReason,
    message?: string
  ): Promise<void> {
    if (this.activeRunToken === 0) {
      return;
    }

    this.clearActiveMonitoring();
    const failedState: WorkflowState = {
      ...stageState,
      status: "failed",
      failureReason: reason,
      updatedAt: new Date().toISOString()
    };
    await store.writeState(failedState);
    await store.appendLog(`Workflow failed: ${reason}${message ? ` (${message})` : ""}`);
    this.changeEmitter.fire();
    vscode.window.showWarningMessage(`Dual Agent workflow failed: ${reason}`);
  }

  private clearActiveMonitoring(): void {
    this.activeRunToken += 1;

    if (this.activeWatcher) {
      this.activeWatcher.dispose();
      this.activeWatcher = undefined;
    }

    if (this.activeTimeout) {
      clearTimeout(this.activeTimeout);
      this.activeTimeout = undefined;
    }

    if (this.activeDebounce) {
      clearTimeout(this.activeDebounce);
      this.activeDebounce = undefined;
    }
  }

  private showError(error: unknown): void {
    const message = error instanceof Error ? error.message : "Unknown Dual Agent error";
    void vscode.window.showErrorMessage(message);
  }

  private async showPreflightIssues(issues: Awaited<ReturnType<typeof runAgentPreflight>>): Promise<void> {
    const details = issues
      .map((issue) =>
        issue.reason === "missing_executable"
          ? `${issue.agentName}: executable not found (${issue.executable})`
          : `${issue.agentName}: could not infer executable from command template`
      )
      .join("; ");

    await vscode.window.showErrorMessage(`Dual Agent preflight failed: ${details}`);
  }
}
