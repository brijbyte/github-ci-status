# GitHub CI Status

VS Code extension for checking the current branch pull request CI status in GitHub repositories.

## Usage

1. Open a GitHub repository workspace in VS Code.
2. Use the **CI** item in the status bar.

The extension uses `gh pr view` when the GitHub CLI is available. If `gh` is not installed or cannot load the pull request, it falls back to VS Code's GitHub authentication and the GitHub API.

Pull request discovery is cached by workspace, branch, and current commit SHA for five minutes. Refreshes still reload CI checks so running jobs can update without repeating the same PR lookup.

The status bar item shows the number of passing checks out of the total checks. A green pass icon means every check passed. A red error icon means at least one check failed. Click the status bar item to list every check and open a check or pull request in the browser.

## Commands

- `GitHub CI Status: Refresh CI Status`
- `GitHub CI Status: Open Pull Request`

## Development

```bash
pnpm build
pnpm test
pnpm typescript
```

## Publishing

The GitHub Actions publish workflow runs on pushes to `main`. It publishes only when
`package.json` has a new version and that version does not already exist on the
Visual Studio Marketplace.

Configure the repository secret `VSCE_PAT` with a Visual Studio Marketplace
personal access token that can publish under the `brijbyte` publisher.
