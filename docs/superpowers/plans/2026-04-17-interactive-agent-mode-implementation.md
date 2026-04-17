# Interactive Agent Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the extension from one-shot shell command execution to managed interactive Claude and Codex sessions that advance stages only when both a sentinel line and a valid JSON artifact are observed.

**Architecture:** Keep the existing runtime file protocol and state machine, but replace command-template execution with extension-managed child processes. Each agent runs in a persistent session that is mirrored into VS Code through a pseudoterminal, while the orchestrator coordinates prompts, sentinel matching, JSON validation, and workflow transitions.

**Tech Stack:** TypeScript, VS Code Extension API, Node.js child_process streams, Vitest

---

## File Structure

- Create: `src/vscode/agent-session.ts`
- Create: `src/vscode/agent-terminal.ts`
- Create: `src/test/agent-session.test.ts`
- Create: `src/test/orchestrator-interactive.test.ts`
- Modify: `src/core/defaults.ts`
- Modify: `src/vscode/config.ts`
- Modify: `src/vscode/preflight.ts`
- Modify: `src/vscode/cli-adapter.ts`
- Modify: `src/vscode/orchestrator.ts`
- Modify: `src/vscode/tree-data.ts`
- Modify: `src/extension.ts`
- Modify: `src/test/cli-adapter.test.ts`
- Modify: `src/test/preflight.test.ts`
- Modify: `README.md`
- Test: `src/test/agent-session.test.ts`
- Test: `src/test/orchestrator-interactive.test.ts`

### Task 1: Define the interactive adapter contract

**Files:**
- Modify: `src/vscode/cli-adapter.ts`
- Modify: `src/core/defaults.ts`
- Modify: `src/test/cli-adapter.test.ts`

- [ ] **Step 1: Write the failing adapter tests for launch config, workspace-relative prompts, and sentinel rendering**

```ts
it("builds the interactive Claude launch configuration", () => {
  const launch = adapter.getLaunchConfig("win32");
  expect(launch.executable).toBe("claude");
  expect(launch.args).toEqual([]);
});

it("renders a stage prompt with a concrete sentinel line", () => {
  const prompt = adapter.buildInteractivePrompt(stage, {
    workflowId: "wf-1",
    stageId: "agent_a_generate",
    sentinel: "[DUAL_AGENT] workflow=wf-1 stage=agent_a_generate token=t1 status=done"
  });

  expect(prompt).toContain(".vscode/dual-agent/task.md");
  expect(prompt).toContain("print the sentinel line exactly once");
  expect(prompt).toContain("[DUAL_AGENT] workflow=wf-1 stage=agent_a_generate token=t1 status=done");
});
```

- [ ] **Step 2: Run the focused adapter test to verify it fails**

Run: `npm test -- src/test/cli-adapter.test.ts`
Expected: FAIL because `getLaunchConfig` and `buildInteractivePrompt` do not exist yet

- [ ] **Step 3: Replace shell-command assembly with launch-config and sentinel-aware prompt rendering**

```ts
export interface AgentLaunchConfig {
  executable: string;
  args: string[];
  env?: Record<string, string>;
}

export interface StageExecutionEnvelope {
  workflowId: string;
  stageId: string;
  sentinel: string;
}

getLaunchConfig(): AgentLaunchConfig {
  return {
    executable: this.settings.executable,
    args: this.settings.args
  };
}

buildInteractivePrompt(stage: StageDefinition, envelope: StageExecutionEnvelope): string {
  const basePrompt = this.buildPrompt(stage);
  return [
    `Workflow: ${envelope.workflowId}`,
    `Stage: ${envelope.stageId}`,
    "",
    "After writing the required JSON artifact, print this sentinel line exactly once on its own line:",
    envelope.sentinel,
    "",
    basePrompt
  ].join("\n");
}
```

- [ ] **Step 4: Update defaults so built-in agents use executable-plus-args instead of shell wrappers**

