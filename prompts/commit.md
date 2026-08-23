---
description: Stage and commit the intended work with a Conventional Commit message, creating a branch when the current branch is protected (interactive signing)
argument-hint: "[branch name, subject, body, grouping, type, or scope]"
---
# Commit

Use `$ARGUMENTS` for the user's branch, message, grouping, type, and scope
preferences. Inspect `git branch --show-current`, `git status --short`, and
`git diff` before choosing what to commit.

## 1. Check allowed types

1. Read the repository's commit-message validator or configuration to find its
   allowed Conventional Commit types. If it uses Convco, run `convco config`
   and read `types`.
2. When the repository defines no type policy, use `feat`, `fix`, `build`,
   `chore`, `ci`, `docs`, `style`, `refactor`, `perf`, and `test`.
3. Use only an allowed type. If the user requests another type, show the allowed
   types and ask them to choose before continuing. Do not substitute a type.

## 2. Choose the message

1. Choose the allowed type that matches the diff, unless the user names an
   allowed type.
2. Use a noun naming the affected module as the scope, or omit the scope.
3. Write an imperative, lower-case summary with no trailing period.
4. Format the subject as `type(scope): summary`, or `type: summary` without a
   scope. Use a user-supplied subject when its type is allowed.

## 3. Choose the branch

If the branch name is empty, stop and report `detached HEAD`.

Treat `main`, `master`, `dev`, `develop`, and every `release/*` branch as
protected. On a protected branch:

1. Use the branch name from the user's arguments when
   `git check-ref-format --branch <name>` accepts it. Create it with
   `git checkout -b <name>`.
2. Otherwise create `<type>/<slug>` with `git checkout -b <type>/<slug>`, using
   the summary to build the slug as described below.

On any other branch, stay on that branch. Do not run `git checkout`,
`git switch`, `git rebase`, `git merge`, or `git branch -d`.

### Branch slug

1. Lower-case the summary.
2. Split it into words at every character that is neither a letter nor a digit.
3. Abbreviate every word that has a standard CLI, Unix, or code-identifier
   shorthand (`rm`, `bg`, `deps`, `cfg`, `env`, `doc`). Leave a word full only
   when it is already short or has no recognisable shorthand.
4. Remove `the`, `a`, `an`, `of`, `to`, `for`, `and`, `or`, `in`, `on`, and
   `with`. Keep the other words.
5. Join the words with hyphens. Drop whole trailing words until the slug is at
   most 36 characters, and remove any leading or trailing hyphen.

## 4. Group and stage the work

1. Follow the user's grouping when supplied. Otherwise group changes by primary
   intent: each group implements one intent. Put prerequisites first.
2. Stage only the files for the current group with `git add <paths>` or
   `git add -p`.
3. If the arguments, status, and diff do not establish the intended changes or
   group boundaries, ask before staging.

## 5. Commit each group

For each group in order:

1. Write a subject and optional body describing that group. Include a body only
   when the subject does not explain the reason for the change. Explain the
   reason rather than restating the diff.
2. Recheck that the subject uses an allowed type.
3. Call the `commit` tool with `subject` and `body`. Use this tool for GPG
   pinentry and YubiKey touch; never run `git commit` in Bash.

## Output

Report each commit hash and subject, the final branch name, and the result of
every validation command run.
