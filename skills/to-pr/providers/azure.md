# Azure DevOps

Provider for remotes whose host is `dev.azure.com` or `*.visualstudio.com`.

1. Build the create command:

```bash
az repos pr create --detect true --source-branch <branch> --target-branch <base> \
  --title "<title>" \
  --description "## Summary" "First body line." "" "## Changes" "- First change"
```

2. `--description` consumes a list. Pass every body line as one argument, in
   order, and pass `""` for each blank line. Pass the flag exactly once: a
   repeated `--description` keeps only its last value and discards the rest of
   the body.
3. When `HEAD` has no upstream, prepend `git push -u <remote> HEAD && ` to the
   create command so the push and the pull request run as one command under one
   approval.
4. If the create fails because remote detection failed, rerun with
   `--org <org>`, `--project <project>`, and `--repository <repository>`.
5. Run `az repos pr show --id <id> --query description --output tsv`.
   - If the output equals `body`, continue.
   - Otherwise report the difference and stop.
