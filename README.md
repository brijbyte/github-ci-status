# GitHub CI Status

See the CI status for the pull request behind your current Git branch directly
in the VS Code status bar.

GitHub CI Status is built for repositories that use GitHub pull requests and CI
providers such as GitHub Actions, CircleCI, Netlify, Argos, and any other service
that reports commit status checks back to GitHub.

## Features

- Shows pull request CI status in the status bar.
- Displays passing checks as `12/12` with a green pass icon.
- Displays failing checks as `19/20` with a red error icon.
- Shows running checks with a spinning sync icon.
- Opens a picker with every check, its status, and its details URL.
- Opens the current branch pull request from the picker.
- Works with GitHub Actions check runs and classic commit status contexts.
- Uses the GitHub CLI when available, then falls back to VS Code GitHub
  authentication and the GitHub API.
- Caches pull request discovery globally by repository, branch, and commit SHA
  for five minutes while still refreshing CI check results.

## How It Works

Open a GitHub repository in VS Code. When the current branch has an open pull
request, the status bar shows how many checks have passed out of the total
checks reported by GitHub.

Click the status bar item to open the check list. Select a check to open its CI
details page, or select the pull request row to open the pull request on GitHub.

## Requirements

The extension works best when the GitHub CLI is installed and authenticated:

```bash
gh auth login
```

If `gh` is unavailable or cannot load the pull request, the extension asks VS
Code for GitHub authentication and uses the GitHub API instead.

## Commands

- `GitHub CI Status`: show the current pull request checks.
- `GitHub CI Status: Refresh CI Status`: reload the current branch CI status.
- `GitHub CI Status: Open GitHub Pull Request`: open the current pull request.

## Settings

`githubCiStatus.autoRefreshIntervalSeconds`

Refresh interval for CI status checks. The default is `60`. Set it to `0` to
disable automatic refresh.

## Notes

- The extension only shows checks when the current branch has an open GitHub pull
  request.
- The status count is based on checks reported for the pull request head commit.
- Pull request discovery is cached for five minutes, but check results are
  refreshed on every manual or automatic refresh.

## Development

```bash
pnpm install
pnpm build
pnpm lint
pnpm prettier
pnpm test
pnpm typescript
```

## Publishing

The GitHub Actions publish workflow runs on pushes to `main`. It publishes only
when `package.json` has a new version and that version does not already exist on
the Visual Studio Marketplace.

Configure the repository secret `VSCE_PAT` with a Visual Studio Marketplace
personal access token that can publish under the `brijbyte` publisher.
