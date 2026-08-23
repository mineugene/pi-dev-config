---
description: Branch if needed, then commit with a conventional message (interactive signing)
argument-hint: "[extra guidance]"
---
Commit current work:

1. Check `git branch --show-current`. On `main`, `master`, `dev`, `develop`, or
   `release/*`, first run `git checkout -b <type>/<short-name>`; otherwise stay.
   Use a fitting conventional type (`feat`, `fix`, `chore`, `refactor`, `docs`,
   `test`, `perf`, etc.) and clear abbreviations: `fix/auth-timeout`, not
   `feat/user-profile-import-from-csv`.
2. Inspect `git status` and the unstaged diff. When the unstaged work contains
   separate reviewable changes, plan multiple small, independently understandable
   commits. Commit prerequisites before dependants. Use `git add <paths>` or
   `git add -p` to stage one atomic change at a time; do not stage unrelated
   changes. Ask before splitting when the intended boundaries are unclear.
3. For a single obvious change, stage only its intended files with `git add ...`.
   If no intended change is obvious, ask what to include.
4. Give every commit a `type(scope): summary`: imperative, lower-case, no trailing
   period. Add a body only when needed; state essential why, not the diff.
5. After each atomic staging step, call `commit` with that commit's subject and,
   if needed, body. Reinspect the remaining diff and repeat until done. Never run
   `git commit` in bash: `commit` supports GPG pinentry and YubiKey touch.

Guidance (may be empty): $ARGUMENTS
