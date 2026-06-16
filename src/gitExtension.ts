import type * as vscode from 'vscode';

export interface GitExtension {
  getAPI(version: 1): GitApi;
}

export interface GitApi {
  readonly repositories: GitRepository[];
  onDidOpenRepository: vscode.Event<GitRepository>;
  onDidCloseRepository: vscode.Event<GitRepository>;
}

export interface GitRepository {
  readonly rootUri: vscode.Uri;
  readonly state: GitRepositoryState;
}

export interface GitRepositoryState {
  readonly HEAD: GitBranch | undefined;
  onDidChange: vscode.Event<void>;
}

export interface GitBranch {
  readonly name?: string;
  readonly commit?: string;
}
