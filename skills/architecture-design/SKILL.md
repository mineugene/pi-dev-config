---
name: architecture-design
disable-model-invocation: true
description: "Design or reshape architecture for a feature, subsystem, API, or refactor while preserving repository philosophy. Invoke when the user asks to design architecture or a subsystem, decide module boundaries or dependency direction, design an API, plan a refactor, decide responsibility ownership, or introduce or remove an architectural boundary. Do not invoke merely because the user mentions architecture-design, names a skill, or writes 'skill <word>'."
---
# Architecture Design

## Contents

- **Read scope** - how to consume this skill when a read is truncated.
- **Objective** - minimise system complexity and increase locality of change;
  cross-language scope.
- **Priority order** - the 10-point precedence order; a lower number wins.
- **Prohibited designs** - designs to avoid.
- **Explore before proposing** - what to inspect, and when to load the grilling
  interview.
- **Boundaries** - domain/application/infrastructure/adapter roles and the seven
  boundary conditions.
- **Dependency direction** - where dependencies point.
- **SOLID** - diagnostics, not goals.
- **Semantic DRY** - when to share versus duplicate.
- **Method arguments and data shapes** - request/options structures, including
  Cancellation, Lightweight representations, and API ergonomics.
- **Output** - the nine-part design output order.
- **Skill boundaries** - when to load review, code-review, domain-modeling, or
  tdd.

## Read scope

Read this entire skill, including every section listed in Contents, before
applying it. If a read is truncated, continue from the next unread line until
the end.

## Objective

Design architecture that minimises total system complexity and increases
locality of change. Preserve the repository's existing architectural philosophy.
Do not design a feature in isolation and do not apply a pattern because the
pattern exists.

Design across C#, ASP.NET, C++, Rust, Go, and TypeScript, respecting each
repository's conventions.

## Priority order

Apply in this order; a lower number wins a conflict:

1. Requirements and correctness.
2. Repository conventions and existing architecture.
3. Domain and application boundaries that provide value (see "Boundaries").
4. Cohesive, deep modules with small interfaces.
5. Locality of change.
6. Dependency direction (see "Dependency direction").
7. Explicit designs.
8. SOLID as diagnostic guidance.
9. Clean Architecture, Hexagonal, or Ports and Adapters as guides when a
   boundary benefits from them.
10. DRY as guidance when two concepts are genuinely the same.

## Prohibited designs

Do not produce any of:

- Interface-per-class or repository-per-entity.
- Service or manager classes that only delegate.
- Mandatory `Controller`, `Service`, `Repository` layering.
- Ceremonial Clean Architecture layers.
- Speculative extension points or abstract factories with no variability.
- Abstractions created only to satisfy SOLID.
- DRY abstractions that couple concepts with different reasons to change.
- DTOs whose only purpose is renaming another object.
- Inheritance used primarily for code reuse.
- Splitting cohesive code into multiple tiny modules.
- A domain layer with no independent behaviour and no boundary.

## Explore before proposing

1. Read applicable `AGENTS.md` instructions and architectural documentation.
2. Inspect the feature, its callers, and neighbouring modules.
3. Identify the current dependency direction.
4. Identify existing domain, application, infrastructure, and adapter
   boundaries.
5. Find existing abstractions that already solve part of the problem.
6. Identify the authoritative owner of each state and behaviour.
7. Read existing tests and established seams.
8. Extend an existing architectural boundary instead of adding a competing one.

Investigate these facts yourself. If a user-owned requirement or constraint is
still unresolved, load `../grill-with-docs/SKILL.md` and run its interview
before implementation.

## Boundaries

These four are conceptual roles, not mandatory directories:

- **Domain**: business concepts, rules, invariants, and behaviour. Must not
  depend on infrastructure for infrastructure's sake.
- **Application**: use cases and orchestration. Coordinates domain behaviour and
  external capabilities.
- **Infrastructure**: databases, HTTP clients, filesystems, queues, OS APIs,
  frameworks, external services, and other mechanisms.
- **Adapters / transport / presentation**: controllers, CLI handlers, Pi hooks,
  HTTP endpoints, UI integration, and message handlers.

Introduce a boundary only when it provides at least one of these benefits:

1. It gives a useful dependency direction.
2. It enables a test.
3. It isolates a volatile dependency.
4. It establishes one authoritative owner of each state and behaviour.
5. It makes a dependency replaceable.
6. It improves locality of change.
7. It marks a real domain or application boundary.

