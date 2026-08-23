---
name: to-spec
description: "Turn the current conversation into a specification and publish it after confirmation."
disable-model-invocation: true
---
# To Spec

Synthesise the current conversation and codebase understanding into a
specification, using only what is already agreed.

## Steps

1. Read the relevant code. Follow [domain-docs.md](../domain-docs.md) to find
   the glossary and architectural decision records, and read those covering the
   change.
2. Choose the highest public testing seam that covers the change. Prefer an
   existing seam; otherwise use the highest new seam. Use the fewest seams that
   cover the change, ideally one. Show the chosen seam and ask the user to
   confirm it.
3. Draft `title` and `body` with the template and rules below.
4. Select the provider with [tracker-workflow.md](../tracker-workflow.md) and
   read only the guide it names. Its gate applies to the write.
5. Print `title` and `body`.
6. Publish with the provider guide from step 4.

## Template

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

## Rules

1. Include a numbered user story for every agreed aspect.
2. Write the body per [spec-ticket-bodies.md](../spec-ticket-bodies.md).