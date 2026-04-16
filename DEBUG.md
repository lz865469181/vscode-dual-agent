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
