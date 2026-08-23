# GitHub

Provider for remotes whose host is `github.com`.

1. When `HEAD` has no upstream, run the push and the pull request as one
   command:

```bash
git push -u <remote> HEAD && gh pr create --base <base> --head <branch> --title <title> --body <body>
```

2. Otherwise run:

```bash
gh pr create --base <base> --head <branch> --title <title> --body <body>
```

3. Report the URL printed by `gh`.