```ts
export const DEFAULT_AGENT_A = {
  name: "Claude",
  executable: "claude",
  args: [],
  prompts: {
    generate: CLAUDE_GENERATE_PROMPT,
    review: CLAUDE_REVIEW_PROMPT
  }
} as const;
```

- [ ] **Step 5: Re-run the adapter test to verify it passes**

Run: `npm test -- src/test/cli-adapter.test.ts`
Expected: PASS

- [ ] **Step 6: Commit the adapter contract change**

```bash
git add src/vscode/cli-adapter.ts src/core/defaults.ts src/test/cli-adapter.test.ts
git commit -m "refactor: replace shell wrappers with interactive adapter config"
```

### Task 2: Add interactive settings and executable-only preflight

**Files:**
- Modify: `src/vscode/config.ts`
- Modify: `src/vscode/preflight.ts`
- Modify: `src/test/preflight.test.ts`

- [ ] **Step 1: Write failing tests for executable-only settings and preflight validation**

```ts
it("classifies configured executables without parsing shell templates", async () => {
  const issues = await runAgentPreflight(makeSettings({
    agents: {
      agent_a: { executable: "claude", args: [] },
      agent_b: { executable: "codex", args: [] }
    }
  }));

  expect(issues).toEqual([]);
});
```

- [ ] **Step 2: Run the focused preflight tests to verify they fail**

Run: `npm test -- src/test/preflight.test.ts`
Expected: FAIL because settings still depend on `commandTemplate`

- [ ] **Step 3: Change agent settings to executable/args/mode fields and keep migration fallback for old command-template users**

```ts
export interface AgentSettings {
  id: AgentId;
  name: string;
  mode: "interactive";
  executable: string;
  args: string[];
  prompts: {
    generate: string;
    review: string;
  };
}
```

- [ ] **Step 4: Simplify preflight to validate executables directly**

```ts
export async function runAgentPreflight(settings: ExtensionSettings): Promise<PreflightIssue[]> {
  const issues: PreflightIssue[] = [];

  for (const [agentId, agent] of Object.entries(settings.agents) as Array<[AgentId, AgentSettings]>) {
    const available = await isExecutableAvailable(agent.executable);

    if (!available) {
      issues.push({
        agentId,
        agentName: agent.name,
        executable: agent.executable,
        reason: "missing_executable"
      });
    }
  }

  return issues;
}
```

- [ ] **Step 5: Re-run the preflight test to verify it passes**

Run: `npm test -- src/test/preflight.test.ts`
Expected: PASS

- [ ] **Step 6: Commit the settings and preflight changes**

```bash
git add src/vscode/config.ts src/vscode/preflight.ts src/test/preflight.test.ts
git commit -m "refactor: switch dual agent settings to interactive executables"
```

### Task 3: Implement managed agent sessions and terminal mirroring

**Files:**
- Create: `src/vscode/agent-terminal.ts`
- Create: `src/vscode/agent-session.ts`
- Create: `src/test/agent-session.test.ts`

- [ ] **Step 1: Write failing tests for session startup, prompt send, sentinel detection, and exit propagation**

```ts
it("emits a stage-complete event when stdout contains the active sentinel", async () => {
  const session = createSessionHarness();
  await session.start();
  session.beginStage("agent_a_generate", "[DUAL_AGENT] workflow=wf-1 stage=agent_a_generate token=t1 status=done");
  session.pushStdout("work in progress\n");
  session.pushStdout("[DUAL_AGENT] workflow=wf-1 stage=agent_a_generate token=t1 status=done\n");
  expect(session.takeStageEvents()).toEqual([
    { stageId: "agent_a_generate", sentinel: "[DUAL_AGENT] workflow=wf-1 stage=agent_a_generate token=t1 status=done" }
  ]);
});
```

- [ ] **Step 2: Run the focused session test to verify it fails**

