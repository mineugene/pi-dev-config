# Issue tracker workflow

Select one provider guide and read only it.

## Provider selection

1. If the project documents a tracker workflow, use it. A local-file tracker is
   a documented workflow and uses [providers/local.md](./providers/local.md).
2. Otherwise run `git remote -v` and select:
   - Azure host (`dev.azure.com`, `*.visualstudio.com`):
     [providers/azure.md](./providers/azure.md).
   - GitHub host (`github.com`): [providers/github.md](./providers/github.md).
   - Forgejo/Gitea host: [providers/tea.md](./providers/tea.md).
3. If two or more different providers match, ask which remote to use.
4. If no supported authenticated CLI exists, keep the draft local, report this,
   and stop.

## Rules

1. Keep issue skills limited to issues. Pull requests are separate resources;
   do not change them from an issue skill.
2. Before every write, local or remote: print the final title and body, then
   wait for user confirmation.
3. Use only labels, tags, areas, iterations, and states that the project already
   defines.
