import * as vscode from "vscode";

import type { SidebarSnapshot } from "./orchestrator";
import { DualAgentOrchestrator } from "./orchestrator";

type RootSection = "session" | "agents" | "artifacts" | "actions";

class DualAgentTreeItem extends vscode.TreeItem {
  constructor(
    readonly key: string,
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);
  }
}

export class DualAgentTreeDataProvider implements vscode.TreeDataProvider<DualAgentTreeItem> {
  private readonly emitter = new vscode.EventEmitter<DualAgentTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private latestSnapshot: SidebarSnapshot | null = null;

  constructor(private readonly orchestrator: DualAgentOrchestrator) {
    this.orchestrator.onDidChange(() => {
      void this.refresh();
    });
  }

  async refresh(): Promise<void> {
    this.latestSnapshot = await this.orchestrator.getSnapshot();
    this.emitter.fire();
  }

  getTreeItem(element: DualAgentTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: DualAgentTreeItem): Promise<DualAgentTreeItem[]> {
    if (!this.latestSnapshot) {
      this.latestSnapshot = await this.orchestrator.getSnapshot();
    }

    if (!element) {
      return [
        new DualAgentTreeItem("session", "Session", vscode.TreeItemCollapsibleState.Expanded),
        new DualAgentTreeItem("agents", "Agents", vscode.TreeItemCollapsibleState.Expanded),
        new DualAgentTreeItem("artifacts", "Artifacts", vscode.TreeItemCollapsibleState.Expanded),
        new DualAgentTreeItem("actions", "Actions", vscode.TreeItemCollapsibleState.Expanded)
      ];
    }

    const section = element.key as RootSection;
    const items = this.latestSnapshot[section];

    return items.map((item, index) => {
      const treeItem = new DualAgentTreeItem(
        `${section}:${index}`,
        item.label,
        vscode.TreeItemCollapsibleState.None
      );
      treeItem.description = item.description;
      treeItem.command = item.command;
      treeItem.contextValue = section;
      treeItem.iconPath = this.getIcon(section);
      return treeItem;
    });
  }

  private getIcon(section: RootSection): vscode.ThemeIcon {
    switch (section) {
      case "session":
        return new vscode.ThemeIcon("pulse");
      case "agents":
        return new vscode.ThemeIcon("hubot");
      case "artifacts":
        return new vscode.ThemeIcon("file-code");
      case "actions":
        return new vscode.ThemeIcon("play");
    }
  }
}
