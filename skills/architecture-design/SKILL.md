---
name: architecture-design
description: "Design or reshape architecture for a feature, subsystem, API, or significant refactor while preserving repository philosophy. Invoke when the user asks to design architecture or a subsystem, decide module boundaries or dependency direction, design an API, plan a significant refactor, decide responsibility ownership, or introduce or remove an architectural boundary. Do not invoke merely because the user mentions architecture-design, names a skill, or writes 'skill <word>'."
---

# Architecture Design

## Content outline

This outline is navigation, not a substitute for the instructions. Read the entire skill, including all sections below line 100, before applying it. If a read is truncated, continue from the next unread line until the end.

- [Priorities](#priorities): ordered design goals and patterns to avoid.
- [Explore before proposing](#explore-before-proposing): repository evidence, callers, ownership, tests, and unresolved requirements.
- [Useful boundaries, not mandatory layers](#useful-boundaries-not-mandatory-layers): domain, application, infrastructure, adapters, and ASP.NET layering.
- [SOLID as diagnostic heuristics](#solid-as-diagnostic-heuristics): practical SRP, OCP, LSP, ISP, and DIP.
- [Semantic DRY](#semantic-dry): share concepts that change together; allow unrelated duplication.
- [Method arguments and data shapes](#method-arguments-and-data-shapes): cohesive request/value/options structures and examples.
  - [Cancellation is execution control](#cancellation-is-execution-control): separate tokens from data and propagate caller cancellation.
  - [Natural lightweight representations](#natural-lightweight-representations): C#, C++, Rust, Go, and TypeScript.
  - [API ergonomics](#api-ergonomics): discoverability, invalid states, defaults, async behaviour, and call-site readability.
- [Output](#output): required design report, trade-offs, migration sequence, and implementation authorisation.
- [Skill boundaries](#skill-boundaries): design, architecture review, code review, domain modeling, and TDD responsibilities.

Design constructively and forward-looking. Work across C#, ASP.NET, C++, Rust,
Go, and TypeScript. Preserve the repository's existing architectural philosophy;
do not design a feature in isolation or mechanically apply architectural patterns.

The primary question is:

> Does this design reduce total system complexity and make future changes more local?

## Priorities

Use this order:

1. Requirements and correctness.
2. Repository conventions and existing architecture.
3. Clear domain/application boundaries where they provide value.
4. Cohesive, deep modules with small, useful interfaces.
5. High locality of change.
6. Appropriate dependency direction.
7. Simple and explicit designs.
8. SOLID as design heuristics.
9. Clean Architecture / Hexagonal / Ports & Adapters where a real boundary benefits from them.
10. DRY when the concepts are genuinely the same.

Avoid:

- Interface-per-class and repository-per-entity.
- Service/manager classes that merely delegate.
- Mandatory Controller → Service → Repository layering.
- Ceremonial Clean Architecture layers.
- Speculative extension points and abstract factories without meaningful variability.
- Abstractions created solely to satisfy SOLID.
- DRY abstractions that couple concepts with different reasons to change.
- DTOs whose only purpose is renaming another object.
- Inheritance used primarily for code reuse.
- Splitting cohesive code into many tiny modules.
- Introducing a domain layer without meaningful independent behaviour or a boundary.

## Explore before proposing

1. Read applicable `AGENTS.md` instructions and architectural documentation.
2. Inspect the relevant feature, its callers, and neighbouring modules.
3. Identify the current dependency direction.
4. Identify existing domain, application, infrastructure, and adapter boundaries.
5. Find existing abstractions that already solve part of the problem.
6. Identify authoritative owners of state and behaviour.
7. Check existing tests and established seams.
8. Prefer extending an existing architectural boundary over introducing a competing one.

Investigate repository facts yourself. If material user-owned requirements or
constraints remain unresolved, load `../grill-with-docs/SKILL.md` and follow its
interview and confirmation workflow before implementation.

## Useful boundaries, not mandatory layers

Use Clean Architecture selectively. These are conceptual boundaries, not
mandatory directories:

- **Domain**: business concepts, rules, invariants, and behaviour. It should not
  depend on infrastructure merely because infrastructure exists.
- **Application**: use cases and application-level orchestration. Coordinates
  domain behaviour and external capabilities.
- **Infrastructure**: databases, HTTP clients, filesystems, queues, OS APIs,
  frameworks, external services, and other mechanisms.
- **Adapters / transport / presentation**: controllers, CLI handlers, Pi hooks,
  HTTP endpoints, UI integration, message handlers, and other integration points.

Introduce a boundary only for practical value: useful dependency direction,
testability, isolation from a volatile dependency, clear ownership,
replaceability, better locality of change, or a meaningful domain/application
boundary. Do not add a layer because a diagram contains it.

For ASP.NET, do not automatically create:

`Controller → Service → Repository → IRepository → UnitOfWork → DbContext`

Evaluate whether each boundary provides actual value. A framework or ORM may
already provide the needed capability; a wrapper must hide meaningful complexity
rather than rename it.

## SOLID as diagnostic heuristics

- **SRP**: look for multiple independent reasons to change. It does not mean
  one method per class or that classes must be tiny.
- **OCP**: introduce extension points for a real axis of variation, not a
  speculative plugin system.
- **LSP**: implementations must preserve their abstraction's behavioural
  contract. Prefer composition when inheritance would produce surprising semantics.
- **ISP**: keep interfaces focused when consumers genuinely need different
  capabilities. Do not create an interface for every concrete class.
- **DIP**: reverse dependencies when it improves architectural direction,
  testability, or isolation. Do not add interfaces solely to mock concrete classes.

## Semantic DRY

Share an abstraction when behaviour represents the same concept, invariant, or
policy, and the concepts should change together.

Allow duplication when code merely looks similar, concepts have different reasons
to change, combining them couples unrelated features, or the abstraction needs
awkward configuration or conditionals. Prefer duplication over a wrong abstraction.

## Method arguments and data shapes

Consider a request/value/options structure when parameters form one coherent
conceptual input. Good candidates:

- Always travel together or represent one meaningful operation.
- Are difficult to understand at call sites.
- Contain several similarly typed primitives.
- Benefit from IntelliSense/property discoverability.
- Are likely to evolve together.
- Represent a meaningful domain/application concept.

Instead of:

```csharp
CreateUser(name, email, timezone, locale, role)
```

consider:

```csharp
CreateUser(CreateUserRequest request, CancellationToken cancellationToken = default)
```

`CreateUserRequest` contains the business/application data: `Name`, `Email`,
`Timezone`, `Locale`, and `Role`. Grouping must have semantic value, not merely
reduce the visible parameter count. Avoid giant parameter objects that move an
unrelated long parameter list elsewhere.

### Cancellation is execution control

Separate these categories:

- Business/application data → request/value object.
- Configuration/options → options structure.
- Execution/control flow → separate parameters such as `CancellationToken`.

Do not put `CancellationToken` into request, command, options, or data structures
merely because other parameters have been grouped. Automated refactoring must
not mechanically move every argument into the new structure.

Prefer:

```csharp
ExecuteAsync(ExecuteRequest request, CancellationToken cancellationToken = default)
```

not `ExecuteAsync(ExecuteRequest request)` where `ExecuteRequest` contains the
token. Propagate caller cancellation through asynchronous boundaries. Do not
silently create, replace, ignore, or swallow caller cancellation.

### Natural lightweight representations

- **C#**: `readonly record struct` / `record struct` for appropriate small value
  types; `record` or class when reference semantics, identity, inheritance,
  mutability, or framework integration matters.
- **C++**: `struct` for simple aggregates/value-like data. Preserve RAII and
  ownership semantics.
- **Rust**: `struct` for cohesive data and domain types. Prefer explicit domain
  types over primitive-heavy APIs.
- **Go**: `struct` for cohesive request/options/domain data. Do not turn every
  function into a method on a struct merely for abstraction.
- **TypeScript**: `type`, `interface`, or object shapes according to repository
  conventions and semantic needs.

### API ergonomics

Evaluate IntelliSense/discoverability, meaningful property names, primitive
ambiguity, boolean flags, nullability, defaults, invalid states, async semantics,
cancellation semantics, future API evolution, and call-site readability.

Prefer a file plus named `ProcessOptions` over `Process(file, true, false, true)`
when flags represent meaningful independent choices. Use the language's native
construction syntax; do not bundle unrelated values to make a signature shorter.

## Output

Provide:

1. Current architecture and relevant constraints, grounded in inspected sources.
2. The main architectural problem.
3. Proposed boundaries.
4. Dependency direction.
5. Ownership of state and behaviour.
6. Important abstractions and why each exists.
7. API/data-shape decisions, including execution control where relevant.
8. Trade-offs and alternatives, including a simpler option where viable.
9. A migration/implementation sequence when changing existing architecture.

Prefer the smallest design that solves the actual problem. A design request does
not by itself authorise implementation.

## Skill boundaries

- This skill owns new architecture, boundaries, APIs/data shapes, and architectural
  change planning.
- Load `../architecture-review/SKILL.md` when the user asks to critically evaluate
  an existing architecture, proposed design, or architectural change.
- `../code-review/SKILL.md` owns standards, specification compliance, general code
  smells, and diff-level implementation review; load it for its documented review intent.
- Load `../domain-modeling/SKILL.md` when resolving domain terminology, conceptual
  models, ambiguous/conflicting terms, or context and ADR decisions. Do not create
  context documents or ADRs merely to document routine design work.
- Load `../tdd/SKILL.md` for explicit test-first or integration-test requests. It
  owns behavioural seams, test quality, and the red → green → refactor workflow.
  Do not reproduce that workflow here.

Prefer simple architecture with strong boundaries and deep, cohesive modules over
elaborate architecture with many shallow abstractions. Clean Architecture, SOLID,
and DRY are tools for that goal, not goals in themselves.