For ASP.NET, do not create `Controller`, `Service`, `Repository`, `IRepository`,
`UnitOfWork`, `DbContext` layering by default. Evaluate each boundary against
the list above. A framework or ORM that already provides the capability needs no
wrapper that only renames it.

## Dependency direction

- Dependencies point toward stable concepts and useful boundaries.
- Do not make domain depend on infrastructure.
- Do not couple application logic to transport or framework concerns.
- Do not create an abstraction whose only purpose is to reverse a harmless
  dependency.

## SOLID

Use these heuristics as diagnostics, not requirements or goals. They do not
outweigh the priorities above:

- **SRP**: multiple independent reasons to change. Not class size, and not one
  method per class.
- **OCP**: an extension point for a real axis of variation. Not a speculative
  plugin system.
- **LSP**: an implementation must preserve its abstraction's behavioural
  contract. Use composition when inheritance produces surprising semantics.
- **ISP**: a focused interface when consumers need different capabilities. Do
  not create an interface for every concrete class.
- **DIP**: reverse a dependency when it improves direction, testability, or
  isolation. Do not add an interface only to mock a concrete class.

## Semantic DRY

Share an abstraction when the behaviour represents the same concept, invariant,
or policy and the concepts change together. Allow duplication when the code only
looks similar, when concepts change for different reasons, when combining them
couples unrelated features, or when the abstraction needs configuration or
conditionals. Choose duplication over a wrong abstraction.

## Method arguments and data shapes

Use a request/value/options structure when at least one condition holds:

1. The parameters always travel together or form one operation.
2. The call site is hard to read.
3. Several parameters have the same primitive type.
4. Property discoverability helps callers.
5. The parameters evolve together.
6. The parameters form one domain or application concept.

Prefer a request structure over a long parameter list when the conditions
hold. Replace `CreateUser(name, email, timezone, locale, role)` with:

```csharp
CreateUser(CreateUserRequest request, CancellationToken cancellationToken = default)
```
Grouping must add semantic value beyond reducing the parameter count. Do not
move an unrelated long parameter list into one object.

### Cancellation

- Business or application data belongs in the request or value object.
- Configuration belongs in the options structure.
- Execution and control flow belongs in separate parameters such as
  `CancellationToken`.

Do not put `CancellationToken` in a request, command, options, or data structure
because other parameters were grouped. Automated refactoring must not move every
argument into the new structure.

Prefer a separate `CancellationToken` parameter over a token inside the
request:

```csharp
ExecuteAsync(ExecuteRequest request, CancellationToken cancellationToken = default)
```

Propagate caller cancellation across asynchronous boundaries. Do not create,
replace, ignore, or swallow caller cancellation.

### Lightweight representations

- **C#**: `record struct` or `readonly record struct` for small value types;
  `record` or class when reference semantics, identity, inheritance, mutability,
  or framework integration applies.
- **C++**: `struct` for aggregates that hold only data, and for value-like data;
  preserve RAII and ownership.
- **Rust**: `struct` for cohesive data and domain types; use domain types over
  primitive-heavy APIs.
- **Go**: `struct` for cohesive request, options, and domain data; do not
  convert every function into a method.
- **TypeScript**: `type`, `interface`, or object shapes per repository
  convention and semantics.

### API ergonomics

As a design check, evaluate property names, primitive ambiguity, boolean flags,
nullability, defaults, invalid states, async semantics, cancellation semantics,
future evolution, and call-site readability. Use a file plus named
`ProcessOptions` over `Process(file, true, false, true)` when the flags are
independent meaningful choices. Do not bundle unrelated values to shorten a
signature.

## Output

Provide, in this order:

1. Current architecture and constraints, grounded in inspected sources.
2. The main architectural problem.
3. Proposed boundaries.
4. Dependency direction.
5. Owner of each state and behaviour.
6. Each important abstraction and why it exists.
7. API and data-shape decisions, including execution control.
8. Trade-offs and alternatives, including the simplest viable option.
9. A migration or implementation sequence when changing existing architecture.

A design request does not authorise implementation.

## Skill boundaries

- This skill owns new architecture, boundaries, APIs and data shapes, and
  architectural change planning.
- Load `../architecture-review/SKILL.md` when the user asks to evaluate an
  existing architecture, a proposed design, or an architectural change.
- Load `../code-review/SKILL.md` for standards, specification compliance,
  general code smells, and diff-level review.
- Load `../domain-modeling/SKILL.md` when resolving domain terminology,
  conceptual models, conflicting terms, or context and ADR decisions.
- Load `../tdd/SKILL.md` for explicit test-first or integration-test requests.
