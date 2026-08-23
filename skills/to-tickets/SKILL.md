---
name: to-tickets
description: "Split an agreed specification into reviewable vertical-slice issues with explicit blockers, then publish them after confirmation."
argument-hint: "[spec path, issue URL, or issue ID]"
disable-model-invocation: true
---
# To Tickets

Do not reopen settled requirements.

1. If `$ARGUMENTS` gives a specification path, issue ID, or URL, read its body
   and comments. Use its issue ID as the parent when one exists. Otherwise use
   the current conversation without a parent issue.
2. Follow [domain-docs.md](../domain-docs.md) to find the glossary and
   architectural decision records. Use the glossary's terms in every title and
   body.
3. Load `../tickets/SKILL.md`. Partition the specification into vertical slices
   by its slice rules, and identify each slice's blockers by its graph rules.
4. Print a numbered graph: each issue's title, `blocked-by`, delivered behaviour,
   and acceptance criteria. Ask whether the granularity is right, whether every
   `blocked-by` edge genuinely gates its slice, and whether to merge or split any
   slice. Revise until the user approves.
5. Select the provider with [tracker-workflow.md](../tracker-workflow.md) and
   read only the guide it names.
6. Print the final graph and get confirmation before publishing.
7. Publish in dependency order (blockers first) with the provider guide from
   step 5:
   - Local-file tracker: write one file per slice with the local template in
     `../tickets/SKILL.md`, under the path the provider guide defines.
   - Remote tracker: create one issue per slice. When a parent issue exists,
     make each issue its sub-issue.
   - Omit `## Blocked by` when the tracker set native edges.
8. Do not modify the parent issue.
9. Report created IDs, URLs, and every issue with no unfinished blocker (the
   frontier).
