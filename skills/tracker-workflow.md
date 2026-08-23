# Issue tracker workflow

Use the project's documented tracker workflow. Otherwise inspect `git remote -v`:

- Azure remote (`dev.azure.com`, `*.visualstudio.com`): use `az`.
- GitHub remote: use `gh`.
- Forgejo/Gitea remote: use `tea`.
- Several matches: ask which remote.
- No supported authenticated CLI: keep the draft local and ask.

Issues and pull requests are separate resources. Never mutate a pull request from
an issue skill. Before any remote write, show the final title and body and get
confirmation. Use only labels, tags, areas, iterations, and states already defined
by the project.

## GitHub

Use `gh issue create`. Create parents and blockers first. Use `--parent` and
`--blocked-by` when supported; otherwise put stable references in the body.

## Azure Boards

Use `az boards work-item create --detect true`. Assume Agile: specifications are
`Feature` work items and implementation slices are `User Story` work items. If a
type is unavailable, query available types and ask for the mapping. Add `Parent`
and `Predecessor` relations only after confirming created IDs. Add
`System.Tags=ready-for-agent` only when project policy defines that tag.

## Forgejo and Gitea

Check `tea issues create --help`, then use its installed syntax. Create blockers
first. Put parent and blocker references in the body unless the server and client
have a verified native relation. Use only existing labels.
