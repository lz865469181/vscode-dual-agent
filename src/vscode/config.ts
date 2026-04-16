import * as vscode from "vscode";

import type { AgentId, RuntimePaths, StageDefinition, WorkflowFileConfig } from "../core/types";

export interface AgentSettings {
  id: AgentId;
  name: string;
  commandTemplate: string;
  prompts: {
    generate: string;
    review: string;
  };
}

export interface WorkflowSettings {
  autoRun: boolean;
  maxIterations: number;
  timeoutSeconds: number;
  stages: StageDefinition[];
  files: WorkflowFileConfig;
}

export interface RuntimeSettings {
  directory: string;
  invalidOutputRetries: number;
  watchDebounceMs: number;
  logLevel: "info" | "debug";
}

export interface ExtensionSettings {
  workflow: WorkflowSettings;
  runtime: RuntimeSettings;
  agents: Record<AgentId, AgentSettings>;
}

const DEFAULT_STAGES: StageDefinition[] = [
  { id: "agent_a_generate", actor: "agent_a", mode: "generate" },
  { id: "agent_b_review", actor: "agent_b", mode: "review" },
  { id: "agent_b_generate", actor: "agent_b", mode: "generate" },
  { id: "agent_a_review", actor: "agent_a", mode: "review" }
];

function sanitizeStages(value: unknown): StageDefinition[] {
  if (!Array.isArray(value)) {
    return DEFAULT_STAGES;
  }

  const stages = value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const stage = item as Record<string, unknown>;
      const id = typeof stage.id === "string" ? stage.id : null;
      const actor = stage.actor === "agent_a" || stage.actor === "agent_b" ? stage.actor : null;
      const mode = stage.mode === "generate" || stage.mode === "review" ? stage.mode : null;

      if (!id || !actor || !mode) {
        return null;
      }

      return { id, actor, mode };
    })
    .filter((stage): stage is StageDefinition => stage !== null);

  return stages.length > 0 ? stages : DEFAULT_STAGES;
}

export function getExtensionSettings(): ExtensionSettings {
  const config = vscode.workspace.getConfiguration("dualAgent");
  const runtimeDirectory = config.get<string>("runtime.directory", ".vscode/dual-agent");

  return {
    workflow: {
      autoRun: config.get<boolean>("workflow.autoRun", true),
      maxIterations: config.get<number>("workflow.maxIterations", 5),
      timeoutSeconds: config.get<number>("workflow.timeoutSeconds", 900),
      stages: sanitizeStages(config.get<unknown>("workflow.stages")),
      files: {
        runtimeDirectory,
        state: config.get<string>("workflow.files.state", "state.json"),
        review: config.get<string>("workflow.files.review", "review.json"),
        agentAOutput: config.get<string>("workflow.files.agentAOutput", "agent-a-output.json"),
        agentBOutput: config.get<string>("workflow.files.agentBOutput", "agent-b-output.json")
      }
    },
    runtime: {
      directory: runtimeDirectory,
      invalidOutputRetries: config.get<number>("runtime.invalidOutputRetries", 2),
      watchDebounceMs: config.get<number>("runtime.watchDebounceMs", 200),
      logLevel: config.get<"info" | "debug">("runtime.logLevel", "info")
    },
    agents: {
      agent_a: {
        id: "agent_a",
        name: config.get<string>("agentA.name", "Agent A"),
        commandTemplate: config.get<string>(
          "agentA.commandTemplate",
          "echo Configure dualAgent.agentA.commandTemplate to run your CLI with {{promptFile}} and write {{outputFile}}"
        ),
        prompts: {
          generate: config.get<string>(
            "agentA.generatePrompt",
            "You are Agent A in generator mode. Read {{taskFile}}, {{reviewFile}}, and write a generation receipt to {{outputFile}} after updating workspace files."
          ),
          review: config.get<string>(
            "agentA.reviewPrompt",
            "You are Agent A in reviewer mode. Review the latest generation output and workspace changes, then write structured review JSON to {{outputFile}}."
          )
        }
      },
      agent_b: {
        id: "agent_b",
        name: config.get<string>("agentB.name", "Agent B"),
        commandTemplate: config.get<string>(
          "agentB.commandTemplate",
          "echo Configure dualAgent.agentB.commandTemplate to run your CLI with {{promptFile}} and write {{outputFile}}"
        ),
        prompts: {
          generate: config.get<string>(
            "agentB.generatePrompt",
            "You are Agent B in generator mode. Read {{taskFile}}, {{reviewFile}}, and write a generation receipt to {{outputFile}} after updating workspace files."
          ),
          review: config.get<string>(
            "agentB.reviewPrompt",
            "You are Agent B in reviewer mode. Review the latest generation output and workspace changes, then write structured review JSON to {{outputFile}}."
          )
        }
      }
    }
  };
}

export function getActiveStage(stages: StageDefinition[], stageId: string): StageDefinition {
  const stage = stages.find((item) => item.id === stageId);

  if (!stage) {
    throw new Error(`Unknown active stage: ${stageId}`);
  }

  return stage;
}

export function getWorkspaceRoot(): string {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

  if (!workspaceFolder) {
    throw new Error("Open a workspace folder before using Dual Agent Workflow.");
  }

  return workspaceFolder.uri.fsPath;
}
