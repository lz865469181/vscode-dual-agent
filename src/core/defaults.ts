import type { StageDefinition } from "./types";

export const DEFAULT_STAGES: StageDefinition[] = [
  { id: "agent_a_generate", actor: "agent_a", mode: "generate" },
  { id: "agent_b_review", actor: "agent_b", mode: "review" },
  { id: "agent_b_generate", actor: "agent_b", mode: "generate" },
  { id: "agent_a_review", actor: "agent_a", mode: "review" }
];

const CLAUDE_GENERATE_PROMPT = [
  "You are Claude in generator mode.",
  "",
  "- Read {{taskFile}} and {{stateFile}}.",
  "- If {{reviewFile}} contains issues, apply all requested fixes directly in the workspace.",
  "- Do not review. Modify the real project files in {{workspaceFolder}}.",
  "- When finished, write JSON to {{outputFile}} using this shape:",
  '{ "type": "code_generation", "author": "agent_a", "changedFiles": ["relative/path"], "summary": "...", "notes": "optional" }'
].join("\n");

const CLAUDE_REVIEW_PROMPT = [
  "You are Claude in reviewer mode.",
  "",
  "- Read the latest workspace changes and the other agent output artifacts.",
  "- Review Codex output strictly.",
  "- Do not generate code.",
  "- Write review JSON to {{outputFile}} using this shape:",
  '{ "type": "review", "reviewer": "agent_a", "target": "agent_b", "issues": [{ "severity": "high", "file": "path", "problem": "...", "fix": "..." }], "summary": "Approved or Needs fixes" }'
].join("\n");

const CODEX_GENERATE_PROMPT = [
  "You are Codex in generator mode.",
  "",
  "- Read {{taskFile}}, {{reviewFile}}, and {{stateFile}}.",
  "- Apply all fixes directly in the workspace at {{workspaceFolder}}.",
  "- Do not review.",
  "- When finished, write JSON to {{outputFile}} using this shape:",
  '{ "type": "code_generation", "author": "agent_b", "changedFiles": ["relative/path"], "summary": "...", "notes": "optional" }'
].join("\n");

const CODEX_REVIEW_PROMPT = [
  "You are Codex in reviewer mode.",
  "",
  "- Read the latest workspace changes and Claude output artifacts.",
  "- Output structured review issues only.",
  "- Do not generate code.",
  "- Write review JSON to {{outputFile}} using this shape:",
  '{ "type": "review", "reviewer": "agent_b", "target": "agent_a", "issues": [{ "severity": "high", "file": "path", "problem": "...", "fix": "..." }], "summary": "Approved or Needs fixes" }'
].join("\n");

export const DEFAULT_AGENT_A = {
  name: "Claude",
  commandTemplate: 'Get-Content -Raw "{{promptFile}}" | claude -p --dangerously-skip-permissions',
  prompts: {
    generate: CLAUDE_GENERATE_PROMPT,
    review: CLAUDE_REVIEW_PROMPT
  }
} as const;

export const DEFAULT_AGENT_B = {
  name: "Codex",
  commandTemplate: 'Get-Content -Raw "{{promptFile}}" | codex exec --full-auto -C "{{workspaceFolder}}" -',
  prompts: {
    generate: CODEX_GENERATE_PROMPT,
    review: CODEX_REVIEW_PROMPT
  }
} as const;
