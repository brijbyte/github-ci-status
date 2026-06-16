import * as vscode from 'vscode';
import type { CiCheck } from './checkStatus';
import { summarizeChecks } from './checkStatus';
import { isGitHubRepository } from './git';
import { loadPullRequest, type PullRequestInfo } from './pullRequest';

interface CheckQuickPickItem extends vscode.QuickPickItem {
  check?: CiCheck;
  action?: 'openPullRequest' | 'refresh';
}

interface CheckIconUris {
  failure: vscode.Uri;
  queued: vscode.Uri;
  running: vscode.Uri;
  skipped: vscode.Uri;
  success: vscode.Uri;
  unknown: vscode.Uri;
}

const EMPTY_CHECK_RETRY_DELAYS_MS = [1500, 3000, 6000];

class CiStatusProvider implements vscode.Disposable {
  private readonly statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  private emptyCheckRetryCount = 0;
  private emptyCheckRetryTimer: NodeJS.Timeout | undefined;
  private refreshTimer: NodeJS.Timeout | undefined;
  private pullRequest: PullRequestInfo | undefined;
  private state: 'idle' | 'loading' | 'loaded' | 'error' = 'idle';
  private message = 'Open a workspace folder to load CI checks.';

  constructor(
    private readonly checkIconUris: CheckIconUris,
    private readonly outputChannel: vscode.OutputChannel,
    private readonly identityStorage: vscode.Memento,
  ) {
    this.statusBarItem.command = 'githubCiStatus.showChecks';
    this.statusBarItem.name = 'GitHub CI Status';
    this.statusBarItem.show();
    this.updateStatusBar();
    this.configureAutoRefresh();
  }

  async refresh(options: { preserveEmptyCheckRetries?: boolean } = {}): Promise<void> {
    this.log(
      options.preserveEmptyCheckRetries
        ? 'Retrying CI check refresh after empty check result.'
        : 'Refreshing CI checks.',
    );

    if (!options.preserveEmptyCheckRetries) {
      this.clearEmptyCheckRetry();
      this.emptyCheckRetryCount = 0;
    }

    this.state = 'loading';
    this.message = 'Loading current branch CI checks...';
    this.updateStatusBar();

    try {
      const workspaceFolder = await findWorkspaceFolder();

      if (!workspaceFolder) {
        this.log('No workspace folder found.');
        this.pullRequest = undefined;
        this.state = 'loaded';
        this.message = 'Open a GitHub repository to view CI checks.';
        this.updateStatusBar();
        return;
      }

      this.log(`Using workspace folder: ${workspaceFolder.uri.fsPath}`);
      this.pullRequest = await loadPullRequest(workspaceFolder.uri.fsPath, this.identityStorage);

      if (this.pullRequest?.checks.length === 0 && this.scheduleEmptyCheckRetry()) {
        this.state = 'loading';
        this.message = `Waiting for CI checks on pull request #${this.pullRequest.number}...`;
        this.updateStatusBar();
        return;
      }

      if (this.pullRequest?.checks.length) {
        this.clearEmptyCheckRetry();
        this.emptyCheckRetryCount = 0;
      }

      this.state = 'loaded';
      this.message = this.pullRequest
        ? `#${this.pullRequest.number} ${summarizeChecks(this.pullRequest.checks)}`
        : 'No pull request found for the current branch.';
      this.log(this.pullRequest ? this.message : 'No pull request found for the current branch.');
    } catch (error) {
      this.pullRequest = undefined;
      this.state = 'error';
      this.message = getErrorMessage(error);
      this.log(`Refresh failed: ${this.message}`);
    }

    this.updateStatusBar();
  }

  async openPullRequest(): Promise<void> {
    if (!this.pullRequest) {
      await vscode.window.showInformationMessage(
        'No pull request is loaded for the current branch.',
      );
      return;
    }

    await vscode.env.openExternal(vscode.Uri.parse(this.pullRequest.url));
  }

  async openCheck(check?: CiCheck): Promise<void> {
    if (check?.detailsUrl) {
      await vscode.env.openExternal(vscode.Uri.parse(check.detailsUrl));
    }
  }

