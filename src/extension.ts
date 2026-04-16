import * as vscode from "vscode";

import { DualAgentOrchestrator } from "./vscode/orchestrator";
import { DualAgentTreeDataProvider } from "./vscode/tree-data";

export function activate(context: vscode.ExtensionContext): void {
  const orchestrator = new DualAgentOrchestrator();
  const treeProvider = new DualAgentTreeDataProvider(orchestrator);

  context.subscriptions.push(
    orchestrator,
    vscode.window.registerTreeDataProvider("dualAgent.sidebar", treeProvider),
    vscode.commands.registerCommand("dualAgent.startWorkflow", () => orchestrator.startWorkflow()),
    vscode.commands.registerCommand("dualAgent.runNextStage", () => orchestrator.runNextStage()),
    vscode.commands.registerCommand("dualAgent.stopWorkflow", () => orchestrator.stopWorkflow()),
    vscode.commands.registerCommand("dualAgent.resetWorkflowState", () => orchestrator.resetWorkflowState()),
    vscode.commands.registerCommand("dualAgent.openRuntimeFolder", () => orchestrator.openRuntimeFolder()),
    vscode.commands.registerCommand("dualAgent.openReviewFile", () => orchestrator.openReviewFile()),
    vscode.commands.registerCommand("dualAgent.openSettings", () => orchestrator.openSettings()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("dualAgent")) {
        void treeProvider.refresh();
      }
    })
  );

  void treeProvider.refresh();
}

export function deactivate(): void {}
