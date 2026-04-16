# Dual Agent VS Code Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone VS Code extension that orchestrates a deterministic two-agent generate/review workflow through `.vscode/dual-agent/` files and integrated terminals.

**Architecture:** Keep workflow logic in pure TypeScript modules and make the VS Code layer thin. The extension registers commands and a sidebar, while an orchestrator coordinates terminals, file watchers, runtime files, and state transitions.

**Tech Stack:** TypeScript, VS Code Extension API, Vitest, Node.js fs/path utilities

---

## File Structure

- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.vscodeignore`
- Create: `README.md`
- Create: `src/extension.ts`
- Create: `src/core/types.ts`
- Create: `src/core/templates.ts`
- Create: `src/core/protocol.ts`
- Create: `src/core/transitions.ts`
- Create: `src/core/runtime-paths.ts`
- Create: `src/vscode/config.ts`
- Create: `src/vscode/runtime-store.ts`
- Create: `src/vscode/cli-adapter.ts`
- Create: `src/vscode/orchestrator.ts`
- Create: `src/vscode/tree-data.ts`
- Create: `src/test/templates.test.ts`
- Create: `src/test/protocol.test.ts`
- Create: `src/test/transitions.test.ts`
- Create: `src/test/runtime-paths.test.ts`

### Task 1: Scaffold the extension package

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.vscodeignore`
- Create: `README.md`

- [ ] **Step 1: Add package metadata, scripts, VS Code contribution points, and dependencies**

```json
{
  "name": "dual-agent-vscode",
  "displayName": "Dual Agent Workflow",
  "main": "./dist/extension.js",
  "scripts": {
    "build": "tsc -p .",
    "test": "vitest run",
    "typecheck": "tsc -p . --noEmit"
  }
}
```

- [ ] **Step 2: Add TypeScript and Vitest configuration**

```json
{
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  }
}
```

- [ ] **Step 3: Run install and verify the empty package config resolves**

Run: `npm install`
Expected: dependencies installed and `package-lock.json` created

- [ ] **Step 4: Run the typecheck before production code exists**

Run: `npm run typecheck`
Expected: fail until source files are added

### Task 2: Write failing tests for workflow core

**Files:**
- Create: `src/test/templates.test.ts`
- Create: `src/test/protocol.test.ts`
- Create: `src/test/transitions.test.ts`
- Create: `src/test/runtime-paths.test.ts`
- Test: `src/core/templates.ts`
- Test: `src/core/protocol.ts`
- Test: `src/core/transitions.ts`
- Test: `src/core/runtime-paths.ts`

- [ ] **Step 1: Write the failing template rendering tests**

```ts
it("replaces prompt placeholders with runtime values", () => {
  const result = renderTemplate("Task: {{taskFile}}", { taskFile: "/tmp/task.md" });
  expect(result).toBe("Task: /tmp/task.md");
});
```

- [ ] **Step 2: Write the failing protocol validation tests**

```ts
it("accepts a valid review payload", () => {
  const parsed = parseReviewOutput(JSON.stringify(validReviewPayload));
  expect(parsed.reviewer).toBe("agent_b");
});
```

- [ ] **Step 3: Write the failing transition tests**

```ts
it("marks the workflow done when a review stage has no issues", () => {
  const next = advanceWorkflow(currentState, stageDefinitions, validApprovalReview);
  expect(next.status).toBe("done");
});
```

- [ ] **Step 4: Write the failing runtime path tests**

```ts
it("derives the runtime folder under .vscode/dual-agent", () => {
  const paths = createRuntimePaths("c:/repo", defaultFileConfig);
  expect(paths.runtimeDir).toContain(".vscode/dual-agent");
});
```

- [ ] **Step 5: Run the tests to verify they fail for missing modules**

Run: `npm test`
Expected: FAIL because the tested modules do not exist yet

### Task 3: Implement the workflow core

**Files:**
- Create: `src/core/types.ts`
- Create: `src/core/templates.ts`
- Create: `src/core/protocol.ts`
- Create: `src/core/transitions.ts`
- Create: `src/core/runtime-paths.ts`
- Test: `src/test/templates.test.ts`
- Test: `src/test/protocol.test.ts`
- Test: `src/test/transitions.test.ts`
- Test: `src/test/runtime-paths.test.ts`

- [ ] **Step 1: Add shared types for agents, stages, outputs, and state**

```ts
export type AgentId = "agent_a" | "agent_b";
export type StageMode = "generate" | "review";
```

- [ ] **Step 2: Implement minimal template rendering**

```ts
export function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? "");
}
```

- [ ] **Step 3: Implement protocol parsing and validation**

```ts
export function parseReviewOutput(raw: string): ReviewOutput {
  const parsed = JSON.parse(raw) as ReviewOutput;
  if (parsed.type !== "review") {
    throw new Error("Expected review output");
  }
  return parsed;
}
```

