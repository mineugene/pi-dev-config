---
description: Stage and commit the intended work, creating a branch when the current branch is protected.
argument-hint: "[scope, message, or constraints]"
---
# Commit

Inspect the repository in a single shell command before choosing what to
commit:

```sh
git branch --show-current; git config --get commit.gpgsign; git status --short; git diff HEAD
```

User guidance: ${ARGUMENTS:-none}

## Steps

1. If the branch name is empty, stop and report `detached HEAD`. Treat
   `main`, `master`, `dev`, `develop`, and `release/*` branches as
   protected.
   On a protected branch, create a new branch from the current HEAD with
   `git switch -c <name>`, building `<name>` with
   [Branch slug](#branch-slug) from the user guidance when provided or from
   the overall intent in `git diff HEAD` otherwise. On any other branch,
   commit on the current branch.
2. Read relevant untracked files listed in `git status --short`;
   `git diff HEAD` omits their contents.
   Group changes by primary intent so each group forms one atomic commit,
   unless the user guidance requests a single commit. Order prerequisite
   groups first.
   If the user guidance, status, and diff do not establish the intended
   changes or group boundaries, ask the user before staging.
3. For each commit group, write a Conventional Commit message following the
   repository's type and scope policy. When the repository defines no type
   policy, use `feat`, `fix`, `build`, `chore`, `ci`, `docs`, `style`,
   `refactor`, `perf`, and `test`.
   Format the subject as `type(scope): summary` or `type: summary` with a
   lower-case summary. Keep self-explanatory changes to a single subject
   line; otherwise add a concise body.
4. If `commit.gpgsign` is `true`, stop before the first commit and ask the
   user to warm GPG pinentry in their own terminal.
   Wait for explicit confirmation before committing. Do not warm pinentry
   yourself or disable signing.
5. When creating multiple commits, first unstage existing entries across the
   repository with `git restore --staged :/`; this leaves working-tree files
   unchanged.
   For each group in order, stage only that group's files or hunks and
   inspect `git diff --cached` to confirm no other changes are staged.
   Run `git commit -m <subject>` (and `-m <body>` when needed). If a commit
   hook or command fails, stop and report the failure.

## Branch slug

Use `<type>/<slug>` under 50 characters, where `<type>` matches the overall
work. Apply the rules below only to `<slug>`.

1. Lowercase ASCII only: transliterate accents and drop non-ASCII
   characters.
2. Split on non-alphanumeric characters and discard empties.
3. Drop stop words: `a`, `an`, `the`, `of`, `for`, `in`, `on`, `at`, `by`,
   `with`, `and`, `or`, `but`. Keep: `not`, `no`, `without`, `from`, `to`.
4. Start with an imperative verb (`add`, `fix`, `rm`, `bump`), using `rm`
   for removal.
5. Abbreviate words of 6+ characters with a standard CLI, Unix, or code
   shorthand (`config` to `cfg`, `environment` to `env`, `dependencies` to
   `deps`). Spell out colliding words; keep words with no shorthand intact.
6. Join with hyphens.
7. When `<type>/<slug>` is still 50 characters or longer, drop trailing
   words one at a time until it is under 50, keeping `<slug>` non-empty.

## Output

Report the result as a Markdown table, omitting any row with nothing to
report:

| Field | Value |
|:------|:------|
| Branch | `<final-branch>` |
| Base | `<starting-branch-or-HEAD>` (when a new branch was created) |
| Commits | `<hash> <subject>` (one per group) |
| Validation | `<command: result>` |
| Blockers | hook output, signing wait, or failure reason |
