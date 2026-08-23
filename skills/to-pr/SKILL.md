---
name: to-pr
description: "Create a pull request from the current branch after rendering its title and body for review."
argument-hint: "[target, base, title, type, scope, body, or sections]"
disable-model-invocation: true
---
<!-- pidev:to-pr-skill -->
# To PR

Never merge the pull request.

## Inputs and preferences

Read `$ARGUMENTS` for the user's target, base, title, type, scope, body, and
section preferences. Run `git remote -v` to identify the available remotes.

Use explicit user values first, and derive missing values through the steps
below. If an argument conflicts with the diff or a required value cannot be
determined, ask before continuing.

## Steps

1. Select one provider from the remotes and read only its guide:
   - `github.com`: [providers/github.md](./providers/github.md).
   - `dev.azure.com` or `*.visualstudio.com`:
     [providers/azure.md](./providers/azure.md).
   - Forgejo/Gitea: [providers/tea.md](./providers/tea.md).
   If two different providers match, ask which remote to use before continuing.
2. Use the base branch from the arguments, or the remote's default branch when
   none is supplied. Ask if neither is known. Run
   `git log --oneline <base>..HEAD` and `git diff <base>...HEAD`.
3. Write a Conventional Commit title in the form `type(scope): summary`, using
   the repository's allowed types resolved by the same rule as `/commit`. Use
   the user's title when it is valid.
4. Use the user's body when it is valid. Otherwise load `../pr/SKILL.md` and
   write the body using its template and rules.
5. Show the title and body in fenced code blocks as specified in "Review output".
   Wait for user confirmation.
6. Create the pull request with the selected provider guide. When `HEAD` has no
   upstream, the guide runs the push and creation in one command so one approval
   covers both and the PR guard sees the sentinel before either action runs.

## Review output

Print these blocks in order, with no extra prose:

```text
<title>
```

```markdown
<body>
```

## Output

Report the pull request URL, its base branch, and its title.
