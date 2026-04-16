import { describe, expect, it } from "vitest";

import type { ReviewOutput, StageDefinition, WorkflowState } from "../core/types";
import { advanceWorkflow } from "../core/transitions";

const stages: StageDefinition[] = [
  { id: "agent_a_generate", actor: "agent_a", mode: "generate" },
  { id: "agent_b_review", actor: "agent_b", mode: "review" },
  { id: "agent_b_generate", actor: "agent_b", mode: "generate" },
  { id: "agent_a_review", actor: "agent_a", mode: "review" }
];

function createState(stage: string): WorkflowState {
  return {
    workflowId: "wf-1",
    stage,
    lastActor: null,
    iteration: 0,
    maxIterations: 5,
    status: "waiting_output",
    updatedAt: "2026-04-16T17:00:00.000Z",
    failureReason: null,
    history: [],
    lastIssueFingerprint: null
  };
}

describe("advanceWorkflow", () => {
  it("marks the workflow done when a review stage has no issues", () => {
    const current = createState("agent_b_review");
    const output: ReviewOutput = {
      type: "review",
      reviewer: "agent_b",
      target: "agent_a",
      issues: [],
      summary: "Approved"
    };

    const next = advanceWorkflow(current, stages, output, "2026-04-16T17:05:00.000Z");

    expect(next.status).toBe("done");
    expect(next.stage).toBe("agent_b_review");
  });

  it("moves to the next stage when a generation stage completes", () => {
    const current = createState("agent_a_generate");
    const next = advanceWorkflow(
      current,
      stages,
      {
        type: "code_generation",
        author: "agent_a",
        changedFiles: ["src/auth.js"],
        summary: "Applied changes"
      },
      "2026-04-16T17:05:00.000Z"
    );

    expect(next.status).toBe("idle");
    expect(next.stage).toBe("agent_b_review");
    expect(next.lastActor).toBe("agent_a");
  });

  it("fails when the same review issues repeat", () => {
    const current = {
      ...createState("agent_b_review"),
      lastIssueFingerprint: "src/auth.js|hardcoded secret"
    };

    const next = advanceWorkflow(
      current,
      stages,
      {
        type: "review",
        reviewer: "agent_b",
        target: "agent_a",
        issues: [
          {
            id: "src/auth.js|hardcoded secret",
            severity: "high",
            file: "src/auth.js",
            problem: "Hardcoded secret",
            fix: "Use env variable"
          }
        ],
        summary: "Needs fixes"
      },
      "2026-04-16T17:05:00.000Z"
    );

    expect(next.status).toBe("failed");
    expect(next.failureReason).toBe("repeated_issues_detected");
  });
});
