# Dual Agent Workflow

`dual-agent-vscode` is a standalone VS Code extension that runs a deterministic two-agent generate/review workflow through runtime files in `.vscode/dual-agent/`.

## What Changed In Interactive Mode

The extension now starts persistent interactive agent sessions instead of launching one-shot shell commands per stage.

- Agent A and Agent B run as managed long-lived PTY-backed CLI processes
- prompts are still written to `.vscode/dual-agent/prompts/`
- the extension injects each stage prompt into the live agent session
- terminal keyboard input and panel resize events are forwarded back into the live PTY session
- a stage completes only when both conditions are true:
  - the active agent prints the expected sentinel line
  - the expected JSON artifact is written and parses successfully

This keeps the workflow deterministic while giving Claude and Codex a real terminal environment instead of a plain pipe.

## Features

- Built-in `Claude -> Codex` interactive preset
- Real PTY-backed terminal sessions so terminal UIs can render instead of failing on raw-mode checks
- Sidebar sections for workflow state, session status, runtime artifacts, and actions
- File-driven workflow state machine under `.vscode/dual-agent/`
- Executable preflight checks before workflow start
- Workspace-relative prompts and runtime paths

## Runtime Files

The extension coordinates execution with:

- `task.md`
- `state.json`
- `review.json`
- `agent-a-output.json`
- `agent-b-output.json`
- `prompts/current-<stage>.md`
- `session.log`

## How To Start

1. Open a project folder in VS Code.
2. Open the command palette.
3. Run `Dual Agent: Start Workflow`.
4. Edit `.vscode/dual-agent/task.md` with the task you want the agents to execute.

You can also use the Explorer sidebar entry `Dual Agent Workflow` and click `Start Workflow`.

## Configuration

The built-in interactive defaults are:

- `dualAgent.agentA.name = Claude`
- `dualAgent.agentA.mode = interactive`
- `dualAgent.agentA.executable = claude`
- `dualAgent.agentA.args = []`
- `dualAgent.agentB.name = Codex`
- `dualAgent.agentB.mode = interactive`
- `dualAgent.agentB.executable = codex`
- `dualAgent.agentB.args = []`

The most important settings are:

- `dualAgent.agentA.executable`
- `dualAgent.agentA.args`
- `dualAgent.agentB.executable`
- `dualAgent.agentB.args`
- `dualAgent.agentA.generatePrompt`
- `dualAgent.agentA.reviewPrompt`
- `dualAgent.agentB.generatePrompt`
- `dualAgent.agentB.reviewPrompt`
- `dualAgent.workflow.maxIterations`
- `dualAgent.workflow.timeoutSeconds`

Legacy `commandTemplate` settings are still present only for migration compatibility. Interactive mode no longer depends on PowerShell pipelines such as `Get-Content ... | claude`.

## Preflight

Before a workflow starts, the extension checks that the configured executables exist. If `claude` or `codex` are not on `PATH`, update the corresponding `dualAgent.agentA.executable` or `dualAgent.agentB.executable` setting.

On Windows, the extension also resolves bare command names such as `claude` or `codex` to concrete launch targets like `.exe` or `.cmd` before starting the PTY session. This avoids `File not found` failures from `node-pty` when the command exists on `PATH` but cannot be launched by name inside a PTY.

For Codex interactive sessions, the extension also auto-confirms the initial workspace trust prompt once when Codex renders `Do you trust the contents of this directory?` with `Press enter to continue`, including the ANSI/cursor-control rendering form used in PTY terminals.

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
npm run package:vsix
```
