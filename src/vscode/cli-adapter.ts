import path from "node:path";

import { escapeForShell } from "../core/command-template";
import { parseGenerationOutput, parseReviewOutput } from "../core/protocol";
import { renderTemplate } from "../core/templates";
import type { AgentOutput, RuntimePaths, StageDefinition } from "../core/types";
import type { AgentSettings } from "./config";

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
    return renderTemplate(template, toTemplateRecord(this.createTemplateValues(stage)));
  }

  parseOutput(stage: StageDefinition, raw: string): AgentOutput {
    return stage.mode === "review" ? parseReviewOutput(raw) : parseGenerationOutput(raw);
  }

  private createTemplateValues(stage: StageDefinition, prompt = ""): StageTemplateValues {
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
      prompt: escapeForShell(prompt)
    };
  }

  buildCommandWithPrompt(stage: StageDefinition, prompt: string): string {
    return renderTemplate(this.settings.commandTemplate, toTemplateRecord(this.createTemplateValues(stage, prompt)));
  }
}
