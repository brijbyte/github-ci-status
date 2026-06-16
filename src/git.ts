import * as childProcess from 'node:child_process';
import * as util from 'node:util';

const execFile = util.promisify(childProcess.execFile);

export interface GitBranchState {
  branch: string;
  headSha: string;
}

export interface GitHubRepository {
  owner: string;
  repo: string;
}

export async function loadGitBranchState(cwd: string): Promise<GitBranchState | undefined> {
  const [branch, headSha] = await Promise.all([
    runCommand('git', ['branch', '--show-current'], cwd),
    runCommand('git', ['rev-parse', 'HEAD'], cwd),
  ]);

  if (!branch) {
    return undefined;
  }

  return {
    branch,
    headSha,
  };
}

export async function loadGitHubRepositoryCandidates(cwd: string): Promise<GitHubRepository[]> {
  try {
    const output = await runCommand('git', ['remote', '-v'], cwd);
    return parseGitHubRepositoryCandidates(output);
  } catch {
    return [];
  }
}

export async function isGitHubRepository(cwd: string): Promise<boolean> {
  const repositories = await loadGitHubRepositoryCandidates(cwd);
  return repositories.length > 0;
}

export function parseGitHubRepositoryCandidates(remoteOutput: string): GitHubRepository[] {
  const repositories = remoteOutput
    .split('\n')
    .map((line) => parseGitHubRepositoryFromRemoteLine(line))
    .filter((repository): repository is GitHubRepository => Boolean(repository));
  const uniqueRepositories = new Map<string, GitHubRepository>();

  for (const repository of repositories) {
    uniqueRepositories.set(`${repository.owner}/${repository.repo}`, repository);
  }

  return [...uniqueRepositories.values()];
}

export async function runCommand(
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<string> {
  const result = await execFile(command, [...args], {
    cwd,
    timeout: 30000,
    maxBuffer: 1024 * 1024 * 5,
  });

  return result.stdout.trim();
}

function parseGitHubRepositoryFromRemoteLine(line: string): GitHubRepository | undefined {
  const remoteUrl = line.split(/\s+/)[1];

  if (!remoteUrl) {
    return undefined;
  }

  return parseGitHubRepositoryUrl(remoteUrl);
}

function parseGitHubRepositoryUrl(remoteUrl: string): GitHubRepository | undefined {
  if (remoteUrl.startsWith('https://github.com/')) {
    return parseGitHubRepositoryPath(new URL(remoteUrl).pathname);
  }

  if (remoteUrl.startsWith('git@github.com:')) {
    return parseGitHubRepositoryPath(remoteUrl.slice('git@github.com:'.length));
  }

  return undefined;
}

function parseGitHubRepositoryPath(pathname: string): GitHubRepository | undefined {
  const normalizedPathname = pathname.startsWith('/') ? pathname.slice(1) : pathname;
  const pathParts = normalizedPathname.split('/');

  if (pathParts.length < 2) {
    return undefined;
  }

  const [owner, repoWithSuffix] = pathParts;
  const repo = repoWithSuffix.endsWith('.git') ? repoWithSuffix.slice(0, -4) : repoWithSuffix;

  if (!owner || !repo) {
    return undefined;
  }

  return {
    owner,
    repo,
  };
}
