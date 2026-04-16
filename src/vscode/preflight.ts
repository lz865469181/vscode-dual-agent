import { access } from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { extractExecutable } from "../core/command-template";
import type { AgentId } from "../core/types";
import type { ExtensionSettings } from "./config";

const execFileAsync = promisify(execFile);

export interface PreflightIssue {
  agentId: AgentId;
  agentName: string;
  executable: string;
  reason: "missing_executable" | "unresolved_executable";
}

async function isExecutableAvailable(executable: string): Promise<boolean> {
  if (executable.includes("/") || executable.includes("\\")) {
    try {
      await access(path.resolve(executable), constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  const locator = process.platform === "win32" ? "where.exe" : "which";

  try {
    await execFileAsync(locator, [executable], { windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

export async function runAgentPreflight(settings: ExtensionSettings): Promise<PreflightIssue[]> {
  const issues: PreflightIssue[] = [];

  for (const [agentId, agent] of Object.entries(settings.agents) as Array<[AgentId, ExtensionSettings["agents"][AgentId]]>) {
    const executable = extractExecutable(agent.commandTemplate);

    if (!executable) {
      issues.push({
        agentId,
        agentName: agent.name,
        executable: agent.commandTemplate,
        reason: "unresolved_executable"
      });
      continue;
    }

    const available = await isExecutableAvailable(executable);

    if (!available) {
      issues.push({
        agentId,
        agentName: agent.name,
        executable,
        reason: "missing_executable"
      });
    }
  }

  return issues;
}
