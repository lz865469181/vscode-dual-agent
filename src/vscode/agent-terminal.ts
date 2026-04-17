import * as vscode from "vscode";

export class AgentTerminal implements vscode.Pseudoterminal, vscode.Disposable {
  private readonly writeEmitter = new vscode.EventEmitter<string>();
  private readonly closeEmitter = new vscode.EventEmitter<number | void>();
  private inputHandler: ((data: string) => void) | undefined;
  private resizeHandler: ((dimensions: vscode.TerminalDimensions) => void) | undefined;

  readonly onDidWrite = this.writeEmitter.event;
  readonly onDidClose = this.closeEmitter.event;

  open(): void {}

  close(): void {
    this.closeEmitter.fire();
  }

  write(data: string): void {
    this.writeEmitter.fire(data.replace(/\r?\n/g, "\r\n"));
  }

  handleInput(data: string): void {
    this.inputHandler?.(data);
  }

  setDimensions(dimensions: vscode.TerminalDimensions): void {
    this.resizeHandler?.(dimensions);
  }

  attachInputHandler(handler: (data: string) => void): void {
    this.inputHandler = handler;
  }

  attachResizeHandler(handler: (dimensions: vscode.TerminalDimensions) => void): void {
    this.resizeHandler = handler;
  }

  dispose(): void {
    this.writeEmitter.dispose();
    this.closeEmitter.dispose();
    this.inputHandler = undefined;
    this.resizeHandler = undefined;
  }
}