- [ ] **Step 4: Implement state transition rules, repeated issue detection, and iteration overflow**

```ts
if (stage.mode === "review" && output.issues.length === 0) {
  return { ...state, status: "done" };
}
```

- [ ] **Step 5: Implement runtime path derivation helpers**

```ts
export function createRuntimePaths(workspaceRoot: string, files: WorkflowFileConfig): RuntimePaths {
  return {
    runtimeDir: path.join(workspaceRoot, ".vscode", "dual-agent")
  };
}
```

- [ ] **Step 6: Run the tests to verify the core passes**

Run: `npm test`
Expected: PASS for all core tests

### Task 4: Implement VS Code configuration and runtime store

**Files:**
- Create: `src/vscode/config.ts`
- Create: `src/vscode/runtime-store.ts`
- Modify: `src/core/types.ts`

- [ ] **Step 1: Add settings readers with defaults for workflow, agents, and runtime**

```ts
const config = vscode.workspace.getConfiguration("dualAgent");
const maxIterations = config.get<number>("workflow.maxIterations", 5);
```

- [ ] **Step 2: Add runtime store helpers to initialize files and persist state**

```ts
await fs.mkdir(paths.promptsDir, { recursive: true });
await fs.writeFile(paths.stateFile, JSON.stringify(state, null, 2));
```

- [ ] **Step 3: Add log append helpers for session events**

```ts
await fs.appendFile(paths.logFile, `${timestamp} ${message}\n`, "utf8");
```

- [ ] **Step 4: Run tests and typecheck after introducing the runtime store**

Run: `npm test`
Expected: PASS

Run: `npm run typecheck`
Expected: may still FAIL until VS Code-facing modules are implemented

### Task 5: Implement CLI adapter and orchestrator

**Files:**
- Create: `src/vscode/cli-adapter.ts`
- Create: `src/vscode/orchestrator.ts`
- Modify: `src/core/protocol.ts`
- Modify: `src/core/transitions.ts`

- [ ] **Step 1: Add the CLI adapter to render prompt files and command strings**

```ts
const prompt = renderTemplate(template, values);
await fs.writeFile(promptFile, prompt, "utf8");
terminal.sendText(command, true);
```

- [ ] **Step 2: Add orchestrator start/reset/stop/run-next flows**

```ts
await runtimeStore.initializeSession(taskContent);
await this.runActiveStage();
```

- [ ] **Step 3: Add file watcher driven stage completion handling**

```ts
watcher.onDidChange(async () => {
  await this.tryCompleteStage(expectedOutputFile);
});
```

- [ ] **Step 4: Add auto-run behavior and error transitions**

```ts
if (this.settings.workflow.autoRun && nextState.status === "running") {
  await this.runActiveStage();
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test`
Expected: PASS

Run: `npm run typecheck`
Expected: PASS

### Task 6: Implement the sidebar and extension activation

**Files:**
- Create: `src/vscode/tree-data.ts`
- Create: `src/extension.ts`
- Modify: `package.json`
- Modify: `README.md`

- [ ] **Step 1: Add tree items for session, agents, artifacts, and actions**

```ts
treeItem.command = {
  command: "dualAgent.startWorkflow",
  title: "Start Workflow"
};
```

- [ ] **Step 2: Register commands and wire the tree provider to the orchestrator**

```ts
context.subscriptions.push(
  vscode.commands.registerCommand("dualAgent.startWorkflow", () => orchestrator.startWorkflow())
);
```

- [ ] **Step 3: Add package command contributions and configuration schema**

```json
{
  "contributes": {
    "commands": [],
    "views": {
      "explorer": []
    }
  }
}
```

- [ ] **Step 4: Document how to configure Agent A and Agent B command templates**

```md
Configure `dualAgent.agentA.commandTemplate` and `dualAgent.agentB.commandTemplate` with placeholders such as `{{promptFile}}` and `{{outputFile}}`.
```

- [ ] **Step 5: Run the full verification set**

Run: `npm test`
Expected: PASS

Run: `npm run typecheck`
Expected: PASS

Run: `npm run build`
Expected: PASS and emit `dist/`

### Task 7: Final local packaging sanity check

**Files:**
- Modify: `README.md`
- Modify: `.vscodeignore`

- [ ] **Step 1: Confirm the package is ready for VSIX packaging**

Run: `npm pack`
Expected: PASS and produce a tarball with `dist/`, `README.md`, and package metadata

- [ ] **Step 2: Update README with verification commands and runtime artifact description**

```md
Runtime coordination lives under `.vscode/dual-agent/`.
```

- [ ] **Step 3: Re-run the build and tests after documentation adjustments**

Run: `npm test && npm run build`
Expected: PASS
