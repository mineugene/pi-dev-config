---
name: tickets
description: "Reference for the issue shape and the blocked-by graph. Invoke when writing or editing tickets, or when another skill needs the ticket templates or vertical-slice rules. Do not invoke merely because the user mentions tickets, names a skill, or writes 'skill <word>'."
---
# Tickets

Reference for one ticket. A ticket is a tracer bullet: a narrow but complete
vertical slice through every layer.

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

**Status:** ready-for-agent

- [ ] <Observable criterion>
```

Keep file paths and code snippets that change with the implementation out of the
body. You can include a state machine, schema, or interface from a prototype
when it records an agreed decision.
