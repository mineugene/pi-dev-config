---
name: create-pr
description: "Create a pull request from the current branch with a conventional title and concise body."
argument-hint: "[feedback on target, base, title, type, scope, body, or sections]"
disable-model-invocation: true
---

<!-- pidev:create-pr-skill -->
Create a pull request. Never merge it.

Treat the optional argument as user preference. Honour valid requests for the
target, base, title, Conventional Commit type or scope, body, and sections. Ask
only when feedback conflicts with the diff or leaves a required choice unclear.

1. Run `git remote -v`. Select one provider and read only its guide:
   - GitHub: [providers/github.md](./providers/github.md)
   - Azure DevOps: [providers/azure.md](./providers/azure.md)
   - Forgejo/Gitea: [providers/tea.md](./providers/tea.md)
   Ask when several remotes qualify.
2. Find the base branch. Review `git log --oneline <base>..HEAD` and
   `git diff <base>...HEAD`.
3. Write an accurate `type(scope): summary` title. Keep the body proportional:
   - Tiny: one or two sentences stating what changed and why.
   - Larger: `## Summary`, `## Changes`, and `## Testing` when useful.
4. Show target, base, title, and body. Wait for confirmation. Push only if the
   branch lacks an upstream, then create the pull request with the provider guide.
