export type AgentId = "agent_a" | "agent_b";
export type StageMode = "generate" | "review";
export type WorkflowStatus =
  | "idle"
  | "running"
  | "waiting_output"
  | "failed"
  | "done"
  | "stopped";
export type FailureReason =
  | "invalid_json"
  | "empty_output"
  | "timeout"
  | "conflicting_result"
  | "terminal_launch_failed"
  | "max_iterations_exceeded"
  | "repeated_issues_detected";

export interface StageDefinition {
  id: string;
  actor: AgentId;
  mode: StageMode;
  reads?: string[];
  writes?: string[];
}

export interface WorkflowHistoryEntry {
  stage: string;
  actor: AgentId | null;
  result: WorkflowStatus | "completed";
  timestamp: string;
  note?: string;
}

export interface WorkflowState {
  workflowId: string;
  stage: string;
  lastActor: AgentId | null;
  iteration: number;
  maxIterations: number;
  status: WorkflowStatus;
  updatedAt: string;
  failureReason: FailureReason | null;
  history: WorkflowHistoryEntry[];
  lastIssueFingerprint: string | null;
}

export interface ReviewIssue {
  id?: string;
  severity: "low" | "medium" | "high";
  file: string;
  problem: string;
  fix: string;
}

export interface ReviewOutput {
  type: "review";
  reviewer: AgentId;
  target: AgentId;
  issues: ReviewIssue[];
  summary: string;
}

export interface GenerationOutput {
  type: "code_generation";
  author: AgentId;
  changedFiles: string[];
  summary: string;
  notes?: string;
}

export type AgentOutput = ReviewOutput | GenerationOutput;

export interface WorkflowFileConfig {
  runtimeDirectory: string;
  state: string;
  review: string;
  agentAOutput: string;
  agentBOutput: string;
}

export interface RuntimePaths {
  runtimeDir: string;
  promptsDir: string;
  taskFile: string;
  stateFile: string;
  reviewFile: string;
  agentAOutputFile: string;
  agentBOutputFile: string;
  logFile: string;
}
