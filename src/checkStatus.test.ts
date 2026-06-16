import { describe, expect, it } from 'vitest';
import {
  normalizeCheckStatus,
  normalizeStatusCheck,
  sortChecks,
  summarizeChecks,
} from './checkStatus';

describe('normalizeCheckStatus', () => {
  it('maps successful completed checks', () => {
    expect(normalizeCheckStatus('COMPLETED', 'SUCCESS')).toBe('success');
    expect(normalizeCheckStatus('completed', 'neutral')).toBe('success');
  });

  it('maps failed completed checks', () => {
    expect(normalizeCheckStatus('completed', 'failure')).toBe('failure');
    expect(normalizeCheckStatus('completed', 'error')).toBe('failure');
    expect(normalizeCheckStatus('completed', 'timed_out')).toBe('failure');
    expect(normalizeCheckStatus('completed', 'cancelled')).toBe('failure');
  });

  it('maps active checks before unknown states', () => {
    expect(normalizeCheckStatus('in_progress', undefined)).toBe('running');
    expect(normalizeCheckStatus('queued', undefined)).toBe('queued');
    expect(normalizeCheckStatus('completed', undefined)).toBe('unknown');
  });

  it('maps commit status states when a conclusion is not present', () => {
    expect(normalizeCheckStatus('success', undefined)).toBe('success');
    expect(normalizeCheckStatus('failure', undefined)).toBe('failure');
    expect(normalizeCheckStatus('error', undefined)).toBe('failure');
  });
});

describe('normalizeStatusCheck', () => {
  it('uses the check URL and workflow label from GitHub statusCheckRollup output', () => {
    expect(
      normalizeStatusCheck({
        name: 'test-dev (ubuntu-latest)',
        workflowName: 'Continuous Releases',
        status: 'COMPLETED',
        conclusion: 'SUCCESS',
        detailsUrl: 'https://github.com/example-org/example-repo/actions/runs/1/job/2',
      }),
    ).toEqual({
      name: 'test-dev (ubuntu-latest)',
      description: 'Continuous Releases: passed',
      status: 'success',
      detailsUrl: 'https://github.com/example-org/example-repo/actions/runs/1/job/2',
      startedAt: undefined,
      completedAt: undefined,
    });
  });

  it('uses the context, state, and target URL from GitHub status contexts', () => {
    expect(
      normalizeStatusCheck({
        __typename: 'StatusContext',
        context: 'ci/circleci: test_unit',
        state: 'SUCCESS',
        targetUrl: 'https://circleci.com/gh/example-org/example-repo/1',
        startedAt: '2026-06-16T13:39:24Z',
      }),
    ).toEqual({
      name: 'ci/circleci: test_unit',
      description: 'passed',
      status: 'success',
      detailsUrl: 'https://circleci.com/gh/example-org/example-repo/1',
      startedAt: '2026-06-16T13:39:24Z',
      completedAt: undefined,
    });
  });
});

describe('sortChecks', () => {
  it('puts checks needing attention before passing checks', () => {
    const checks = sortChecks([
      { name: 'passed', description: 'passed', status: 'success' },
      { name: 'queued', description: 'queued', status: 'queued' },
      { name: 'failed', description: 'failed', status: 'failure' },
      { name: 'running', description: 'running', status: 'running' },
    ]);

    expect(checks.map((check) => check.name)).toEqual(['failed', 'running', 'queued', 'passed']);
  });
});

describe('summarizeChecks', () => {
  it('prioritizes failures in the summary', () => {
    expect(
      summarizeChecks([
        { name: 'failed', description: 'failed', status: 'failure' },
        { name: 'passed', description: 'passed', status: 'success' },
      ]),
    ).toBe('1 failed, 1 passed');
  });
});
