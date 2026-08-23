---
name: domain-modeling
disable-model-invocation: true
description: "Build and sharpen a project's domain model. Use when resolving codebase terminology, writing or editing GLOSSARY.md, or recording an architectural decision."
---
# Domain Modeling

## Scope

This skill owns resolved domain language and durable decisions. It does not own
feature requirements or implementation.

This skill changes the model. Reading `GLOSSARY.md` for vocabulary alone is not
this skill.

## File structure

Follow [domain-docs.md](../domain-docs.md) to locate the glossary and
architectural decision records. Create a file or directory only when it receives
its first content.

## Procedure

### 1. Challenge the glossary

When a user's term conflicts with an existing `GLOSSARY.md` entry:

1. Quote the existing entry.
2. State the conflict in one sentence.
3. Ask which meaning wins.

Never redefine an established term without that answer.

### 2. Sharpen fuzzy language

When a user's term is vague or overloaded, propose one precise canonical term.
State the candidate meanings, then ask which applies.

### 3. Test the model against scenarios

When the user states a relationship between terms, invent at least one edge-case
scenario that probes the boundary between them. Print the scenario and ask the
user to resolve it.

### 4. Cross-check the model against the code

When the user states how something works, compare it with the code. When they
disagree, quote both and ask which is correct.

### 5. Update GLOSSARY.md

When a domain term is resolved, update the applicable `GLOSSARY.md` immediately,
using [GLOSSARY-FORMAT.md](./GLOSSARY-FORMAT.md). Exclude implementation
details, feature requirements, and general programming terms.

### 6. Offer an ADR

Offer an ADR when all three conditions hold; otherwise continue without one:

1. The decision is hard to reverse.
2. The decision is surprising without context.
3. The decision is the result of a real trade-off.

Use [ADR-FORMAT.md](./ADR-FORMAT.md). Create no ADR until the user accepts the
decision and agrees it is worth recording.

## Output

Report each file written and each term or decision recorded.
