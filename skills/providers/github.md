# GitHub

Provider for remotes whose host is `github.com`. Uses the `gh` CLI.

1. Create parents and blockers first.
2. Use `gh issue create`.
3. Use `--parent` and `--blocked-by` when `gh issue create --help` lists them.
   When a parent issue exists, make each issue its sub-issue; otherwise put
   stable references in each `## Blocked by` body.
4. Omit `## Blocked by` when `gh` set a native edge.
5. Apply `ready-for-agent` only when project policy defines that label.
