# Dual Agent Workflow

`dual-agent-vscode` is a standalone VS Code extension that runs a deterministic two-agent generate/review workflow through workspace files stored under `.vscode/dual-agent/`.

## Features

- Fixed `Agent A` and `Agent B` model with configurable CLI command templates
- Sidebar sections for session state, agent bindings, runtime artifacts, and actions
- File-driven workflow state machine with integrated-terminal execution
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

Configure the two agents through VS Code settings:

- `dualAgent.agentA.commandTemplate`
- `dualAgent.agentB.commandTemplate`
- `dualAgent.agentA.generatePrompt`
- `dualAgent.agentA.reviewPrompt`
- `dualAgent.agentB.generatePrompt`
- `dualAgent.agentB.reviewPrompt`

Command templates support placeholders such as `{{promptFile}}`, `{{outputFile}}`, `{{workspaceFolder}}`, `{{runtimeDir}}`, `{{taskFile}}`, and `{{reviewFile}}`.
