---
name: spec
description: "Reference for the specification shape. Invoke when writing or editing a specification, or when another skill needs the spec template. Do not invoke merely because the user mentions spec, names a skill, or writes 'skill <word>'."
---
# Spec

Reference for the specification body. The sections are fixed.

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
2. Keep file paths and implementation snippets out of the body.
3. You can include a state machine, schema, or interface from a prototype when
   it records an agreed decision.
4. Use the project's domain terms exactly. Read
   [domain-docs.md](../domain-docs.md) for where the glossary lives.
5. `## Notes` holds only useful remaining context.
