# Azure DevOps

Use for `dev.azure.com` and `*.visualstudio.com`. Push with
`git push -u <remote> HEAD` when needed, then run:

```bash
az repos pr create --source-branch <branch> --target-branch <base> --title <title> --description <body>
```

Use `--detect true`. If remote detection fails, pass `--org`, `--project`, and
`--repository`.

`--description` takes a list, so pass every body line as a separate quoted
value after one flag, with `""` for blank lines. Repeating the flag keeps only
the last value and silently discards the rest of the body.

```bash
az repos pr create --detect true --source-branch <branch> --target-branch <base> \
  --title "<title>" \
  --description "## Summary" "First body line." "" "## Changes" "- First change"
```

After creating or updating, confirm the stored body with
`az repos pr show --id <id> --query description --output tsv`.
