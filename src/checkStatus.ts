export type CheckStatusKind = 'success' | 'failure' | 'running' | 'queued' | 'skipped' | 'unknown';

export interface RawStatusCheck {
  __typename?: unknown;
  name?: unknown;
  context?: unknown;
  workflowName?: unknown;
  status?: unknown;
  state?: unknown;
  conclusion?: unknown;
  detailsUrl?: unknown;
  targetUrl?: unknown;
  url?: unknown;
  startedAt?: unknown;
  completedAt?: unknown;
}

export interface CiCheck {
  name: string;
  description: string;
  status: CheckStatusKind;
  detailsUrl?: string;
  startedAt?: string;
  completedAt?: string;
}

const STATUS_ORDER: Record<CheckStatusKind, number> = {
  failure: 0,
  running: 1,
  queued: 2,
  unknown: 3,
  skipped: 4,
  success: 5,
};

const SUCCESS_CONCLUSIONS = new Set(['success', 'neutral']);
const FAILURE_CONCLUSIONS = new Set([
  'action_required',
  'cancelled',
  'error',
  'failure',
  'startup_failure',
  'stale',
  'timed_out',
]);
const SKIPPED_CONCLUSIONS = new Set(['skipped']);
const RUNNING_STATUSES = new Set(['in_progress', 'pending', 'requested', 'waiting']);
const QUEUED_STATUSES = new Set(['expected', 'queued']);

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function normalizeCheckStatus(status: unknown, conclusion: unknown): CheckStatusKind {
  const normalizedConclusion = readString(conclusion)?.toLowerCase();
  const normalizedStatus = readString(status)?.toLowerCase();

  if (normalizedConclusion && SUCCESS_CONCLUSIONS.has(normalizedConclusion)) {
    return 'success';
  }

  if (normalizedConclusion && FAILURE_CONCLUSIONS.has(normalizedConclusion)) {
    return 'failure';
  }

  if (normalizedConclusion && SKIPPED_CONCLUSIONS.has(normalizedConclusion)) {
    return 'skipped';
  }

  if (normalizedStatus && RUNNING_STATUSES.has(normalizedStatus)) {
    return 'running';
  }

  if (normalizedStatus && QUEUED_STATUSES.has(normalizedStatus)) {
    return 'queued';
  }

  if (normalizedStatus === 'success') {
    return 'success';
  }

  if (normalizedStatus === 'error' || normalizedStatus === 'failure') {
    return 'failure';
  }

  if (normalizedStatus === 'completed') {
    return 'unknown';
  }

  return 'unknown';
}

export function normalizeStatusCheck(rawCheck: RawStatusCheck): CiCheck {
  const name =
    readString(rawCheck.name) ??
    readString(rawCheck.context) ??
    readString(rawCheck.workflowName) ??
    'Unnamed check';
  const workflowName = readString(rawCheck.workflowName);
  const status = normalizeCheckStatus(
    readString(rawCheck.status) ?? readString(rawCheck.state),
    readString(rawCheck.conclusion) ?? readString(rawCheck.state),
  );
  const statusLabel = status === 'success' ? 'passed' : status;
  const description =
    workflowName && workflowName !== name ? `${workflowName}: ${statusLabel}` : statusLabel;

  return {
    name,
    description,
    status,
    detailsUrl:
      readString(rawCheck.detailsUrl) ?? readString(rawCheck.targetUrl) ?? readString(rawCheck.url),
    startedAt: readString(rawCheck.startedAt),
    completedAt: readString(rawCheck.completedAt),
  };
}

export function sortChecks(checks: readonly CiCheck[]): CiCheck[] {
  return [...checks].sort((firstCheck, secondCheck) => {
    const statusDifference = STATUS_ORDER[firstCheck.status] - STATUS_ORDER[secondCheck.status];

    if (statusDifference !== 0) {
      return statusDifference;
    }

    return firstCheck.name.localeCompare(secondCheck.name);
  });
}

export function summarizeChecks(checks: readonly CiCheck[]): string {
  if (checks.length === 0) {
    return 'No checks';
  }

  const failedCount = checks.filter((check) => check.status === 'failure').length;
  const activeCount = checks.filter(
    (check) => check.status === 'running' || check.status === 'queued',
  ).length;
  const passedCount = checks.filter((check) => check.status === 'success').length;

  if (failedCount > 0) {
    return `${failedCount} failed, ${passedCount} passed`;
  }

  if (activeCount > 0) {
    return `${activeCount} running, ${passedCount} passed`;
  }

  return `${passedCount}/${checks.length} passed`;
}
