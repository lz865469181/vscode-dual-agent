## Observations

- The extension package already ships with new defaults that no longer use `Get-Content`.
- The reported preflight error still says `Claude: executable not found (Get-Content)`.
- This means the active VS Code setting value is overriding the shipped default with an older PowerShell-only pipeline template.

## Hypotheses

### ROOT HYPOTHESIS: Persisted legacy setting overrides the new default

- Supports:
  - The error names `Get-Content`, which only appears in earlier command templates.
  - Current manifest defaults no longer contain `Get-Content`.
- Conflicts:
  - None meaningful.
- Test:
  - Add a legacy-template detector and prove it classifies `Get-Content -Raw "{{promptFile}}" | claude` as a migration case.

### Hypothesis 2: The new VSIX was not installed

- Supports:
  - A stale extension binary could keep the old templates.
- Conflicts:
  - Even with a new VSIX, explicit user settings would still override defaults.
- Test:
  - Compare manifest defaults in tests and package output.

### Hypothesis 3: Preflight extracts the wrong token from valid templates

- Supports:
  - Preflight relies on executable extraction heuristics.
- Conflicts:
  - The extracted token exactly matches the old pipeline command head.
- Test:
  - Add classification logic and unit tests around legacy templates versus current defaults.

## Experiments

- Added a test that expects PowerShell pipeline templates to be classified as legacy settings that need migration.
- If that test fails before implementation and passes after implementation, the root hypothesis is confirmed.

## Observations (2026-04-17 Codex trust prompt)

- `Dual Agent: Start Workflow` no longer fails on VSIX path or runtime folder creation.
- On Windows, `node-pty` fails to launch bare command names like `claude` and `codex`; resolving them to concrete `.exe` / `.cmd` paths fixes startup.
- After that fix, Claude starts successfully in a PTY.
- Codex still stops on an interactive trust prompt: `Do you trust the contents of this directory?` with `Press enter to continue`.
- Running Codex with `--dangerously-bypass-approvals-and-sandbox` still shows the same trust prompt.

## Hypotheses (2026-04-17 Codex trust prompt)

### ROOT HYPOTHESIS: Codex interactive startup requires a one-time trust confirmation that is separate from sandbox/approval flags

- Supports:
  - The trust prompt appears even when `--dangerously-bypass-approvals-and-sandbox` is passed.
  - The wording is about prompt injection and directory trust, not shell command approval.
- Conflicts:
  - There may still be an undocumented config key or launch flag in the installed Codex package.
- Test:
  - Search the installed Codex package for trust-prompt strings or config keys. If no skip option is present, auto-confirm the prompt in PTY when the known text appears.

### Hypothesis 2: Codex has a hidden trust-setting/config switch we can set at launch

- Supports:
  - Many CLIs persist trust prompts in config or local state.
- Conflicts:
  - `codex --help` and `codex exec --help` do not expose such a flag.
- Test:
  - Search the installed package text for `trust`, `prompt injection`, or the literal prompt message.

### Hypothesis 3: The prompt only occurs because Codex is being started in the extension workspace instead of the actual target workspace

- Supports:
  - Trust may be per-directory.
- Conflicts:
  - The extension intentionally starts Codex in the user workspace; changing cwd would not remove the need to trust the actual working tree.
- Test:
  - Verify the prompt wording references the expected workspace path and not an incorrect cwd.

## Experiments (2026-04-17 Codex trust prompt)

- Verified locally that `pty.spawn('claude', ...)` fails on Windows but `pty.spawn('<absolute-path>/claude.exe', ...)` works.
- Verified locally that `pty.spawn('<absolute-path>/codex.cmd', ['--dangerously-bypass-approvals-and-sandbox'], ...)` still shows the trust prompt.
- Searched the installed CLI help; no documented trust-bypass flag was exposed.
- Added a failing unit test for the ANSI-heavy trust prompt form and confirmed the existing raw matcher never triggered.
- Implemented terminal-text normalization for startup auto-response matching:
  - convert cursor-forward control sequences like `CSI 1 C` into spaces
  - convert cursor-position sequences like `CSI row;col H` into line breaks for searchability
  - strip OSC/CSI styling and other non-printable control bytes before matching
- Re-ran `npm test -- src/test/agent-session.test.ts` and confirmed the ANSI trust-prompt case now sends Enter exactly once.

## Conclusion (2026-04-17 Codex trust prompt)

- Root cause confirmed: the auto-response matcher was reading raw PTY bytes, but Codex renders the trust prompt with cursor-movement escape sequences instead of plain spaces.
- Stripping escape codes alone is insufficient because it collapses `Do you trust...` into `Doyoutrust...`.
- Matching against normalized terminal text fixes the problem without altering the actual terminal output shown to the user.
