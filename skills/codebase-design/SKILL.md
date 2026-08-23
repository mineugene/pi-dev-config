---
name: codebase-design
disable-model-invocation: true
description: "Shared vocabulary for designing deep modules. Invoke when the user asks to design or improve a module's interface, find deepening opportunities, decide where a seam goes, make code more testable or AI-navigable, or when another skill needs the deep-module vocabulary. Do not invoke merely because the user mentions codebase-design, names a skill, or writes 'skill <word>'."
---
# Codebase Design

## Scope

This skill owns the shared vocabulary for deep-module design. It is a reference.
It does not implement and it does not run a session.

## Objective

Design deep modules: much behaviour behind a small interface at a seam that isolates the implementation. The
aim is leverage for callers, locality for maintainers, and a test surface at the
interface.

## Vocabulary

Use these terms exactly when discussing module design. Do not substitute
`component`, `service`, `API`, `signature`, or `boundary`.

- **Module**: anything with an interface and an implementation: a function,
  class, package, or tier-spanning slice. _Avoid_: unit, component, service.
- **Interface**: every fact a caller must know to use the module: type signature,
  invariants, ordering constraints, error modes, required configuration, and
  performance characteristics. _Avoid_: API, signature.
- **Implementation**: the code inside a module.
- **Adapter**: a concrete thing that satisfies an interface at a seam. A thing
  can be a small adapter with a large implementation (a Postgres repository) or a
  large adapter with a small implementation (an in-memory fake). Use `adapter`
  when the seam is the topic; otherwise use `implementation`.
- **Depth**: leverage at the interface: the behaviour a caller or test can
  exercise per unit of interface they must learn. A module is **deep** when much
  behaviour sits behind a small interface and **shallow** when the interface is
  nearly as complex as the implementation.
- **Seam**: a place where behaviour changes without editing in that place; the
  location at which a module's interface lives. _Avoid_: boundary.
- **Leverage**: what callers get from depth.
- **Locality**: what maintainers get from depth: change, bugs, knowledge, and
  verification concentrate in one place.

## Rules

1. Depth is a property of the interface, not the implementation. A deep module
   can contain small, mockable internal parts. Internal seams stay private.
2. Deletion test: imagine deleting the module. When complexity vanishes, it was a
   pass-through. When complexity reappears across callers, it earned its keep.
3. The interface is the test surface. Callers and tests cross the same seam. A
   test that must reach past the interface is a signal the module shape is wrong.
4. One adapter is a hypothetical seam. Two adapters make a real one. Introduce no
   seam unless at least two adapters are justified.
5. When designing an interface, reduce the method count, simplify the parameters,
   and hide more complexity inside.

## Testability rules

1. Accept dependencies; do not create them inside the module.
2. Return results; do not produce hidden side effects.
3. Keep the surface small: fewer methods and parameters need less setup.

## Relationships

- A module has exactly one external interface.
- Depth is a property of a module, measured against its interface.
- A seam is where a module's interface lives.
- An adapter sits at a seam and satisfies the interface.
- Depth produces leverage for callers and locality for maintainers.

## Rejected framings

- Depth as the ratio of implementation lines to interface lines: it rewards
  padding. Use depth-as-leverage.
- Interface as the TypeScript `interface` keyword or a class's public methods:
  too narrow.
- Boundary: overloaded with DDD's bounded context. Say seam or interface.

## Disclosed reference

- Deepening a cluster given its dependencies: [DEEPENING.md](./DEEPENING.md).
- Exploring alternative interfaces: [DESIGN-IT-TWICE.md](./DESIGN-IT-TWICE.md).
