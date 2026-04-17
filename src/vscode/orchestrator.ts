import * as vscode from "vscode";

import { advanceWorkflow } from "../core/transitions";
import type { AgentId, AgentOutput, FailureReason, StageDefinition, WorkflowState } from "../core/types";
import { AgentSession, type AgentSessionStatus, type ExitEvent, type StageCompleteEvent } from "./agent-session";
import { AgentTerminal } from "./agent-terminal";
import { CliAgentAdapter } from "./cli-adapter";
import {
  getActiveStage,
  getExtensionSettings,
  getWorkspaceRoot,
  repairLegacyCommandTemplateSettings,
  type ExtensionSettings
} from "./config";
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

interface ManagedAgentSession {
  start(): Promise<void>;
  beginStage(stageId: string, sentinel: string): void;
  sendPrompt(prompt: string): void;
  stop(): void;
  onStageComplete(listener: (event: StageCompleteEvent) => void): () => void;
  onExit(listener: (event: ExitEvent) => void): () => void;
  getStatus?(): AgentSessionStatus;
}

interface StageCompletionState {
  runToken: number;
  stage: StageDefinition;
  stageState: WorkflowState;
  settings: ExtensionSettings;
  store: RuntimeStore;
  adapter: CliAgentAdapter;
  outputFile: string;
  sentinel: string;
  sentinelSeen: boolean;
  parsedOutput: AgentOutput | null;
  invalidAttempts: number;
}

export interface OrchestratorOptions {
  createSession?: (
    actor: AgentId,
    settings: ExtensionSettings,
    store: RuntimeStore,
    adapter: CliAgentAdapter
  ) => ManagedAgentSession;
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

  private readonly sessions = new Map<AgentId, ManagedAgentSession>();
  private readonly sessionSubscriptions = new Map<AgentId, Array<() => void>>();
  private readonly terminalViews = new Map<AgentId, vscode.Terminal>();
  private readonly terminalBridges = new Map<AgentId, AgentTerminal>();
  private activeWatcher: vscode.FileSystemWatcher | undefined;
  private activeTimeout: NodeJS.Timeout | undefined;
  private activeDebounce: NodeJS.Timeout | undefined;
  private activeRunToken = 0;
  private activeCompletion: StageCompletionState | null = null;

  constructor(private readonly options: OrchestratorOptions = {}) {}

