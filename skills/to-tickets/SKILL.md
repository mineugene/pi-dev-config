---
name: to-tickets
description: "Split an agreed specification into reviewable vertical-slice issues with explicit blockers, then publish them after confirmation."
argument-hint: "[spec path, issue URL, or issue ID]"
disable-model-invocation: true
---
# To Tickets

Break the agreed specification into tickets: tracer-bullet vertical slices, each
declaring the tickets that block it.

1. If `$ARGUMENTS` gives a specification path, issue ID, or URL, read its body
   and comments. Use its issue ID as the parent when one exists. Otherwise use
   the current conversation without a parent issue.
2. Follow [domain-docs.md](../domain-docs.md) to find the glossary and
   architectural decision records.
3. Partition the specification into vertical slices by the slice rules below,
   and identify each slice's blockers by the graph rules.
4. Print a numbered graph: each issue's title, `blocked-by`, delivered
   behaviour, and acceptance criteria. Ask whether the granularity is right,
   whether every `blocked-by` edge genuinely gates its slice, and whether to
   merge or split any slice. Revise until the user approves.
5. Select the provider with [tracker-workflow.md](../tracker-workflow.md) and
   read only the guide it names. Its gate applies to the write.
6. Print the final graph.
7. Publish in dependency order (blockers first) with the provider guide from
   step 5:
   - Local-file tracker: write one file per slice with the local ticket template
     below, under the path the provider guide defines.
   - Remote tracker: create one issue per slice. When a parent issue exists,
     make each issue its sub-issue.
   - Omit `## Blocked by` when the tracker set native edges.
8. Do not modify the parent issue.
9. Report created IDs, URLs, and every issue with no unfinished blocker (the
   frontier).

## Vertical slice rules

Each slice needs to:

1. deliver observable behaviour;
2. cross every layer the behaviour affects;
3. fit one fresh agent context;
4. use an existing public seam.

Prefactor first when a cleanup slice makes a feature slice smaller.

## Blocked-by graph

1. List the slices whose output this slice needs under `blocked-by`. Preferred
   order alone is not a blocker.
2. For a refactor that cannot stay green as vertical slices, use three phases in
   this order: expand, migrate in independently green batches, contract.

## Issue body

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

## Local ticket

```markdown
# <NN>: <Ticket title>

**What to build:** <End-to-end behaviour.>

**Blocked by:** <Numbers or titles, or "None (can start immediately)".>

**Status:** <ready-for-agent when the project defines that label>

- [ ] <Observable criterion>
```

Write each body per [spec-ticket-bodies.md](../spec-ticket-bodies.md).