import * as vscode from "vscode";

import { DEFAULT_AGENT_A, DEFAULT_AGENT_B, DEFAULT_STAGES } from "../core/defaults";
import type { AgentId, StageDefinition, WorkflowFileConfig } from "../core/types";
import { classifyCommandTemplate } from "./preflight";

export interface AgentSettings {
  id: AgentId;
  name: string;
  mode: "interactive";
  executable: string;
  args: string[];
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
        name: config.get<string>("agentA.name", DEFAULT_AGENT_A.name),
        mode: "interactive",
        executable: config.get<string>("agentA.executable", DEFAULT_AGENT_A.executable),
        args: config.get<string[]>("agentA.args", [...DEFAULT_AGENT_A.args]),
        commandTemplate: config.get<string>(
          "agentA.commandTemplate",
          DEFAULT_AGENT_A.commandTemplate
        ),
        prompts: {
          generate: config.get<string>("agentA.generatePrompt", DEFAULT_AGENT_A.prompts.generate),
          review: config.get<string>("agentA.reviewPrompt", DEFAULT_AGENT_A.prompts.review)
        }
      },
      agent_b: {
        id: "agent_b",
        name: config.get<string>("agentB.name", DEFAULT_AGENT_B.name),
        mode: "interactive",
        executable: config.get<string>("agentB.executable", DEFAULT_AGENT_B.executable),
        args: config.get<string[]>("agentB.args", [...DEFAULT_AGENT_B.args]),
        commandTemplate: config.get<string>(
          "agentB.commandTemplate",
          DEFAULT_AGENT_B.commandTemplate
        ),
        prompts: {
          generate: config.get<string>("agentB.generatePrompt", DEFAULT_AGENT_B.prompts.generate),
          review: config.get<string>("agentB.reviewPrompt", DEFAULT_AGENT_B.prompts.review)
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

export async function repairLegacyCommandTemplateSettings(): Promise<number> {
  const config = vscode.workspace.getConfiguration("dualAgent");
  let updated = 0;

  const repairs: Array<{
    key: "agentA.commandTemplate" | "agentB.commandTemplate";
    replacement: string;
  }> = [
    { key: "agentA.commandTemplate", replacement: DEFAULT_AGENT_A.commandTemplate },
    { key: "agentB.commandTemplate", replacement: DEFAULT_AGENT_B.commandTemplate }
  ];

  for (const repair of repairs) {
    const inspection = config.inspect<string>(repair.key);

    if (!inspection) {
      continue;
    }

    const scopeValues: Array<{
      value: string | undefined;
      target: vscode.ConfigurationTarget;
    }> = [
      { value: inspection.globalValue, target: vscode.ConfigurationTarget.Global },
      { value: inspection.workspaceValue, target: vscode.ConfigurationTarget.Workspace },
      { value: inspection.workspaceFolderValue, target: vscode.ConfigurationTarget.WorkspaceFolder }
    ];

    for (const scopeValue of scopeValues) {
      if (!scopeValue.value) {
        continue;
      }

      if (classifyCommandTemplate(scopeValue.value).kind !== "legacy_template") {
        continue;
      }

      await config.update(repair.key, repair.replacement, scopeValue.target);
      updated += 1;
    }
  }

  return updated;
}
