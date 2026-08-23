---
name: quick-commit
description: Commit the intended changes on the current branch without branch or worktree policy checks.
argument-hint: "Optional commit message or scope"
disable-model-invocation: true
---

Commit on the branch currently checked out. Do not create, switch, rebase, merge, or delete branches or worktrees.

1. Confirm `HEAD` is attached to a branch with `git branch --show-current`; stop if it is detached.
2. Inspect `git status --short` and `git diff`. Determine the intended changes from the conversation and the optional argument. Do not include unrelated changes.
3. Stage only the intended files. Inspect `git diff --cached --check` and `git diff --cached`.
4. Run the smallest relevant existing validation when the staged changes contain executable code or tests. State if validation cannot run or is unnecessary.
5. Write a concise Conventional Commits message. Use the optional argument when it supplies one; otherwise derive it from the staged diff.
6. Commit the staged changes with the `commit` tool. Report the commit hash, subject, current branch, and validation result.

Do not push unless the user asks.