Run: `npm test -- src/test/agent-session.test.ts`
Expected: FAIL because no session class exists yet

- [ ] **Step 3: Add a pseudoterminal bridge that mirrors stdout/stderr and accepts optional user input**

```ts
export class AgentTerminal implements vscode.Pseudoterminal {
  private readonly writeEmitter = new vscode.EventEmitter<string>();
  readonly onDidWrite = this.writeEmitter.event;

  write(data: string): void {
    this.writeEmitter.fire(data);
  }

  open(): void {}

  close(): void {}
}
```

- [ ] **Step 4: Add the session class around a persistent child process**

```ts
export class AgentSession extends vscode.Disposable {
  async start(): Promise<void> {
    this.process = spawn(this.launch.executable, this.launch.args, {
      cwd: this.workspaceRoot,
      env: { ...process.env, ...this.launch.env },
      stdio: "pipe"
    });

    this.process.stdout?.on("data", (chunk) => this.handleOutput(chunk.toString("utf8"), "stdout"));
    this.process.stderr?.on("data", (chunk) => this.handleOutput(chunk.toString("utf8"), "stderr"));
    this.process.on("exit", (code, signal) => this.handleExit(code, signal));
  }

  sendPrompt(prompt: string): void {
    this.process?.stdin?.write(prompt);
    this.process?.stdin?.write("\n");
  }
}
```

- [ ] **Step 5: Add active-stage sentinel tracking and stage event emission**

```ts
beginStage(stageId: string, sentinel: string): void {
  this.activeStage = { stageId, sentinel, matched: false };
}

private handleOutput(data: string, source: "stdout" | "stderr"): void {
  this.terminal.write(data.replace(/\n/g, "\r\n"));

  if (source === "stdout" && this.activeStage && data.includes(this.activeStage.sentinel) && !this.activeStage.matched) {
    this.activeStage.matched = true;
    this.stageCompleteEmitter.fire({
      stageId: this.activeStage.stageId,
      sentinel: this.activeStage.sentinel
    });
  }
}
```

- [ ] **Step 6: Re-run the session tests to verify they pass**

Run: `npm test -- src/test/agent-session.test.ts`
Expected: PASS

- [ ] **Step 7: Commit the session infrastructure**

```bash
git add src/vscode/agent-terminal.ts src/vscode/agent-session.ts src/test/agent-session.test.ts
git commit -m "feat: add managed interactive agent sessions"
```

### Task 4: Refactor the orchestrator to use sessions and dual completion checks

**Files:**
- Modify: `src/vscode/orchestrator.ts`
- Create: `src/test/orchestrator-interactive.test.ts`

- [ ] **Step 1: Write failing orchestrator tests for sentinel-only, file-only, and dual-signal completion**

```ts
it("does not advance when the sentinel arrives before the JSON artifact", async () => {
  const harness = await createOrchestratorHarness();
  await harness.startWorkflow();
  harness.emitSentinel("agent_a", "agent_a_generate");
  expect(await harness.readState()).toMatchObject({ stage: "agent_a_generate", status: "waiting_output" });
});

it("advances when both sentinel and valid JSON are present", async () => {
  const harness = await createOrchestratorHarness();
  await harness.startWorkflow();
  await harness.writeStageOutput("agent_a_generate", validGenerationOutput("agent_a"));
  harness.emitSentinel("agent_a", "agent_a_generate");
  expect(await harness.readState()).toMatchObject({ stage: "agent_b_review", status: "idle" });
});
```

- [ ] **Step 2: Run the focused orchestrator tests to verify they fail**

Run: `npm test -- src/test/orchestrator-interactive.test.ts`
Expected: FAIL because the orchestrator still depends on `terminal.sendText(command, true)`

- [ ] **Step 3: Replace terminal creation with session creation and stage dispatch**

