import path from "node:path";

import { escapeForShell, type SupportedPlatform } from "../core/command-template";
import { parseGenerationOutput, parseReviewOutput } from "../core/protocol";
import { renderTemplate } from "../core/templates";
import type { AgentOutput, RuntimePaths, StageDefinition } from "../core/types";
import type { AgentSettings } from "./config";

export interface AgentLaunchConfig {
  executable: string;
  args: string[];
  env?: Record<string, string>;
}

export interface StageExecutionEnvelope {
  workflowId: string;
  stageId: string;
  sentinel: string;
}

export interface StageTemplateValues {
  workspaceFolder: string;
  runtimeDir: string;
  taskFile: string;
  stateFile: string;
  reviewFile: string;
  outputFile: string;
  promptFile: string;
  prompt: string;
}

function toTemplateRecord(values: StageTemplateValues): Record<string, string> {
  return {
    workspaceFolder: values.workspaceFolder,
    runtimeDir: values.runtimeDir,
    taskFile: values.taskFile,
    stateFile: values.stateFile,
    reviewFile: values.reviewFile,
    outputFile: values.outputFile,
    promptFile: values.promptFile,
    prompt: values.prompt
  };
}

export class CliAgentAdapter {
  constructor(
    private readonly settings: AgentSettings,
    private readonly workspaceRoot: string,
    private readonly paths: RuntimePaths
  ) {}

  getTerminalName(): string {
    return `Dual Agent: ${this.settings.name}`;
  }

  getPromptFile(stage: StageDefinition): string {
    return path.join(this.paths.promptsDir, `current-${stage.id}.md`).replace(/\\/g, "/");
  }

  getExpectedOutputFile(stage: StageDefinition): string {
    if (stage.mode === "review") {
      return this.paths.reviewFile;
    }

    return stage.actor === "agent_a" ? this.paths.agentAOutputFile : this.paths.agentBOutputFile;
  }

  buildPrompt(stage: StageDefinition): string {
    const template = stage.mode === "generate" ? this.settings.prompts.generate : this.settings.prompts.review;
    return renderTemplate(template, toTemplateRecord(this.createPromptTemplateValues(stage)));
  }

  parseOutput(stage: StageDefinition, raw: string): AgentOutput {
    return stage.mode === "review" ? parseReviewOutput(raw) : parseGenerationOutput(raw);
  }

  getLaunchConfig(): AgentLaunchConfig {
    return {
      executable: this.settings.executable,
      args: [...this.settings.args]
    };
  }

  buildInteractivePrompt(stage: StageDefinition, envelope: StageExecutionEnvelope): string {
    return [
      `Workflow: ${envelope.workflowId}`,
      `Stage: ${envelope.stageId}`,
      "",
      "After writing the required JSON artifact, print this sentinel line exactly once on its own line:",
      envelope.sentinel,
      "",
      this.buildPrompt(stage)
    ].join("\n");
  }

  private createCommandTemplateValues(
    stage: StageDefinition,
    prompt = "",
    platform: SupportedPlatform = process.platform
  ): StageTemplateValues {
    const promptFile = this.getPromptFile(stage);
    const outputFile = this.getExpectedOutputFile(stage);

    return {
      workspaceFolder: this.workspaceRoot.replace(/\\/g, "/"),
      runtimeDir: this.paths.runtimeDir,
      taskFile: this.paths.taskFile,
      stateFile: this.paths.stateFile,
      reviewFile: this.paths.reviewFile,
      outputFile,
      promptFile,
      prompt: escapeForShell(prompt, platform)
    };
  }

  private createPromptTemplateValues(stage: StageDefinition): StageTemplateValues {
    const promptFile = this.getPromptFile(stage);
    const outputFile = this.getExpectedOutputFile(stage);

    return {
      workspaceFolder: "the current workspace folder",
      runtimeDir: this.toWorkspaceRelative(this.paths.runtimeDir),
      taskFile: this.toWorkspaceRelative(this.paths.taskFile),
      stateFile: this.toWorkspaceRelative(this.paths.stateFile),
      reviewFile: this.toWorkspaceRelative(this.paths.reviewFile),
      outputFile: this.toWorkspaceRelative(outputFile),
      promptFile: this.toWorkspaceRelative(promptFile),
      prompt: ""
    };
  }

  private toWorkspaceRelative(filePath: string): string {
    const relative = path.posix.relative(this.workspaceRoot.replace(/\\/g, "/"), filePath);
    return relative.length > 0 ? relative : ".";
  }

  buildCommandWithPrompt(stage: StageDefinition, prompt: string, platform: SupportedPlatform = process.platform): string {
    if (this.settings.commandTemplate === "builtin:claude") {
      return this.buildBuiltinClaudeCommand(stage, platform);
    }

    if (this.settings.commandTemplate === "builtin:codex") {
      return this.buildBuiltinCodexCommand(stage, platform);
    }

    return renderTemplate(
      this.settings.commandTemplate,
      toTemplateRecord(this.createCommandTemplateValues(stage, prompt, platform))
    );
  }

  private buildBuiltinClaudeCommand(stage: StageDefinition, platform: SupportedPlatform): string {
    const promptFile = this.toWorkspaceRelative(this.getPromptFile(stage));

    if (platform === "win32") {
      return [
        `$dualAgentPrompt = Get-Content -Raw '${promptFile}'`,
        "claude -p --dangerously-skip-permissions $dualAgentPrompt"
      ].join("\n");
    }

    return [
      `DUAL_AGENT_PROMPT="$(cat '${promptFile}')"`,
      'claude -p --dangerously-skip-permissions "$DUAL_AGENT_PROMPT"'
    ].join("\n");
  }

  private buildBuiltinCodexCommand(stage: StageDefinition, platform: SupportedPlatform): string {
    const promptFile = this.toWorkspaceRelative(this.getPromptFile(stage));
    const workspaceFolder = this.workspaceRoot.replace(/\\/g, "/");

    if (platform === "win32") {
      return [
        `$dualAgentPrompt = Get-Content -Raw '${promptFile}'`,
        `codex exec --full-auto -C '${workspaceFolder}' $dualAgentPrompt`
      ].join("\n");
    }

    return [
      `DUAL_AGENT_PROMPT="$(cat '${promptFile}')"`,
      `codex exec --full-auto -C '${workspaceFolder}' "$DUAL_AGENT_PROMPT"`
    ].join("\n");
  }
}
