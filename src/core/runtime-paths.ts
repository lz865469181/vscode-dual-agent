import path from "node:path";

import type { RuntimePaths, WorkflowFileConfig } from "./types";

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

export function createRuntimePaths(workspaceRoot: string, files: WorkflowFileConfig): RuntimePaths {
  const runtimeDir = normalizePath(path.join(workspaceRoot, files.runtimeDirectory));

  return {
    runtimeDir,
    promptsDir: normalizePath(path.join(runtimeDir, "prompts")),
    taskFile: normalizePath(path.join(runtimeDir, "task.md")),
    stateFile: normalizePath(path.join(runtimeDir, files.state)),
    reviewFile: normalizePath(path.join(runtimeDir, files.review)),
    agentAOutputFile: normalizePath(path.join(runtimeDir, files.agentAOutput)),
    agentBOutputFile: normalizePath(path.join(runtimeDir, files.agentBOutput)),
    logFile: normalizePath(path.join(runtimeDir, "session.log"))
  };
}
