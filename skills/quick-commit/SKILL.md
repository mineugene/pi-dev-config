---
name: quick-commit
description: Commit the intended changes on the current branch without branch or worktree policy checks.
argument-hint: "Optional commit message or scope"
disable-model-invocation: true
---
# Quick Commit

Commit only the intended changes, on the current branch. Do not create, switch,
rename, rebase, merge, or delete a branch or worktree. Do not push.

## Procedure

1. Run `git branch --show-current`. If the output is empty, stop and report
   `detached HEAD`.
2. Run `git status --short` and `git diff`.
3. Identify the paths changed by the intended work from `$ARGUMENTS` and the
   conversation. If the paths are unclear, ask which to include before staging.
4. Stage exactly those paths with `git add <paths>`.
5. Run `git diff --cached --check` and `git diff --cached`.
   - If `--check` reports an error, stop and report it.
   - If the staged paths differ from the intended paths, correct the staging
     area and repeat this step.
6. If the intended paths include executable code or tests, run the smallest
   existing validation command that covers them. Record its exit code. If no
   such command runs, record `skipped: <reason>`.
7. Use `$ARGUMENTS` as the subject when it is a valid Conventional Commit
   subject. Otherwise derive the subject from the staged diff.
8. Call the `commit` tool with `subject`. Include `body` only when the subject
   does not explain the reason for the change.

## Output

Report the commit hash, subject, current branch name, and validation exit code or
`skipped: <reason>`.
