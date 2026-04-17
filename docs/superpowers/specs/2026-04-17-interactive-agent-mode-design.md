# Interactive Agent Mode Design

## Context

The current extension runs each workflow stage as a one-shot shell command in a VS Code integrated terminal. That model works for non-interactive CLI usage, but it does not satisfy the new requirement:

- launch Claude and Codex as persistent interactive sessions
- send stage prompts into those live sessions
- keep the deterministic file-based workflow contract
- continue supporting future CLI integrations

The interactive mode must preserve the existing workflow principles:

- real project files are edited in the current workspace
- `.vscode/dual-agent/` remains the runtime source of truth
- workflow state advances through a deterministic state machine
- structured JSON artifacts remain mandatory

## Goals

- Replace one-shot stage execution with persistent per-agent interactive sessions.
- Keep `task.md`, `state.json`, `review.json`, and generation output files as workflow artifacts.
- Add a reliable stage completion signal for interactive sessions.
- Support Windows, Linux, and macOS without shell-specific prompt piping.
- Preserve a path for future CLI integrations beyond Claude and Codex.

## Non-Goals

- Supporting free-form human chat inside the managed agent sessions.
- Replacing the file protocol with an in-memory transport.
- Adding dynamic N-agent orchestration in this iteration.
- Requiring worktrees or temporary clone directories.

## Recommended Approach

Use extension-managed persistent child processes for each agent, and surface each process in VS Code through a pseudoterminal-backed terminal view.

This is preferred over raw `createTerminal().sendText(...)` for three reasons:

1. The extension needs direct access to process stdin/stdout to send prompts deterministically and detect completion markers.
2. Standard integrated terminals are suitable for display and manual use, but they are not a reliable control plane for parsing agent output.
3. Managing child processes directly makes future CLI adapters explicit and cross-platform without shell quoting hacks.

## Architecture

### Execution Layers

The extension should separate workflow concerns into three layers:

1. `Orchestrator`
   - owns workflow state transitions
   - prepares prompts and runtime artifacts
   - starts stage monitoring
   - advances or fails the workflow

2. `AgentSession`
   - owns one persistent child process per agent
   - starts the CLI executable
   - writes prompt input into stdin
   - reads stdout/stderr
   - detects sentinel markers
   - reports session lifecycle and stage completion events

3. `AgentAdapter`
   - renders prompts for a stage
   - parses structured JSON outputs
   - defines CLI launch configuration
   - defines how prompt input is injected into that CLI
   - defines sentinel formatting rules

### Proposed Module Changes

- Keep [src/vscode/orchestrator.ts](/D:/github_code/dual-agent-vscode/src/vscode/orchestrator.ts) as the workflow coordinator.
- Refactor [src/vscode/cli-adapter.ts](/D:/github_code/dual-agent-vscode/src/vscode/cli-adapter.ts) so it no longer owns shell command assembly.
- Add `src/vscode/agent-session.ts` for lifecycle and process I/O management.
- Add `src/vscode/agent-terminal.ts` for pseudoterminal display wiring.
- Extend [src/vscode/config.ts](/D:/github_code/dual-agent-vscode/src/vscode/config.ts) to describe interactive launch settings rather than one-shot command templates.

## Session Lifecycle

Each agent has one managed session:

- `not_started`
- `starting`
- `ready`
- `busy`
- `stopped`
- `failed`

Workflow start behavior:

1. Validate workspace and configuration.
2. Run preflight to confirm required executables exist.
3. Initialize runtime files under `.vscode/dual-agent/`.
4. Start both agent sessions.
5. Wait until the active stage agent is ready.
6. Send the first stage prompt.

Workflow stop behavior:

- Stop stage monitoring.
- Mark workflow state as `stopped`.
- Terminate both managed agent processes by default.

Terminating sessions by default avoids zombie interactive CLIs and keeps restart behavior deterministic.

## Stage Completion Contract

Interactive mode uses dual completion signals:

1. terminal sentinel output
2. valid structured JSON artifact on disk

The extension only advances when both conditions are satisfied for the active stage.

### Sentinel Format

Each stage gets a unique sentinel token derived from:

- workflow id
- stage id
- per-run nonce

Recommended terminal output format:

```text
[DUAL_AGENT] workflow=<workflowId> stage=<stageId> token=<nonce> status=done
```

Prompt templates must instruct the agent to:

1. perform the requested code or review work
2. write the required JSON artifact
3. print the sentinel line exactly once on its own line, after the artifact is written

### Why Dual Signals

Sentinel alone is insufficient because an agent can claim completion without writing valid JSON.

Artifact alone is insufficient because an interactive session may continue emitting output after the file is written, and the orchestrator needs a stable notion of stage completion.

