# Dual Agent VS Code Extension Design

## Goal

Build a standalone VS Code extension that orchestrates a deterministic dual-agent review workflow in a single workspace. The extension must support two configurable agent CLIs, store workflow state in `.vscode/dual-agent/`, and coordinate all stages through files plus a state machine rather than shared memory.

## Product Scope

### In Scope

- Standalone VS Code extension package
- Command palette entry points and a sidebar view
- Fixed two-agent product model: `Agent A` and `Agent B`
- Configurable workflow stages, runtime file names, max iteration count, timeouts, and prompt templates
- Integrated-terminal execution model
- Runtime artifacts under `.vscode/dual-agent/`
- Generator stages that modify real workspace files directly
- Reviewer stages that emit structured JSON issues
- Auto-stop on approval, repeated issues, invalid output exhaustion, timeout, or max iterations
- VSIX-packagable project structure

### Out of Scope

- More than two agents in a single workflow
- Git worktree isolation
- Marketplace publishing pipeline
- Arbitrary conditional workflow DSL
- Built-in test agent
- Shared remote memory or terminal-to-terminal communication

## UX Model

### Entry Points

- Command palette commands:
  - `Dual Agent: Start Workflow`
  - `Dual Agent: Run Next Stage`
  - `Dual Agent: Stop Workflow`
  - `Dual Agent: Reset Workflow State`
  - `Dual Agent: Open Runtime Folder`
  - `Dual Agent: Open Review File`
  - `Dual Agent: Open Settings`
- Sidebar view with four sections:
  - `Session`
  - `Agents`
  - `Artifacts`
  - `Actions`

### Runtime Expectations

- `Start Workflow` initializes `.vscode/dual-agent/`, seeds protocol files, and begins execution.
- `Run Next Stage` allows controlled recovery or manual stepping.
- Auto-run remains available so the workflow can proceed until `done` or `failed` without manual intervention.
- The sidebar shows the active stage, workflow status, iteration counter, last run result, and expected output file.

## Architecture

The extension is split into five layers:

1. `bootstrap`
   - Activates the extension
   - Registers commands
   - Registers the tree view
   - Wires refresh events
2. `workflow/orchestrator`
   - Owns state transitions
   - Starts stages
   - Watches for output files
   - Decides when the workflow completes or fails
3. `agents/adapters`
   - Builds stage prompts
   - Builds terminal commands
   - Declares output expectations
   - Validates agent output shape
4. `protocol/runtime-store`
   - Creates `.vscode/dual-agent/`
   - Reads and writes JSON/Markdown protocol files
   - Emits runtime metadata used by UI and orchestrator
5. `ui/sidebar`
   - Exposes session, agent, artifact, and action nodes
   - Refreshes from the runtime store and orchestrator state

This split keeps VS Code-specific concerns out of workflow policy and keeps workflow policy out of CLI-specific command construction.

## Runtime Directory

Default runtime layout:

```text
.vscode/dual-agent/
  task.md
  state.json
  review.json
  agent-a-output.json
  agent-b-output.json
  session.log
  prompts/
    current-agent-a-generate.md
    current-agent-b-review.md
```

All runtime coordination uses these files as the single source of truth.

## Protocol Files

### `state.json`

```json
{
  "workflowId": "20260416-153000",
  "stage": "agent_a_generate",
  "lastActor": "agent_a",
  "iteration": 0,
  "maxIterations": 5,
  "status": "idle",
  "updatedAt": "2026-04-16T15:30:00+08:00",
  "failureReason": null,
  "history": []
}
```

Purpose:

- Defines the current stage and overall lifecycle state
- Tracks iterations and failures
- Stores a lightweight audit trail for the sidebar

### `review.json`

```json
{
  "type": "review",
  "reviewer": "agent_b",
  "target": "agent_a",
  "issues": [
    {
      "id": "src-auth-js-hardcoded-secret",
      "severity": "high",
      "file": "src/auth.js",
      "problem": "Hardcoded secret",
      "fix": "Use env variable"
    }
  ],
  "summary": "Needs fixes"
}
```

Purpose:

- Carries structured reviewer feedback
- Supports repeated-issue detection through stable issue IDs
- Drives the next generate stage

### `agent-a-output.json` and `agent-b-output.json`

