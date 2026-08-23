# Azure Boards

Provider for Azure DevOps remotes (`dev.azure.com`, `*.visualstudio.com`).

1. Use `az boards work-item create --detect true`.
2. Default mapping: specifications are `Feature` work items; implementation
   slices are `User Story` work items.
3. If a mapped type is unavailable, query the available types and ask the user
   for a replacement mapping before creating anything.
4. Add `Parent` and `Predecessor` relations only after the related IDs exist.
5. Add `System.Tags=ready-for-agent` only when project policy defines that tag.
