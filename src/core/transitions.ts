import { buildIssueFingerprint } from "./protocol";
import type { AgentOutput, StageDefinition, WorkflowState } from "./types";

function createHistoryEntry(state: WorkflowState, actor: StageDefinition["actor"], timestamp: string, note?: string) {
  return {
    stage: state.stage,
    actor,
    result: "completed" as const,
    timestamp,
    note
  };
}

function getStage(stages: StageDefinition[], stageId: string): StageDefinition {
  const stage = stages.find((candidate) => candidate.id === stageId);

  if (!stage) {
    throw new Error(`Unknown stage: ${stageId}`);
  }

  return stage;
}

export function advanceWorkflow(
  state: WorkflowState,
  stages: StageDefinition[],
  output: AgentOutput,
  timestamp: string
): WorkflowState {
  const stage = getStage(stages, state.stage);
  const stageIndex = stages.findIndex((candidate) => candidate.id === stage.id);
  const nextStage = stageIndex >= 0 ? stages[stageIndex + 1] : undefined;
  const baseState: WorkflowState = {
    ...state,
    lastActor: stage.actor,
    updatedAt: timestamp,
    history: [...state.history, createHistoryEntry(state, stage.actor, timestamp)]
  };

  if (stage.mode === "generate") {
    if (output.type !== "code_generation" || output.author !== stage.actor) {
      return {
        ...baseState,
        status: "failed",
        failureReason: "conflicting_result"
      };
    }

    return nextStage
      ? {
          ...baseState,
          stage: nextStage.id,
          status: "idle",
          failureReason: null
        }
      : {
          ...baseState,
          status: "done",
          failureReason: null
        };
  }

  if (output.type !== "review" || output.reviewer !== stage.actor) {
    return {
      ...baseState,
      status: "failed",
      failureReason: "conflicting_result"
    };
  }

  if (output.issues.length === 0) {
    return {
      ...baseState,
      status: "done",
      failureReason: null,
      lastIssueFingerprint: null
    };
  }

  const fingerprint = buildIssueFingerprint(output.issues);

  if (fingerprint === state.lastIssueFingerprint) {
    return {
      ...baseState,
      status: "failed",
      failureReason: "repeated_issues_detected",
      lastIssueFingerprint: fingerprint
    };
  }

  const nextIteration = state.iteration + 1;

  if (nextIteration >= state.maxIterations) {
    return {
      ...baseState,
      status: "failed",
      failureReason: "max_iterations_exceeded",
      iteration: nextIteration,
      lastIssueFingerprint: fingerprint
    };
  }

  return nextStage
    ? {
        ...baseState,
        stage: nextStage.id,
        status: "idle",
        failureReason: null,
        iteration: nextIteration,
        lastIssueFingerprint: fingerprint
      }
    : {
        ...baseState,
        status: "done",
        failureReason: null,
        iteration: nextIteration,
        lastIssueFingerprint: fingerprint
      };
}