  async showChecks(): Promise<void> {
    if (this.state === 'idle') {
      await this.refresh();
    }

    if (this.state === 'loading') {
      await vscode.window.showInformationMessage('CI checks are still loading.');
      return;
    }

    if (this.state === 'error') {
      const selection = await vscode.window.showErrorMessage(this.message, 'Refresh');

      if (selection === 'Refresh') {
        await this.refresh();
      }

      return;
    }

    if (!this.pullRequest) {
      const selection = await vscode.window.showInformationMessage(this.message, 'Refresh');

      if (selection === 'Refresh') {
        await this.refresh();
      }

      return;
    }

    const selectedItem = await vscode.window.showQuickPick(
      createQuickPickItems(this.pullRequest, this.checkIconUris),
      {
        placeHolder: `Pull request #${this.pullRequest.number}`,
        title: createStatusBarSummary(this.pullRequest.checks).tooltip,
      },
    );

    if (!selectedItem) {
      return;
    }

    if (selectedItem.action === 'openPullRequest') {
      await this.openPullRequest();
      return;
    }

    if (selectedItem.action === 'refresh') {
      await this.refresh();
      return;
    }

    await this.openCheck(selectedItem.check);
  }

  configureAutoRefresh(): void {
    this.refreshTimer?.close();

    const config = vscode.workspace.getConfiguration('githubCiStatus');
    const intervalSeconds = config.get<number>('autoRefreshIntervalSeconds', 60);

    if (intervalSeconds > 0) {
      this.refreshTimer = setInterval(() => {
        void this.refresh();
      }, intervalSeconds * 1000);
    }
  }

  dispose(): void {
    this.clearEmptyCheckRetry();
    this.refreshTimer?.close();
    this.statusBarItem.dispose();
    this.outputChannel.dispose();
  }

  private clearEmptyCheckRetry(): void {
    this.emptyCheckRetryTimer?.close();
    this.emptyCheckRetryTimer = undefined;
  }

  private scheduleEmptyCheckRetry(): boolean {
    const delayMs = EMPTY_CHECK_RETRY_DELAYS_MS[this.emptyCheckRetryCount];

    if (!delayMs) {
      return false;
    }

    this.clearEmptyCheckRetry();
    this.emptyCheckRetryCount += 1;
    this.log(
      `Pull request #${this.pullRequest?.number ?? 'unknown'} returned no checks. Retrying in ${delayMs}ms.`,
    );
    this.emptyCheckRetryTimer = setTimeout(() => {
      void this.refresh({ preserveEmptyCheckRetries: true });
    }, delayMs);

    return true;
  }

  private log(message: string): void {
    this.outputChannel.appendLine(`[${new Date().toISOString()}] ${message}`);
  }

  private updateStatusBar(): void {
    this.statusBarItem.backgroundColor = undefined;
    this.statusBarItem.color = undefined;

    if (this.state === 'loading') {
      this.statusBarItem.text = '$(tasklist) $(sync~spin)';
      this.statusBarItem.tooltip = this.message;
      return;
    }

    if (this.state === 'error') {
      this.statusBarItem.text = '$(tasklist) $(error)';
      this.statusBarItem.tooltip = this.message;
      this.statusBarItem.color = new vscode.ThemeColor('testing.iconFailed');
      return;
    }

    if (this.pullRequest) {
      if (this.pullRequest.checks.length === 0) {
        this.statusBarItem.text = '$(tasklist) $(sync~spin)';
        this.statusBarItem.tooltip = `Pull request #${this.pullRequest.number} on ${this.pullRequest.headRefName}\nNo checks returned yet.`;
        return;
      }

      const summary = createStatusBarSummary(this.pullRequest.checks);
      this.statusBarItem.text = `${summary.icon} ${summary.passedCount}/${summary.totalCount}`;
      this.statusBarItem.tooltip = `Pull request #${this.pullRequest.number} on ${this.pullRequest.headRefName}\n${summary.tooltip}`;
      this.statusBarItem.color = summary.color;
      return;
    }

    this.statusBarItem.text = '$(tasklist) CI';
    this.statusBarItem.tooltip = this.message;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new CiStatusProvider(
    createCheckIconUris(context.extensionUri),
    vscode.window.createOutputChannel('GitHub CI Status'),
    context.globalState,
  );

  context.subscriptions.push(
    provider,
    vscode.commands.registerCommand('githubCiStatus.showChecks', async () => {
      await provider.showChecks();
    }),
    vscode.commands.registerCommand('githubCiStatus.refresh', async () => {
      await provider.refresh();
    }),
    vscode.commands.registerCommand('githubCiStatus.openPullRequest', async () => {
      await provider.openPullRequest();
    }),
    vscode.commands.registerCommand('githubCiStatus.openCheck', async (check?: CiCheck) => {
      await provider.openCheck(check);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('githubCiStatus.autoRefreshIntervalSeconds')) {
        provider.configureAutoRefresh();
      }
    }),
  );

