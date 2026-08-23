---
name: to-spec
description: "Turn agreed conversation context into a specification and publish it after confirmation."
disable-model-invocation: true
---

# To Spec

Synthesize what is already agreed. Do not restart the requirements interview.

1. Read relevant code, `CONTEXT.md`, and ADRs.
2. Identify the highest useful public testing seam. Prefer an existing seam and
   confirm any unresolved seam choice with the user.
3. Draft the title and body below. Avoid file paths and implementation snippets
   that will go stale. A short prototype-derived state machine, schema, or
   interface is allowed when it records a decision better than prose.
4. Read [the tracker workflow](../tracker-workflow.md). Show the final issue and
   wait for confirmation before publishing. Report its ID and URL. Apply
   `ready-for-agent` only when project policy defines it.

```markdown
## Problem

<Problem from the user's perspective.>

## Solution

<Agreed user-facing result.>

## User stories

1. As a <role>, I want <capability>, so that <benefit>.

## Decisions

- <Behaviour, interface, architecture, schema, or contract decisions.>

## Testing

- <Public seams and observable behaviours.>

## Out of scope

- <Explicit exclusions.>

## Notes

<Only useful remaining context.>
```
