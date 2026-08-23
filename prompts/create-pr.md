---
description: Open a PR with a conventional title and complexity-scaled description
argument-hint: "[feedback, e.g. add a testing section]"
---
<!-- pidev:pr-command -->
Open a PR for the current branch:

1. Inspect `git remote -v`. Use `gh` for `github.com`, `az` for `dev.azure.com`
   or `*.visualstudio.com`, otherwise `tea` (Gitea/Forgejo). With multiple
   remotes, ask which to target. Push to it first if the branch lacks an upstream.
2. Determine `<base>`; review `git log --oneline <base>..HEAD` and
   `git diff <base>...HEAD`.
3. Write a concise, imperative Conventional Commit title:
   `type(scope): summary`.
4. Choose the PR body from the change complexity. Apply this feedback and
   requested sections: $ARGUMENTS

   Tiny:

   ```text
   [1-2 sentences: what changed and why]
   ```

   Small:

   ```markdown
   ## Summary
   [what changed and why]

   ## Changes
   - [bullet per change]
   ```

   Medium or large:

   ```markdown
   ## Summary
   [what changed and why]

   ## Changes
   - [bullet per change]

   ## Testing
   [how verified]
   ```

   For large changes, add more detail to the changes and testing sections; do
   not add headings solely because the change is large.

5. Show the final title and body. Then create the PR. Use the matching CLI flags;
   substitute `<branch>`, `<base>`, title, and body:

    gh pr create --base <base> --head <branch> --title "<title>" --body "<body>"
    az repos pr create --source-branch <branch> --target-branch <base> --title "<title>" --description "<body>"
    tea pull create --head <branch> --base <base> --title "<title>" --description "<body>"

   For Azure, pass one quoted body line per `--description` value (`""` for
   blanks); use `--detect true` or explicit `--org`, `--project`, and `--repository` if
   remote config cannot infer them. For a `tea` fork, use `<user>:<branch>`.
