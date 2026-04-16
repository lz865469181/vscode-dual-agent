# Dual Agent Workflow

`dual-agent-vscode` is a standalone VS Code extension that runs a deterministic two-agent generate/review workflow through workspace files stored under `.vscode/dual-agent/`.

## Features

- Built-in `Claude ↔ Codex` preset, still editable through settings
- Sidebar sections for session state, agent bindings, runtime artifacts, and actions
- File-driven workflow state machine with integrated-terminal execution
- Startup preflight that checks configured agent CLIs before a workflow begins
- Runtime prompts and outputs stored in `.vscode/dual-agent/`

## Runtime Files

The extension coordinates execution with:

- `task.md`
- `state.json`
- `review.json`
- `agent-a-output.json`
- `agent-b-output.json`
- `session.log`

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
npm run package:vsix
```

## Configuration

The extension now ships with a default preset:

- `Agent A = Claude`
- `Agent B = Codex`
- `dualAgent.agentA.commandTemplate = claude -p --dangerously-skip-permissions {{prompt}}`
- `dualAgent.agentB.commandTemplate = codex exec --full-auto -C "{{workspaceFolder}}" {{prompt}}`

You can still override everything through VS Code settings:

- `dualAgent.agentA.commandTemplate`
- `dualAgent.agentB.commandTemplate`
- `dualAgent.agentA.generatePrompt`
- `dualAgent.agentA.reviewPrompt`
- `dualAgent.agentB.generatePrompt`
- `dualAgent.agentB.reviewPrompt`

Command templates support placeholders such as `{{prompt}}`, `{{promptFile}}`, `{{outputFile}}`, `{{workspaceFolder}}`, `{{runtimeDir}}`, `{{taskFile}}`, and `{{reviewFile}}`.

If you previously used the old PowerShell-only pipeline templates, run `Dual Agent: Repair Legacy Command Templates` once to replace them with the current cross-platform defaults.
