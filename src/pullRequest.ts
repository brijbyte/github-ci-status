import { normalizeStatusCheck, sortChecks } from './checkStatus';
import type { CiCheck } from './checkStatus';
import { loadGitBranchState, loadGitHubRepositoryCandidates, runCommand } from './git';
import type { GitHubRepository } from './git';
import {
  loadChecksFromGitHubApi,
  loadPullRequestIdentityFromGitHubApi,
  type PullRequestIdentity,
} from './githubApi';

export interface PullRequestInfo extends PullRequestIdentity {
  checks: CiCheck[];
}

interface PullRequestJson {
  number?: unknown;
  url?: unknown;
  headRefName?: unknown;
  statusCheckRollup?: unknown;
}

export async function loadPullRequest(
  cwd: string,
  log: (message: string) => void = () => undefined,
): Promise<PullRequestInfo | undefined> {
  const gitState = await loadGitBranchState(cwd);

  if (!gitState) {
    log('No Git branch detected (not a repo or detached HEAD).');
    return undefined;
  }

  log(`Git state: branch="${gitState.branch}" headSha=${gitState.headSha.slice(0, 8)}`);

  const repositories = await loadGitHubRepositoryCandidates(cwd);
  log(
    `GitHub repository candidates: ${
      repositories.map((repository) => `${repository.owner}/${repository.repo}`).join(', ') ||
      '(none)'
    }`,
  );

  const pullRequest = await loadPullRequestWithPreferredProvider(
    cwd,
    repositories,
    gitState.branch,
    gitState.headSha,
    log,
  );

  log(
    pullRequest
      ? `Fetched PR #${pullRequest.number} (head "${pullRequest.headRefName}") with ${pullRequest.checks.length} check(s).`
      : 'No pull request found for this branch.',
  );

  return pullRequest;
}

async function loadPullRequestWithPreferredProvider(
  cwd: string,
  repositories: readonly GitHubRepository[],
  branch: string,
  headSha: string,
  log: (message: string) => void,
): Promise<PullRequestInfo | undefined> {
  try {
    log(`Trying GitHub CLI: gh pr view "${branch}".`);
    const pullRequest = await loadPullRequestWithGh(cwd, repositories, branch);

    if (!pullRequest) {
      log('GitHub CLI returned no pull request for this branch.');
      return undefined;
    }

    if (pullRequest.checks.length > 0) {
      log(`GitHub CLI returned PR #${pullRequest.number} with rollup checks.`);
      return pullRequest;
    }

    log(`GitHub CLI returned PR #${pullRequest.number} with empty rollup. Reloading checks.`);
    return {
      ...pullRequest,
      checks: await loadChecks(cwd, pullRequest, headSha),
    };
  } catch (error) {
    log(`GitHub CLI path failed (${getMessage(error)}). Falling back to GitHub API.`);
    const identity = await loadPullRequestIdentityFromGitHubApi(repositories, branch, headSha);

    if (!identity) {
      log('GitHub API found no open PR whose head matches this branch.');
      return undefined;
    }

    log(`GitHub API matched PR #${identity.number} (head "${identity.headRefName}").`);
    return {
      ...identity,
      checks: await loadChecksFromGitHubApi(identity.repository, headSha),
    };
  }
}

function getMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function loadChecks(
  cwd: string,
  pullRequestIdentity: PullRequestIdentity,
  headSha: string,
): Promise<CiCheck[]> {
  try {
    const checks = await loadChecksWithGh(cwd, pullRequestIdentity.url);

    if (checks.length > 0) {
      return checks;
    }

    return await loadChecksFromGitHubApi(pullRequestIdentity.repository, headSha);
  } catch {
    return await loadChecksFromGitHubApi(pullRequestIdentity.repository, headSha);
  }
}

async function loadPullRequestWithGh(
  cwd: string,
  repositories: readonly GitHubRepository[],
  branch: string,
): Promise<PullRequestInfo | undefined> {
  const output = await runCommand(
    'gh',
    ['pr', 'view', branch, '--json', 'number,url,headRefName,statusCheckRollup'],
    cwd,
  );

  return parsePullRequest(output, repositories);
}

async function loadChecksWithGh(cwd: string, pullRequestUrl: string): Promise<CiCheck[]> {
  const output = await runCommand(
    'gh',
    ['pr', 'view', pullRequestUrl, '--json', 'statusCheckRollup'],
    cwd,
  );
  const parsed = JSON.parse(output) as PullRequestJson;

  return parseStatusCheckRollup(parsed.statusCheckRollup);
}

function parsePullRequest(
  output: string,
  repositories: readonly GitHubRepository[],
): PullRequestInfo | undefined {
  const parsed = JSON.parse(output) as PullRequestJson;

  if (typeof parsed.number !== 'number' || typeof parsed.url !== 'string') {
    return undefined;
  }

  const repository = parseGitHubRepositoryFromPullRequestUrl(parsed.url) ?? repositories.at(0);

  if (!repository) {
    throw new Error('Unable to infer the GitHub repository for this pull request.');
  }

  return {
    number: parsed.number,
    url: parsed.url,
    headRefName: typeof parsed.headRefName === 'string' ? parsed.headRefName : 'current branch',
    repository,
    checks: parseStatusCheckRollup(parsed.statusCheckRollup),
  };
}

function parseStatusCheckRollup(statusCheckRollup: unknown): CiCheck[] {
  return Array.isArray(statusCheckRollup)
    ? sortChecks(
        statusCheckRollup.map((rawCheck: unknown) =>
          normalizeStatusCheck(isObject(rawCheck) ? rawCheck : {}),
        ),
      )
    : [];
}

function parseGitHubRepositoryFromPullRequestUrl(url: string): GitHubRepository | undefined {
  const parsedUrl = new URL(url);

  if (parsedUrl.hostname !== 'github.com') {
    return undefined;
  }

  const normalizedPathname = parsedUrl.pathname.startsWith('/')
    ? parsedUrl.pathname.slice(1)
    : parsedUrl.pathname;
  const [owner, repo, route] = normalizedPathname.split('/');

  if (!owner || !repo || route !== 'pull') {
    return undefined;
  }

  return {
    owner,
    repo,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