  void provider.refresh();
}

export function deactivate(): void {}

async function findWorkspaceFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const repositoryMatches = await Promise.all(
    folders.map(async (folder) => ({
      folder,
      isGitHub: await isGitHubRepository(folder.uri.fsPath),
    })),
  );

  return (
    repositoryMatches.find((repositoryMatch) => repositoryMatch.isGitHub)?.folder ?? folders[0]
  );
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function createStatusBarSummary(checks: readonly CiCheck[]): {
  icon: string;
  color: vscode.ThemeColor | undefined;
  passedCount: number;
  totalCount: number;
  tooltip: string;
} {
  const totalCount = checks.length;
  const passedCount = checks.filter((check) => check.status === 'success').length;
  const failedCount = checks.filter((check) => check.status === 'failure').length;
  const activeCount = checks.filter(
    (check) => check.status === 'running' || check.status === 'queued',
  ).length;

  if (failedCount > 0) {
    return {
      icon: '$(error)',
      color: new vscode.ThemeColor('testing.iconFailed'),
      passedCount,
      totalCount,
      tooltip: `${passedCount}/${totalCount} checks passed, ${failedCount} failed`,
    };
  }

  if (totalCount > 0 && passedCount === totalCount) {
    return {
      icon: '$(pass)',
      color: new vscode.ThemeColor('testing.iconPassed'),
      passedCount,
      totalCount,
      tooltip: `${passedCount}/${totalCount} checks passed`,
    };
  }

  if (activeCount > 0) {
    return {
      icon: '$(sync~spin)',
      color: undefined,
      passedCount,
      totalCount,
      tooltip: `${passedCount}/${totalCount} checks passed, ${activeCount} running`,
    };
  }

  return {
    icon: '$(question)',
    color: undefined,
    passedCount,
    totalCount,
    tooltip: summarizeChecks(checks),
  };
}

function createQuickPickItems(
  pullRequest: PullRequestInfo,
  checkIconUris: CheckIconUris,
): CheckQuickPickItem[] {
  return [
    {
      label: `Open pull request #${pullRequest.number}`,
      description: pullRequest.headRefName,
      iconPath: new vscode.ThemeIcon('github'),
      action: 'openPullRequest',
    },
    {
      label: 'Refresh',
      iconPath: new vscode.ThemeIcon('refresh'),
      action: 'refresh',
    },
    ...pullRequest.checks.map((check) => ({
      label: check.name,
      description: check.description,
      detail: check.detailsUrl,
      iconPath: checkIconUris[check.status],
      check,
    })),
  ];
}

function createCheckIconUris(extensionUri: vscode.Uri): CheckIconUris {
  return {
    failure: vscode.Uri.joinPath(extensionUri, 'resources', 'failure.svg'),
    queued: vscode.Uri.joinPath(extensionUri, 'resources', 'queued.svg'),
    running: vscode.Uri.joinPath(extensionUri, 'resources', 'running.svg'),
    skipped: vscode.Uri.joinPath(extensionUri, 'resources', 'skipped.svg'),
    success: vscode.Uri.joinPath(extensionUri, 'resources', 'success.svg'),
    unknown: vscode.Uri.joinPath(extensionUri, 'resources', 'unknown.svg'),
  };
}
