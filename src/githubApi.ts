import * as vscode from 'vscode';
import { normalizeStatusCheck, sortChecks } from './checkStatus';
import type { CiCheck, RawStatusCheck } from './checkStatus';
import type { GitHubRepository } from './git';

const API_BASE_URL = 'https://api.github.com';

interface GitHubPullRequest {
  number?: unknown;
  html_url?: unknown;
  state?: unknown;
  head?: unknown;
}

interface GitHubPullRequestHead {
  ref?: unknown;
}

interface ResolvedGitHubPullRequest {
  number: number;
  html_url: string;
  state?: unknown;
  head?: unknown;
}

interface PullRequestMatch {
  repository: GitHubRepository;
  pullRequest: ResolvedGitHubPullRequest;
}

interface GitHubCheckRunsResponse {
  total_count?: unknown;
  check_runs?: unknown;
}

interface GitHubCheckRun {
  name?: unknown;
  status?: unknown;
  conclusion?: unknown;
  details_url?: unknown;
  html_url?: unknown;
  started_at?: unknown;
  completed_at?: unknown;
}

interface GitHubCombinedStatusResponse {
  statuses?: unknown;
}

interface GitHubCommitStatus {
  context?: unknown;
  state?: unknown;
  target_url?: unknown;
  description?: unknown;
  updated_at?: unknown;
}

export interface PullRequestIdentity {
  number: number;
  url: string;
  headRefName: string;
  repository: GitHubRepository;
}

export async function loadPullRequestIdentityFromGitHubApi(
  repositories: readonly GitHubRepository[],
  branch: string,
  headSha: string,
): Promise<PullRequestIdentity | undefined> {
  const token = await loadGitHubToken();
  const settledPullRequests = await Promise.allSettled(
    repositories.map(async (repository) => ({
      repository,
      pullRequests: await githubRequest<GitHubPullRequest[]>(
        `/repos/${repository.owner}/${repository.repo}/commits/${encodeURIComponent(headSha)}/pulls`,
        token,
      ),
    })),
  );
  const matches = settledPullRequests
    .filter(
      (
        result,
      ): result is PromiseFulfilledResult<{
        repository: GitHubRepository;
        pullRequests: GitHubPullRequest[];
      }> => result.status === 'fulfilled',
    )
    .flatMap((result) =>
      result.value.pullRequests.map((pullRequest) => ({
        repository: result.value.repository,
        pullRequest,
      })),
    );
  const match =
    matches.find(
      (candidate): candidate is PullRequestMatch =>
        isResolvedPullRequestMatch(candidate) &&
        readPullRequestHeadRef(candidate.pullRequest.head) === branch,
    ) ?? matches.find(isResolvedPullRequestMatch);

  if (!match) {
    return undefined;
  }

  const { pullRequest, repository } = match;

  return {
    number: pullRequest.number,
    url: pullRequest.html_url,
    headRefName: readPullRequestHeadRef(pullRequest.head) ?? branch,
    repository,
  };
}

export async function loadChecksFromGitHubApi(
  repository: GitHubRepository,
  headSha: string,
): Promise<CiCheck[]> {
  const token = await loadGitHubToken();
  const [checkRuns, commitStatuses] = await Promise.all([
    loadCheckRuns(token, repository, headSha),
    loadCommitStatuses(token, repository, headSha),
  ]);

  return sortChecks([...checkRuns, ...commitStatuses]);
}

async function loadGitHubToken(): Promise<string> {
  const session = await vscode.authentication.getSession('github', ['repo'], {
    createIfNone: true,
  });

  return session.accessToken;
}

async function loadCheckRuns(
  token: string,
  repository: GitHubRepository,
  headSha: string,
): Promise<CiCheck[]> {
  const checkRuns = await loadCheckRunPages(token, repository, headSha);
  return checkRuns.map((checkRun) =>
    normalizeStatusCheck({
      name: readString(checkRun.name),
      status: readString(checkRun.status),
      conclusion: readString(checkRun.conclusion),
      detailsUrl: readString(checkRun.details_url) ?? readString(checkRun.html_url),
      startedAt: readString(checkRun.started_at),
      completedAt: readString(checkRun.completed_at),
    }),
  );
}

async function loadCheckRunPages(
  token: string,
  repository: GitHubRepository,
  headSha: string,
  page = 1,
  collectedCheckRuns: GitHubCheckRun[] = [],
): Promise<GitHubCheckRun[]> {
  const response = await githubRequest<GitHubCheckRunsResponse>(
    `/repos/${repository.owner}/${repository.repo}/commits/${encodeURIComponent(headSha)}/check-runs?per_page=100&page=${page}`,
    token,
  );
  const checkRuns = Array.isArray(response.check_runs)
    ? response.check_runs.filter(isGitHubCheckRun)
    : [];
  const nextCheckRuns = [...collectedCheckRuns, ...checkRuns];
  const totalCount =
    typeof response.total_count === 'number' ? response.total_count : nextCheckRuns.length;

  if (nextCheckRuns.length >= totalCount || page >= 10) {
    return nextCheckRuns;
  }

  return loadCheckRunPages(token, repository, headSha, page + 1, nextCheckRuns);
}

async function loadCommitStatuses(
  token: string,
  repository: GitHubRepository,
  headSha: string,
): Promise<CiCheck[]> {
  const response = await githubRequest<GitHubCombinedStatusResponse>(
    `/repos/${repository.owner}/${repository.repo}/commits/${encodeURIComponent(headSha)}/status`,
    token,
  );
  const statuses = Array.isArray(response.statuses)
    ? response.statuses.filter(isGitHubCommitStatus)
    : [];

  return statuses.map((status) => normalizeStatusCheck(mapCommitStatusToRawStatusCheck(status)));
}

function mapCommitStatusToRawStatusCheck(status: GitHubCommitStatus): RawStatusCheck {
  const state = readString(status.state);

  return {
    name: readString(status.context),
    status: state === 'pending' ? 'pending' : 'completed',
    conclusion: state,
    detailsUrl: readString(status.target_url),
    completedAt: readString(status.updated_at),
  };
}

async function githubRequest<ResponseBody>(path: string, token: string): Promise<ResponseBody> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API request failed with ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as ResponseBody;
}

function readPullRequestHeadRef(head: unknown): string | undefined {
  if (!isObject(head)) {
    return undefined;
  }

  const pullRequestHead = head as GitHubPullRequestHead;
  return readString(pullRequestHead.ref);
}

function isResolvedPullRequestMatch(candidate: {
  repository: GitHubRepository;
  pullRequest: GitHubPullRequest;
}): candidate is PullRequestMatch {
  return (
    candidate.pullRequest.state === 'open' &&
    typeof candidate.pullRequest.number === 'number' &&
    typeof candidate.pullRequest.html_url === 'string'
  );
}

function isGitHubCheckRun(value: unknown): value is GitHubCheckRun {
  return isObject(value);
}

function isGitHubCommitStatus(value: unknown): value is GitHubCommitStatus {
  return isObject(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
