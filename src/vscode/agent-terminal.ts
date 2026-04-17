import * as vscode from "vscode";

export class AgentTerminal implements vscode.Pseudoterminal, vscode.Disposable {
  private readonly writeEmitter = new vscode.EventEmitter<string>();
  private readonly closeEmitter = new vscode.EventEmitter<number | void>();

  readonly onDidWrite = this.writeEmitter.event;
  readonly onDidClose = this.closeEmitter.event;

  open(): void {}

  close(): void {
    this.closeEmitter.fire();
  }

  write(data: string): void {
    this.writeEmitter.fire(data.replace(/\r?\n/g, "\r\n"));
  }

  dispose(): void {
    this.writeEmitter.dispose();
    this.closeEmitter.dispose();
  }
}