  dispose(): void {
    this.clearActiveMonitoring();
    this.stopSessions();
    this.changeEmitter.dispose();
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
      this.stopSessions();
      await store.initializeSession(initialState);
      await this.ensureAllSessions(settings, store);
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
      this.stopSessions();
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
      this.stopSessions();
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

  async repairLegacyTemplates(): Promise<void> {
    try {
      const updated = await repairLegacyCommandTemplateSettings();

      if (updated > 0) {
        await vscode.window.showInformationMessage(
          `Updated ${updated} legacy Dual Agent command template setting${updated === 1 ? "" : "s"}.`
        );
      } else {
        await vscode.window.showInformationMessage("No legacy Dual Agent command templates were found.");
      }

      this.changeEmitter.fire();
    } catch (error) {
      this.showError(error);
    }
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
          { label: `Waiting For: ${expectedOutput ?? "n/a"}` },
          { label: `Sentinel: ${this.activeCompletion?.sentinel ?? "n/a"}` }
        ],
        agents: [
          {
            label: `${settings.agents.agent_a.name}`,
            description: `${this.getSessionStatus("agent_a")} | ${settings.agents.agent_a.executable}`
          },
          {
            label: `${settings.agents.agent_b.name}`,
            description: `${this.getSessionStatus("agent_b")} | ${settings.agents.agent_b.executable}`
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

  private getSessionStatus(actor: AgentId): AgentSessionStatus | "not_started" {
    const session = this.sessions.get(actor);
    return session?.getStatus?.() ?? "not_started";
  }

  private async ensureAllSessions(settings: ExtensionSettings, store: RuntimeStore): Promise<void> {
    await this.ensureSession("agent_a", settings, store);
    await this.ensureSession("agent_b", settings, store);
  }

  private async ensureSession(actor: AgentId, settings: ExtensionSettings, store: RuntimeStore): Promise<ManagedAgentSession> {
    const existing = this.sessions.get(actor);

    if (existing) {
      return existing;
    }

    const stage = settings.workflow.stages.find((item) => item.actor === actor) ?? settings.workflow.stages[0];

    if (!stage) {
      throw new Error(`No workflow stage configured for ${actor}.`);
    }

    const adapter = this.getAdapter(stage, settings, store);
    const session = this.options.createSession?.(actor, settings, store, adapter) ?? this.createDefaultSession(actor, adapter);
    const subscriptions = [
      session.onStageComplete((event) => {
        void this.handleStageComplete(actor, event);
      }),
      session.onExit((event) => {
        void this.handleSessionExit(actor, event);
      })
    ];

    this.sessions.set(actor, session);
    this.sessionSubscriptions.set(actor, subscriptions);
    await session.start();
    return session;
  }

  private createDefaultSession(actor: AgentId, adapter: CliAgentAdapter): ManagedAgentSession {
    const bridge = new AgentTerminal();
    const terminal = vscode.window.createTerminal({
      name: adapter.getTerminalName(),
      pty: bridge
    });

    this.terminalViews.set(actor, terminal);
    this.terminalBridges.set(actor, bridge);

    return new AgentSession({
      actor,
      launch: adapter.getLaunchConfig(),
      workspaceRoot: getWorkspaceRoot(),
      writeTerminal: (data) => {
        bridge.write(data);
      }
    });
  }

  private stopSessions(): void {
    for (const subscriptions of this.sessionSubscriptions.values()) {
      for (const unsubscribe of subscriptions) {
        unsubscribe();
      }
    }

    this.sessionSubscriptions.clear();

    for (const session of this.sessions.values()) {
      session.stop();
    }

    this.sessions.clear();

    for (const terminal of this.terminalViews.values()) {
      terminal.dispose();
    }

    this.terminalViews.clear();

    for (const bridge of this.terminalBridges.values()) {
      bridge.dispose();
    }

    this.terminalBridges.clear();
  }

  private createStageSentinel(workflowId: string, stageId: string): string {
    const token = Math.random().toString(36).slice(2, 10);
    return `[DUAL_AGENT] workflow=${workflowId} stage=${stageId} token=${token} status=done`;
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
    const session = await this.ensureSession(stage.actor, settings, store);
    const promptFile = adapter.getPromptFile(stage);
    const outputFile = adapter.getExpectedOutputFile(stage);
    const sentinel = this.createStageSentinel(state.workflowId, stage.id);
    const prompt = adapter.buildInteractivePrompt(stage, {
      workflowId: state.workflowId,
      stageId: stage.id,
      sentinel
    });
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

    this.startMonitoring(settings, store, stage, runningState, outputFile, adapter, sentinel);

    session.beginStage(stage.id, sentinel);
    this.terminalViews.get(stage.actor)?.show(false);
    session.sendPrompt(prompt);

    this.changeEmitter.fire();
  }

  private startMonitoring(
    settings: ExtensionSettings,
    store: RuntimeStore,
    stage: StageDefinition,
    stageState: WorkflowState,
    outputFile: string,
    adapter: CliAgentAdapter,
    sentinel: string
  ): void {
    const runToken = ++this.activeRunToken;
    const relativeOutputFile = vscode.workspace.asRelativePath(outputFile, false);

    this.activeCompletion = {
      runToken,
      stage,
      stageState,
      settings,
      store,
      adapter,
      outputFile,
      sentinel,
      sentinelSeen: false,
      parsedOutput: null,
      invalidAttempts: 0
    };

    const processOutput = async () => {
      const completion = this.activeCompletion;
      if (!completion || completion.runToken !== this.activeRunToken || completion.runToken !== runToken) {
        return;
      }

      try {
        const exists = await store.exists(outputFile);
        if (!exists) {
          return;
        }

        const raw = await store.readText(outputFile);
        if (!raw.trim()) {
          completion.invalidAttempts += 1;
          await this.handleInvalidOutput(store, stageState, "empty_output", completion.invalidAttempts, settings);
          return;
        }

        completion.parsedOutput = adapter.parseOutput(stage, raw);
        await this.tryCompleteStage(completion);
      } catch (error) {
        const completionState = this.activeCompletion;
        if (!completionState || completionState.runToken !== runToken) {
          return;
        }

        completionState.invalidAttempts += 1;
        const reason = error instanceof SyntaxError ? "invalid_json" : "conflicting_result";
        await this.handleInvalidOutput(store, stageState, reason, completionState.invalidAttempts, settings, error);
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

  private async handleStageComplete(actor: AgentId, event: StageCompleteEvent): Promise<void> {
    const completion = this.activeCompletion;

    if (!completion || actor !== completion.stage.actor) {
      return;
    }

    if (event.stageId !== completion.stage.id || event.sentinel !== completion.sentinel) {
      return;
    }

    completion.sentinelSeen = true;
    await completion.store.appendLog(`Received sentinel for stage ${event.stageId}.`);
    await this.tryCompleteStage(completion);
  }

  private async handleSessionExit(actor: AgentId, event: ExitEvent): Promise<void> {
    const completion = this.activeCompletion;

    if (!completion || actor !== completion.stage.actor) {
      return;
    }

    await this.failStage(
      completion.store,
      completion.stageState,
      "terminal_launch_failed",
      `Agent session exited (code=${event.code ?? "null"}, signal=${event.signal ?? "null"}).`
    );
  }

  private async tryCompleteStage(completion: StageCompletionState): Promise<void> {
    if (!this.activeCompletion || this.activeCompletion.runToken !== completion.runToken) {
      return;
    }

    if (!completion.sentinelSeen || !completion.parsedOutput) {
      return;
    }

    const nextState = advanceWorkflow(
      completion.stageState,
      completion.settings.workflow.stages,
      completion.parsedOutput,
      new Date().toISOString()
    );

    this.clearActiveMonitoring();
    await completion.store.writeState(nextState);
    await completion.store.appendLog(`Stage ${completion.stage.id} completed with status ${nextState.status}.`);
    this.changeEmitter.fire();

    if (nextState.status === "idle" && completion.settings.workflow.autoRun) {
      await this.runActiveStage();
    }
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
    this.activeCompletion = null;

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
          : issue.reason === "legacy_template"
            ? `${issue.agentName}: legacy command template detected`
            : `${issue.agentName}: could not infer executable from command template`
      )
      .join("; ");

    const hasLegacy = issues.some((issue) => issue.reason === "legacy_template");
    const action = await vscode.window.showErrorMessage(
      `Dual Agent preflight failed: ${details}`,
      ...(hasLegacy ? ["Update Settings"] : []),
      "Open Settings"
    );

    if (action === "Update Settings") {
      await this.repairLegacyTemplates();
      return;
    }

    if (action === "Open Settings") {
      await this.openSettings();
    }
  }
}
