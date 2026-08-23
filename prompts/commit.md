---
description: Branch if needed, then commit with a conventional message (interactive signing)
argument-hint: "[feedback on branch, message, split, type, or scope]"
---
Commit current work.

Feedback (may be empty): $ARGUMENTS

Treat the feedback as the user's preferences for this run. It may specify an exact
or suggested branch name, commit subject or body, commit grouping, Conventional
Commit type, or scope. Follow it when it fits the diff and repository safety. Ask
when it conflicts with the changes or leaves an important boundary unclear; do
not silently replace it with an inferred preference.

1. Determine the repository's allowed Conventional Commit types before choosing
   a branch or subject type. Prefer its commit-message validator or configuration;
   when it uses Convco, run `convco config` and read the `types` entries. If no
   repository policy exists, use `feat`, `fix`, `build`, `chore`, `ci`, `docs`,
   `style`, `refactor`, `perf`, or `test`. Verify every chosen type against that
   list. If feedback requests an invalid type, show the valid types and ask the
   user to choose one; do not silently substitute it or let the hook reject it.
2. Check `git branch --show-current`. On `main`, `master`, `dev`, `develop`, or
   `release/*`, first run `git checkout -b <type>/<short-name>`; otherwise stay.
   Use the requested branch name or valid conventional type when supplied.
   Otherwise, infer a fitting valid type. Keep a generated name short and
   recognizable. Remove redundant words and use familiar abbreviations where
   they stay clear, such as `auth`, `config`, or `deps`; do not abbreviate
   unfamiliar terms into ambiguity.
3. Inspect `git status` and the unstaged diff. Apply any requested commit grouping.
   Otherwise, when the work contains separate reviewable changes, plan multiple
   small, independently understandable commits. Commit prerequisites before
   dependants. Use `git add <paths>` or `git add -p` to stage one atomic change at
   a time; do not stage unrelated changes. Ask before splitting when the intended
   boundaries are unclear.
4. For a single obvious change, stage only its intended files with `git add ...`.
   If no intended change is obvious, ask what to include.
5. Give every commit a `type(scope): summary`: imperative, lower-case, no trailing
   period. Honour a requested type, scope, subject, or body when it is accurate
   and valid. Recheck the subject's type against the allowed types before calling
   `commit`. Add a body only when needed; state essential why, not the diff.
6. After each atomic staging step, call `commit` with that commit's subject and,
   if needed, body. Reinspect the remaining diff and repeat until done. Never run
   `git commit` in bash: `commit` supports GPG pinentry and YubiKey touch.
