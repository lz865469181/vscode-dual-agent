import type { GenerationOutput, ReviewIssue, ReviewOutput } from "./types";

function assertRecord(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected JSON object");
  }
}

function normalizeIssueId(issue: ReviewIssue): string {
  const file = issue.file.trim();
  const problem = issue.problem.trim().toLowerCase();
  return `${file}|${problem}`;
}

function normalizeIssue(issue: ReviewIssue): ReviewIssue {
  return {
    ...issue,
    id: issue.id?.trim() || normalizeIssueId(issue)
  };
}

export function buildIssueFingerprint(issues: ReviewIssue[]): string {
  return issues
    .map((issue) => issue.id ?? normalizeIssueId(issue))
    .sort()
    .join(",");
}

export function parseReviewOutput(raw: string): ReviewOutput {
  const parsed = JSON.parse(raw) as unknown;
  assertRecord(parsed);

  if (parsed.type !== "review") {
    throw new Error("Expected review output");
  }

  const reviewer = parsed.reviewer;
  const target = parsed.target;
  const summary = parsed.summary;
  const issues = parsed.issues;

  if (reviewer !== "agent_a" && reviewer !== "agent_b") {
    throw new Error("Invalid review reviewer");
  }

  if (target !== "agent_a" && target !== "agent_b") {
    throw new Error("Invalid review target");
  }

  if (typeof summary !== "string") {
    throw new Error("Invalid review summary");
  }

  if (!Array.isArray(issues)) {
    throw new Error("Invalid review issues");
  }

  return {
    type: "review",
    reviewer,
    target,
    summary,
    issues: issues.map((issue) => {
      assertRecord(issue);

      if (
        (issue.severity !== "low" && issue.severity !== "medium" && issue.severity !== "high") ||
        typeof issue.file !== "string" ||
        typeof issue.problem !== "string" ||
        typeof issue.fix !== "string"
      ) {
        throw new Error("Invalid review issue");
      }

      return normalizeIssue({
        id: typeof issue.id === "string" ? issue.id : undefined,
        severity: issue.severity,
        file: issue.file,
        problem: issue.problem,
        fix: issue.fix
      });
    })
  };
}

export function parseGenerationOutput(raw: string): GenerationOutput {
  const parsed = JSON.parse(raw) as unknown;
  assertRecord(parsed);

  if (parsed.type !== "code_generation") {
    throw new Error("Expected code generation output");
  }

  if (parsed.author !== "agent_a" && parsed.author !== "agent_b") {
    throw new Error("Invalid generation author");
  }

  if (!Array.isArray(parsed.changedFiles) || parsed.changedFiles.some((file) => typeof file !== "string")) {
    throw new Error("Invalid changed files");
  }

  if (typeof parsed.summary !== "string") {
    throw new Error("Invalid generation summary");
  }

  if (parsed.notes !== undefined && typeof parsed.notes !== "string") {
    throw new Error("Invalid generation notes");
  }

  return {
    type: "code_generation",
    author: parsed.author,
    changedFiles: parsed.changedFiles,
    summary: parsed.summary,
    notes: parsed.notes
  };
}