```ts
private async ensureSession(actor: AgentId, settings: ExtensionSettings, store: RuntimeStore): Promise<AgentSession> {
  const existing = this.sessions.get(actor);
  if (existing) {
    return existing;
  }

  const adapter = this.getAdapterForActor(actor, settings, store);
  const session = new AgentSession(adapter.getLaunchConfig(), getWorkspaceRoot(), adapter.getTerminalName());
  await session.start();
  this.sessions.set(actor, session);
  return session;
}
```

- [ ] **Step 4: Add per-stage sentinel generation and dual completion state tracking**

```ts
const sentinel = this.createStageSentinel(state.workflowId, stage.id);
this.activeStageCompletion = {
  stageId: stage.id,
  actor: stage.actor,
  sentinel,
  outputFile,
  sentinelSeen: false,
  artifactSeen: false
};
```

- [ ] **Step 5: Start the stage by writing the prompt file, sending the prompt to the live session, and waiting for both signals**

```ts
await store.writePrompt(promptFile, prompt);
session.beginStage(stage.id, sentinel);
session.sendPrompt(adapter.buildInteractivePrompt(stage, {
  workflowId: state.workflowId,
  stageId: stage.id,
  sentinel
}));
```

- [ ] **Step 6: Advance only when the current stage has both a matched sentinel and a parseable output artifact**

```ts
if (!completion.sentinelSeen || !completion.artifactSeen) {
  return;
}

const parsed = adapter.parseOutput(stage, await store.readText(outputFile));
const nextState = advanceWorkflow(stageState, settings.workflow.stages, parsed, new Date().toISOString());
```

- [ ] **Step 7: Re-run the orchestrator tests to verify they pass**

Run: `npm test -- src/test/orchestrator-interactive.test.ts`
Expected: PASS

- [ ] **Step 8: Commit the interactive orchestrator**

```bash
git add src/vscode/orchestrator.ts src/test/orchestrator-interactive.test.ts
git commit -m "feat: drive workflow through interactive agent sessions"
```

### Task 5: Update sidebar, activation wiring, and docs

**Files:**
- Modify: `src/vscode/tree-data.ts`
- Modify: `src/extension.ts`
- Modify: `README.md`

- [ ] **Step 1: Add sidebar items for session state and active sentinel**

```ts
{ label: `Agent A Session: ${snapshot.agentSessions.agent_a}` },
{ label: `Agent B Session: ${snapshot.agentSessions.agent_b}` },
{ label: `Sentinel: ${snapshot.activeSentinel ?? "n/a"}` }
```

- [ ] **Step 2: Ensure extension activation disposes managed sessions on shutdown**

```ts
export function deactivate(): void {
  // no-op because orchestrator dispose handles sessions
}
```

- [ ] **Step 3: Rewrite README usage and configuration sections for interactive startup**

```md
The extension now starts persistent Claude and Codex sessions and injects prompts into those live processes. A stage completes only when the active agent prints the expected sentinel line and writes a valid JSON artifact under `.vscode/dual-agent/`.
```

- [ ] **Step 4: Run typecheck and the full test suite**

Run: `npm run typecheck`
Expected: PASS

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit the UI and documentation update**

```bash
git add src/vscode/tree-data.ts src/extension.ts README.md
git commit -m "docs: explain interactive dual agent workflow"
```

### Task 6: Final verification and packaging

**Files:**
- Modify: `package.json`
- Modify: `README.md`

- [ ] **Step 1: Update package metadata if the version changes during the refactor**

```json
{
  "version": "0.2.0"
}
```

- [ ] **Step 2: Run the build**

Run: `npm run build`
Expected: PASS and emit updated files under `dist/`

- [ ] **Step 3: Build the VSIX**

Run: `npm run package:vsix`
Expected: PASS and produce a new `.vsix` for the interactive-mode release

- [ ] **Step 4: Check git status before finishing**

Run: `git status --short`
Expected: clean working tree except for intended versioned artifacts
