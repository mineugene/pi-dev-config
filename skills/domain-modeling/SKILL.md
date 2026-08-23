---
name: domain-modeling
description: "Build and sharpen a project's domain model. Use when resolving codebase terminology, writing or editing CONTEXT.md, or recording an architectural decision."
---

# Domain Modeling

Build and sharpen the project's domain model while designing. Challenge ambiguous
or conflicting terms, invent edge cases that expose weak definitions, and record
resolved language and durable decisions when they crystallize.

## File structure

Most repositories use one root `CONTEXT.md` and `docs/adr/`. If a root
`CONTEXT-MAP.md` exists, follow it to the relevant context and its ADR directory.
Create files and directories lazily, only when there is something worth recording.

### Challenge the glossary

When the user's term conflicts with an existing `CONTEXT.md`, call out the exact
conflict and ask which meaning should win. Do not silently redefine established
language.

### Update CONTEXT.md

When a domain term is resolved, update the applicable `CONTEXT.md` immediately
using [CONTEXT-FORMAT.md](./CONTEXT-FORMAT.md). Keep implementation details,
feature requirements, and general programming terms out of the glossary.

### Offer ADRs sparingly

Offer an ADR only when the decision is all three:

1. Hard to reverse.
2. Surprising without context.
3. The result of a real trade-off.

Use [ADR-FORMAT.md](./ADR-FORMAT.md). Do not create an ADR until the user accepts
the decision and agrees it is worth recording.