```json
{
  "type": "code_generation",
  "author": "agent_a",
  "summary": "Applied requested fixes in auth flow",
  "changedFiles": [
    "src/auth.js",
    "src/config.js"
  ],
  "notes": "Replaced hardcoded secret with env lookup"
}
```

Purpose:

- Acknowledge generation work without embedding full source code
- Summarize changed files for the UI and logs
- Allow reviewer stages to read both the real workspace files and a short change summary

## Stage Model

The product remains a fixed two-agent experience, but the workflow stage list is configurable. The extension supports a stage definition array like:

```json
[
  {
    "id": "agent_a_generate",
    "actor": "agent_a",
    "mode": "generate",
    "writes": ["agent-a-output.json"]
  },
  {
    "id": "agent_b_review",
    "actor": "agent_b",
    "mode": "review",
    "writes": ["review.json"]
  },
  {
    "id": "agent_b_generate",
    "actor": "agent_b",
    "mode": "generate",
    "writes": ["agent-b-output.json"]
  },
  {
    "id": "agent_a_review",
    "actor": "agent_a",
    "mode": "review",
    "writes": ["review.json"]
  }
]
```

The extension controls transition policy rather than exposing arbitrary user-defined conditions:

- Generate stage success advances to the next stage in sequence
- Review stage with `issues.length === 0` ends the workflow with `done`
- Review stage with issues advances to the next stage in sequence
- Repeated issue sets fail the workflow
- `iteration >= maxIterations` fails the workflow

## Agent Adapters

Each agent uses the same adapter contract:

```ts
interface AgentAdapter {
  id: string;
  displayName: string;
  buildStagePrompt(context: StageContext): string;
  buildTerminalCommand(context: StageContext): string;
  expectedOutputFile(context: StageContext): string;
  validateOutput(raw: string, context: StageContext): ValidationResult;
}
```

The first release exposes `Agent A` and `Agent B` in the UI, but both are backed by a generic CLI adapter so the project can later grow beyond Claude and Codex without replacing the workflow core.

## Terminal Execution Model

The extension uses VS Code integrated terminals and file watching rather than direct process pipes.

Execution sequence:

1. Orchestrator resolves the active stage
2. Adapter renders a prompt file in `.vscode/dual-agent/prompts/`
3. Adapter builds the terminal command from settings
4. The extension sends the command to the agent's terminal
5. A file watcher waits for the expected output file to change
6. The extension validates the output
7. The orchestrator updates `state.json`
8. If auto-run is enabled, the next stage begins immediately

This preserves determinism while still supporting CLIs that work best from a terminal session.

## Configuration

Settings are grouped into four areas:

### `dualAgent.workflow.*`

- `stages`
- `maxIterations`
- `timeoutSeconds`
- `autoRun`
- `files.state`
- `files.review`
- `files.agentAOutput`
- `files.agentBOutput`

### `dualAgent.agentA.*`

- `name`
- `command`
- `argsTemplate`
- `generatePrompt`
- `reviewPrompt`

### `dualAgent.agentB.*`

- same fields as `agentA`

### `dualAgent.runtime.*`

- `directory`
- `logLevel`
- `invalidOutputRetries`
- `watchDebounceMs`

## Failure Handling

The orchestrator must detect and surface:

- `invalid_json`
- `empty_output`
- `timeout`
- `conflicting_result`
- `terminal_launch_failed`
- `max_iterations_exceeded`
- `repeated_issues_detected`

For recoverable invalid output cases, the extension waits for another valid write until retry limits are exceeded.

## Testing Strategy

Core workflow logic is tested as pure TypeScript modules first:

- Stage parsing and transition logic
- Output validation
- Repeated-issue detection
- Template rendering
- Runtime path derivation

The extension layer is kept thin so most behavior remains testable without spinning up the full VS Code host. TypeScript compilation validates the activation and contribution wiring.

## Acceptance Criteria

- The package builds as a VS Code extension and can be packaged into a VSIX workflow later
- The sidebar renders session, agent, artifact, and action sections
- The extension initializes `.vscode/dual-agent/` and seed protocol files
- `Start Workflow` triggers the first stage in an integrated terminal
- Valid reviewer output with no issues ends the workflow as `done`
- Repeated review issues or max iteration overflow end the workflow as `failed`
- Runtime state is recoverable through `Run Next Stage`, `Stop Workflow`, and `Reset Workflow State`
