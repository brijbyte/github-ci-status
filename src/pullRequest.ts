import { normalizeStatusCheck, sortChecks } from './checkStatus';
import type { CiCheck } from './checkStatus';
import { loadGitBranchState, loadGitHubRepositoryCandidates, runCommand } from './git';
import type { GitHubRepository } from './git';
import {
  loadChecksFromGitHubApi,
  loadPullRequestIdentityFromGitHubApi,
  type PullRequestIdentity,
} from './githubApi';

const PR_IDENTITY_CACHE_TTL_MS = 5 * 60 * 1000;
const PR_IDENTITY_CACHE_STORAGE_KEY = 'pullRequestIdentityCache.v1';

export interface PullRequestInfo extends PullRequestIdentity {
  checks: CiCheck[];
}

export interface PullRequestIdentityStorage {
  get<Value>(key: string): Value | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

interface PullRequestJson {
  number?: unknown;
  url?: unknown;
  headRefName?: unknown;
  statusCheckRollup?: unknown;
}

interface PullRequestIdentityCacheEntry {
  expiresAt: number;
  identity: PullRequestIdentity | null;
}

const pullRequestIdentityCache = new Map<string, PullRequestIdentityCacheEntry>();

export async function loadPullRequest(
  cwd: string,
  identityStorage?: PullRequestIdentityStorage,
): Promise<PullRequestInfo | undefined> {
  const gitState = await loadGitBranchState(cwd);

  if (!gitState) {
    return undefined;
  }

  const repositories = await loadGitHubRepositoryCandidates(cwd);
  const cacheKey = createCacheKey(cwd, gitState.branch, gitState.headSha, repositories);
  const cachedIdentityResult = await readCachedPullRequestIdentity(cacheKey, identityStorage);

  if (cachedIdentityResult.hit) {
    if (!cachedIdentityResult.identity) {
      return undefined;
    }

    return {
      ...cachedIdentityResult.identity,
      checks: await loadChecks(cwd, cachedIdentityResult.identity, gitState.headSha),
    };
  }

  const pullRequest = await loadPullRequestWithPreferredProvider(
    cwd,
    repositories,
    gitState.branch,
    gitState.headSha,
  );

  await writeCachedPullRequestIdentity(cacheKey, pullRequest, identityStorage);

  return pullRequest;
}

async function loadPullRequestWithPreferredProvider(
  cwd: string,
  repositories: readonly GitHubRepository[],
  branch: string,
  headSha: string,
): Promise<PullRequestInfo | undefined> {
  try {
    const pullRequest = await loadPullRequestWithGh(cwd, repositories, branch);

    if (!pullRequest) {
      return undefined;
    }

    if (pullRequest.checks.length > 0) {
      return pullRequest;
    }

    return {
      ...pullRequest,
      checks: await loadChecks(cwd, pullRequest, headSha),
    };
  } catch {
    const identity = await loadPullRequestIdentityFromGitHubApi(repositories, branch, headSha);

    if (!identity) {
      return undefined;
    }

    return {
      ...identity,
      checks: await loadChecksFromGitHubApi(identity.repository, headSha),
    };
  }
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

    return loadChecksFromGitHubApi(pullRequestIdentity.repository, headSha);
  } catch {
    return loadChecksFromGitHubApi(pullRequestIdentity.repository, headSha);
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

  const repository = repositories[0] ?? parseGitHubRepositoryFromPullRequestUrl(parsed.url);

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
    ? sortChecks(statusCheckRollup.map((rawCheck) => normalizeStatusCheck(rawCheck)))
    : [];
}

async function readCachedPullRequestIdentity(
  cacheKey: string,
  identityStorage: PullRequestIdentityStorage | undefined,
): Promise<{
  hit: boolean;
  identity: PullRequestIdentity | undefined;
}> {
  const cacheEntry =
    pullRequestIdentityCache.get(cacheKey) ??
    readStoredPullRequestIdentityCacheEntry(cacheKey, identityStorage);

  if (!cacheEntry) {
    return {
      hit: false,
      identity: undefined,
    };
  }

  if (cacheEntry.expiresAt < Date.now()) {
    pullRequestIdentityCache.delete(cacheKey);
    await deleteStoredPullRequestIdentityCacheEntry(cacheKey, identityStorage);
    return {
      hit: false,
      identity: undefined,
    };
  }

  return {
    hit: true,
    identity: cacheEntry.identity ?? undefined,
  };
}

async function writeCachedPullRequestIdentity(
  cacheKey: string,
  pullRequest: PullRequestInfo | undefined,
  identityStorage: PullRequestIdentityStorage | undefined,
): Promise<void> {
  const cacheEntry = {
    expiresAt: Date.now() + PR_IDENTITY_CACHE_TTL_MS,
    identity: pullRequest
      ? {
          number: pullRequest.number,
          url: pullRequest.url,
          headRefName: pullRequest.headRefName,
          repository: pullRequest.repository,
        }
      : null,
  };

  pullRequestIdentityCache.set(cacheKey, cacheEntry);
  await writeStoredPullRequestIdentityCacheEntry(cacheKey, cacheEntry, identityStorage);
}

function createCacheKey(
  cwd: string,
  branch: string,
  headSha: string,
  repositories: readonly GitHubRepository[],
): string {
  const repositoryKey = repositories
    .map((repository) => `${repository.owner}/${repository.repo}`)
    .join(',');
  return `${cwd}:${branch}:${headSha}:${repositoryKey}`;
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

function readStoredPullRequestIdentityCacheEntry(
  cacheKey: string,
  identityStorage: PullRequestIdentityStorage | undefined,
): PullRequestIdentityCacheEntry | undefined {
  const storedCache = readStoredPullRequestIdentityCache(identityStorage);
  const cacheEntry = storedCache[cacheKey];

  if (!isPullRequestIdentityCacheEntry(cacheEntry)) {
    return undefined;
  }

  pullRequestIdentityCache.set(cacheKey, cacheEntry);
  return cacheEntry;
}

async function writeStoredPullRequestIdentityCacheEntry(
  cacheKey: string,
  cacheEntry: PullRequestIdentityCacheEntry,
  identityStorage: PullRequestIdentityStorage | undefined,
): Promise<void> {
  if (!identityStorage) {
    return;
  }

  await identityStorage.update(PR_IDENTITY_CACHE_STORAGE_KEY, {
    ...pruneExpiredPullRequestIdentityCache(readStoredPullRequestIdentityCache(identityStorage)),
    [cacheKey]: cacheEntry,
  });
}

async function deleteStoredPullRequestIdentityCacheEntry(
  cacheKey: string,
  identityStorage: PullRequestIdentityStorage | undefined,
): Promise<void> {
  if (!identityStorage) {
    return;
  }

  const storedCache = readStoredPullRequestIdentityCache(identityStorage);
  delete storedCache[cacheKey];
  await identityStorage.update(
    PR_IDENTITY_CACHE_STORAGE_KEY,
    pruneExpiredPullRequestIdentityCache(storedCache),
  );
}

function readStoredPullRequestIdentityCache(
  identityStorage: PullRequestIdentityStorage | undefined,
): Record<string, unknown> {
  const storedCache = identityStorage?.get<unknown>(PR_IDENTITY_CACHE_STORAGE_KEY);

  return isObject(storedCache) ? storedCache : {};
}

function pruneExpiredPullRequestIdentityCache(
  storedCache: Record<string, unknown>,
): Record<string, PullRequestIdentityCacheEntry> {
  const now = Date.now();
  const entries = Object.entries(storedCache).filter(
    (entry): entry is [string, PullRequestIdentityCacheEntry] =>
      isPullRequestIdentityCacheEntry(entry[1]) && entry[1].expiresAt >= now,
  );

  return Object.fromEntries(entries);
}

function isPullRequestIdentityCacheEntry(value: unknown): value is PullRequestIdentityCacheEntry {
  if (!isObject(value)) {
    return false;
  }

  return (
    typeof value.expiresAt === 'number' &&
    (value.identity === null || isPullRequestIdentity(value.identity))
  );
}

function isPullRequestIdentity(value: unknown): value is PullRequestIdentity {
  if (!isObject(value) || !isObject(value.repository)) {
    return false;
  }

  return (
    typeof value.number === 'number' &&
    typeof value.url === 'string' &&
    typeof value.headRefName === 'string' &&
    typeof value.repository.owner === 'string' &&
    typeof value.repository.repo === 'string'
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