Requiring both gives the orchestrator a deterministic boundary for interactive stages.

## Prompt Delivery

The extension writes the stage prompt to:

- `.vscode/dual-agent/prompts/current-<stage>.md`

The same prompt is also injected into the live agent session.

The injected prompt should be framed by extension-generated guard text:

- identify the active workflow and stage
- include the exact sentinel the agent must echo
- remind the agent that workspace-relative runtime paths are authoritative

The prompt file remains on disk for transparency and debugging, but the interactive session no longer starts by executing `claude -p ...` or `codex exec ...`.

## Runtime File Model

The runtime directory remains workspace-relative:

- `.vscode/dual-agent/task.md`
- `.vscode/dual-agent/state.json`
- `.vscode/dual-agent/review.json`
- `.vscode/dual-agent/agent-a-output.json`
- `.vscode/dual-agent/agent-b-output.json`
- `.vscode/dual-agent/prompts/current-<stage>.md`
- `.vscode/dual-agent/session.log`

Prompt content must continue using workspace-relative paths such as `.vscode/dual-agent/task.md`, never absolute machine-local paths.

## Configuration Changes

The old `commandTemplate` model is no longer the primary execution abstraction for built-in interactive agents.

Each agent should instead expose launch settings shaped around a managed process:

- executable
- args
- environment overrides
- prompt input mode
- sentinel mode

### Suggested Settings Shape

```json
{
  "dualAgent.agentA.mode": "interactive",
  "dualAgent.agentA.executable": "claude",
  "dualAgent.agentA.args": [],
  "dualAgent.agentB.mode": "interactive",
  "dualAgent.agentB.executable": "codex",
  "dualAgent.agentB.args": []
}
```

Built-in presets should map to:

- Agent A: Claude interactive preset
- Agent B: Codex interactive preset

Custom CLI support should still be possible by overriding executable and args, but the built-in default path should not expose shell wrapper commands.

## Preflight

Preflight must change from command-template inspection to executable validation.

Checks:

- executable exists on `PATH` or as an explicit path
- configured args are structurally valid
- runtime directory can be created

Legacy command-template repair may remain for migration, but interactive mode should not depend on `Get-Content`, `cat`, or shell pipes.

## Failure Handling

### Session Startup Failure

- mark workflow `failed`
- write a session log entry with process start error
- surface a VS Code error message

### Sentinel Missing

- if JSON file exists but sentinel does not arrive before timeout, fail the stage as `timeout`
- log that the artifact existed but completion marker was missing

### Invalid JSON

- if sentinel arrives but JSON is invalid, keep retry behavior bounded by `invalidOutputRetries`
- after retries are exhausted, fail the workflow

### Unexpected Session Exit

- if the active agent process exits while a stage is running, fail the workflow
- if an idle session exits, mark the session as `stopped` and require restart before the next stage

## Sidebar And Commands

The Explorer sidebar should add session visibility:

- Agent A session state
- Agent B session state
- active stage sentinel
- expected artifact path

The existing commands remain:

- Start Workflow
- Run Next Stage
- Stop Workflow
- Reset Workflow State
- Open Runtime Folder
- Open Settings

No new user-facing command is required for the first interactive version.

## Testing Strategy

Tests should cover:

1. prompt rendering includes sentinel instructions and workspace-relative paths
2. session adapter builds correct launch parameters for Claude and Codex presets
3. orchestrator does not advance on sentinel-only or file-only completion
4. orchestrator advances on matching sentinel plus valid JSON
5. session failure propagates to workflow failure
6. preflight validates executables without legacy shell-pipe assumptions

Use mocked process streams for unit tests rather than real Claude or Codex invocations.

## Migration Plan

1. Introduce interactive session infrastructure alongside existing runtime-store logic.
2. Replace built-in `builtin:claude` and `builtin:codex` execution paths with interactive managed presets.
3. Keep legacy repair tooling only to migrate older settings away from shell-piped templates.
4. Update README and package settings descriptions to explain interactive startup and completion semantics.

## Open Decisions Resolved

- Stage completion uses sentinel plus JSON artifact.
- Real project files are edited directly in the same workspace.
- Runtime artifacts stay under `.vscode/dual-agent/`.
- Interactive mode is the primary built-in behavior for both Claude and Codex.
- The system remains fixed dual-agent for now, while preserving adapter-based future CLI expansion.

## Implementation Readiness

This design is ready for implementation as a focused refactor of the execution layer. The workflow state machine, runtime artifacts, and deterministic file protocol remain intact; only the agent execution mechanism changes from one-shot shell commands to managed interactive sessions.
