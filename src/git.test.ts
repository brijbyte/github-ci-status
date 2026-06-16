import { describe, expect, it } from 'vitest';
import { parseGitHubRepositoryCandidates } from './git';

describe('parseGitHubRepositoryCandidates', () => {
  it('parses GitHub repositories from HTTPS and SSH remotes', () => {
    expect(
      parseGitHubRepositoryCandidates(
        [
          'origin\thttps://github.com/example-user/example-repo.git (fetch)',
          'origin\thttps://github.com/example-user/example-repo.git (push)',
          'upstream\tgit@github.com:another-org/base-repo.git (fetch)',
          'upstream\tgit@github.com:another-org/base-repo.git (push)',
        ].join('\n'),
      ),
    ).toEqual([
      {
        owner: 'example-user',
        repo: 'example-repo',
      },
      {
        owner: 'another-org',
        repo: 'base-repo',
      },
    ]);
  });

  it('ignores non-GitHub remotes', () => {
    expect(
      parseGitHubRepositoryCandidates(
        [
          'origin\tgit@gitlab.com:example-user/example-repo.git (fetch)',
          'github\thttps://github.com/owner/repo (fetch)',
        ].join('\n'),
      ),
    ).toEqual([
      {
        owner: 'owner',
        repo: 'repo',
      },
    ]);
  });
});
