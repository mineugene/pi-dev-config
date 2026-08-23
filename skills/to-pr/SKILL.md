---
name: to-pr
description: "Create a pull request from the current branch."
argument-hint: "[target, base, title, type, scope, or body]"
disable-model-invocation: true
---
<!-- pidev:to-pr-skill -->
# To PR

Create the pull request from the current branch and leave it open for review.
Never merge it.

Inspect the repository in a single shell command before choosing what to send:

```sh
git remote -v; git branch --show-current; git status --short; git log --oneline -5
```

User guidance: ${ARGUMENTS:-none}

Use the user's values first, and ask before continuing when the guidance, the
remotes, and the diff leave a value open.

## Steps

1. Select the provider for the target remote and read only its guide:
   - `github.com`: [providers/github.md](./providers/github.md).
   - `dev.azure.com` or `*.visualstudio.com`:
     [providers/azure.md](./providers/azure.md).
   - Forgejo/Gitea: [providers/tea.md](./providers/tea.md).
2. Set the base to the user's value or the remote's default branch, then run
   `git log --oneline <base>..HEAD` and `git diff <base>...HEAD`.
3. Write the title as `type(scope): summary`, resolving types the same way as
   `/commit`.
4. Write the body with the sections below unless the user supplied one.
5. Create the pull request with the provider guide. When `HEAD` has no upstream,
   the guide runs the push and creation in one command so one approval covers
   both and the PR guard sees the sentinel before either action runs.

## Body

The size of the change selects the sections. Choose the first matching size:

1. **Large**: touches more than one subsystem, or changes a public interface.
2. **Medium**: changes more than two files, or 20+ lines of observable
   behaviour.
3. **Small**: changes more than one file, or any observable behaviour.
4. **Tiny**: none of the above.

Render the sections for the size, in this order:

- tiny: `Summary`.
- small: `Summary`, `Changes`.
- medium: `Summary`, `Changes`, `Testing`.
- large: `Summary`, `Changes`, `Validation`, `Testing`.

```markdown
## Summary

<visual>

## Changes

- <change>

## Validation

- **Before:** <before>
  **After:** <after>

## Testing

<command and result>
```

**Summary** shows the smallest view that makes the change clear: pseudocode for
logic, a call tree for control flow, a component tree for UI, a file tree for
responsibility, a Mermaid diagram for interaction, or a `diff` for what changes.
Keep only the parts the reader needs.

**Changes** lists each change, adding reversibility and impact scope when the
change is hard to revert or reaches other consumers.

**Testing** names the command run and its result. **Validation** shows captured
execution output, or a screenshot for a visual change.

Use the project's domain terms exactly. Read
[domain-docs.md](../domain-docs.md) to locate the glossary.

## Output

Report the result as a Markdown table, omitting any row with nothing to report:

| Field | Value |
|:------|:------|
| Link | `<url>` |
| Source branch | `<source>` |
| Target branch | `<target>` |
| Title | `<title>` |
| Blockers | failure reason |
