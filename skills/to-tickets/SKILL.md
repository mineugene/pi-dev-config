---
name: to-tickets
description: "Split an agreed specification into reviewable vertical-slice issues with explicit blockers, then publish them after confirmation."
argument-hint: "[spec path, issue URL, or issue ID]"
disable-model-invocation: true
---

# To Tickets

Do not reopen settled requirements.

1. Use the current conversation. If given a specification path, issue ID, or URL,
   read its body and comments. Retain its ID as the parent.
2. Draft vertical slices. Each issue must deliver observable behaviour, cross all
   affected layers, fit one fresh agent context, and use existing public seams.
   Add prerequisite cleanup only when it blocks feature work.
3. Give each issue real blockers. Preferred order alone is not blocking. For a
   wide refactor that cannot stay green as vertical slices, use expand, migrate in
   independently green batches, then contract.
4. Show a numbered graph with each issue's title, blockers, delivered behaviour,
   and acceptance criteria. Revise until approved.
5. Read [the tracker workflow](../tracker-workflow.md). Show the final graph and
   get confirmation before publishing. Create parents and blockers first. Use
   native relations when verified; otherwise put stable references in each body.
   Do not modify the parent specification. Report created IDs, URLs, and the
   frontier of issues with no unfinished blockers.

Issue body:

```markdown
## Parent

<Specification reference; omit when absent.>

## What to build

<End-to-end behaviour.>

## Blocked by

<References, or "None (can start immediately)".>

## Acceptance criteria

- [ ] <Observable criterion>
```

Avoid file paths and code snippets that will stale. A short prototype-derived
state machine, schema, or interface may be included when it records an agreed
decision better than prose.
