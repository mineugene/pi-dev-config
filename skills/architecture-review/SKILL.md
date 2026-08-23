---
name: architecture-review
description: "Critically evaluate an existing architecture, proposed design, or architectural change. Invoke when the user asks to review architecture, critique a proposed design, evaluate module boundaries or an architectural refactor, find architectural coupling, or assess whether Clean Architecture/SOLID/DRY is applied appropriately. Do not invoke merely because a normal code review contains architectural code, the user mentions architecture-review, names a skill, or writes 'skill <word>'."
---

# Architecture Review

## Content outline

This outline is navigation, not a substitute for the instructions. Read the entire skill, including all sections below line 100, before applying it. If a read is truncated, continue from the next unread line until the end.

- [Review priorities](#review-priorities): ordered review concerns, from requirements to unnecessary complexity.
- [Establish the evidence](#establish-the-evidence): scope, repository sources, callers, ownership, tests, and evidence gaps.
- [Boundaries and ownership](#boundaries-and-ownership): useful responsibilities, dependency boundaries, and authoritative state owners.
- [Cohesion, depth, and locality](#cohesion-depth-and-locality): module purpose, deep interfaces, and concrete change scenarios.
- [Dependency direction](#dependency-direction): inward leaks, framework coupling, cycles, and needless inversion.
- [SOLID, diagnostically](#solid-diagnostically): consequential SRP, OCP, LSP, ISP, and DIP violations, not stylistic findings.
- [Semantic DRY](#semantic-dry): harmful duplication versus abstractions that couple unrelated concepts.
- [APIs and data shapes](#apis-and-data-shapes): cohesive inputs, ergonomics, invalid states, and language-native types.
  - [CancellationToken review](#cancellationtoken-review): separate execution control from data and check propagation.
- [Clean Architecture without ceremony](#clean-architecture-without-ceremony): practical boundaries, needless layers, and ASP.NET alternatives.
- [Review output](#review-output): severity, evidence, consequences, smallest correction, timing, and no unrequested fixes.
- [Skill boundaries](#skill-boundaries): architecture review, design, code review, domain modeling, and TDD responsibilities.

Review adversarially: challenge whether the architecture is actually good, not
whether it resembles a preferred pattern. Do not redesign everything because
another architecture is theoretically cleaner. Work across C#, ASP.NET, C++,
Rust, Go, and TypeScript, respecting each repository's conventions.

## Review priorities

Review in this order:

1. Requirements and intended behaviour.
2. Existing repository architecture and conventions.
3. Dependency direction.
4. Ownership and boundaries.
5. Cohesion and module depth.
6. Locality of change.
7. Abstraction quality.
8. API ergonomics.
9. SOLID violations that materially affect design.
10. DRY violations or harmful abstractions.
11. Clean Architecture boundary problems.
12. Unnecessary complexity.

## Establish the evidence

Read applicable `AGENTS.md` instructions, requirements, and architectural
documentation. Inspect the reviewed design or implementation, its callers,
neighbouring modules, dependency direction, existing abstractions, state and
behaviour owners, and tests at established seams.

Evaluate the design against the repository, not in isolation. Investigate facts
yourself; ask only for missing review scope, intended behaviour, or user-owned
constraints that could materially change the verdict. Distinguish demonstrated
problems from unverified risks. A proposed design can be reviewed without a diff;
do not require a branch or merge-base unless the requested scope needs one.

## Boundaries and ownership

Ask:

- Does each boundary represent a real responsibility?
- Is a dependency crossing a meaningful architectural boundary?
- Is infrastructure leaking into domain/application code unnecessarily?
- Are framework concerns infecting core logic?
- Is the proposed boundary actually improving isolation?
- Is there one authoritative owner of each state and behaviour, with a clear lifetime?

Conceptually, domain owns business concepts, rules, invariants, and behaviour;
application owns use cases and orchestration; infrastructure supplies external
mechanisms; adapters handle transport and presentation. These are useful concepts,
not mandatory directories or a reason to impose competing layers.

## Cohesion, depth, and locality

Ask:

- Does this module have a strong purpose?
- Are related decisions kept together?
- Is behaviour separated from the data/policy it naturally belongs with?
- Has the design been fragmented into too many tiny abstractions?
- Would one likely requirement change force scattered edits across unrelated modules?

Prefer interfaces that provide substantial leverage:

> Does this abstraction hide meaningful complexity, or merely rename an implementation?

Reject shallow abstractions that increase indirection without reducing complexity.
Keep recommendations tied to concrete change scenarios, not hypothetical flexibility.

## Dependency direction

Check whether dependencies point toward stable concepts and useful boundaries.
Identify:

- Infrastructure leaking inward.
- Domain depending directly on infrastructure.
- Application logic coupled to transport/framework concerns.
- Circular dependencies.
- Abstractions that exist solely to reverse an otherwise harmless dependency.

Explain the practical harm in context. Do not insist that every dependency be
inverted or treat every concrete dependency as an architectural defect.

## SOLID, diagnostically

Report only violations with architectural consequences:

- **SRP**: multiple independent reasons to change, not class size alone.
- **OCP**: a real axis of variation obstructed by the design, not missing
  speculative extension points.
- **LSP**: implementations that break their abstraction's behavioural contract.
  Consider composition when inheritance causes surprising semantics.
- **ISP**: consumers forced to depend on capabilities they do not need, not
  concrete classes lacking interfaces.
- **DIP**: dependency direction that harms isolation or testability, not a lack
  of interfaces solely for mocking.

Do not report "Class has too many methods", "Concrete class has no interface",
"Method has multiple statements", or other stylistic interpretations masquerading
as SOLID violations. Explain why the heuristic matters in this design.

## Semantic DRY

Look for both:

- Harmful duplication of genuinely identical concepts, invariants, or policies
  that should change together.
- Harmful abstractions that combine concepts merely because their implementations
  currently resemble one another.

Repeated implementation is not automatically a DRY violation. Allow duplication
when reasons to change differ or sharing would require awkward conditionals or
configuration. Prefer duplication over a wrong abstraction.

## APIs and data shapes

Check whether related parameters warrant a meaningful request/value/options
structure:

- Primitive-heavy signatures and ambiguous booleans.
- Repeated parameter groups and sets representing a clear concept.
- Poor IntelliSense/property discoverability or call-site readability.

Also check the opposite: giant parameter objects, unrelated values bundled
together, and structures created only to reduce parameter count.

Evaluate property names, nullability, defaults, invalid states, async semantics,
cancellation semantics, and future API evolution. Prefer named options over
unreadable flag lists when the choices are meaningful and independent.

Respect natural lightweight representations: appropriate C# value records or
reference types, C++ aggregates with RAII/ownership intact, Rust domain structs,
Go request/options structs without gratuitous methods, and TypeScript types,
interfaces, or object shapes consistent with the repository.

### CancellationToken review

Explicitly inspect cancellation separately from business/application input:

- Business/application data belongs in request/value objects.
- Configuration belongs in options structures.
- Execution/control flow belongs in separate parameters such as `CancellationToken`.

Flag `CancellationToken` inside a request, command, options, or data structure
without a compelling framework-specific reason. Prefer:

```csharp
ExecuteAsync(ExecuteRequest request, CancellationToken cancellationToken = default)
```

The request represents operation data; the token represents execution control.
Do not suggest moving cancellation into a request merely because other arguments
are grouped. Check propagation through asynchronous boundaries and flag silently
created, replaced, ignored, or swallowed caller cancellation.

## Clean Architecture without ceremony

Do not score resemblance to a Clean Architecture diagram. Ask whether boundaries
provide practical value: useful dependency direction, testability, isolation from
volatile dependencies, clear ownership, replaceability, or locality of change.

Flag:

- Empty domain layers or domain abstractions created because "Clean Architecture says so."
- Application services or service/manager classes that only forward calls.
- Repositories that merely wrap an ORM without hiding meaningful persistence concerns.
- Interfaces created only to satisfy dependency inversion mechanically.
- Excessive DTO/mapping layers, including DTOs that only rename another object.
- Framework-independent abstractions with no meaningful reason to exist.
- Interface-per-class, repository-per-entity, and mandatory Controller → Service → Repository layering.
- Speculative extension points and abstract factories without meaningful variability.
- Inheritance primarily for code reuse or fragmentation of cohesive modules.

For ASP.NET, do not assume
`Controller → Service → Repository → IRepository → UnitOfWork → DbContext`
is necessary. Accept simpler architectures when they preserve appropriate
dependency direction and locality.

## Review output

Briefly state scope, intended behaviour, relevant constraints, and evidence gaps.
Classify findings:

- **Blocking**: correctness or major architectural boundary problems; requirements
  cannot be satisfied safely; serious dependency inversion or ownership problems.
- **Significant**: meaningful complexity, coupling, poor locality, or abstraction problems.
- **Minor**: worth improving but not materially harmful.
- **Observation**: a trade-off or design consideration that does not require change.

For each finding, explain:

1. What the design currently does, citing a concrete location or design element.
2. Why it is a problem, including the actual consequence.
3. Which architectural principle or heuristic is relevant.
4. The smallest useful correction.
5. Whether to make the correction now or defer it, and why.

Do not manufacture findings to appear thorough. If none are supported, say so.
Do not apply fixes during a review unless the user asks for implementation.

## Skill boundaries

- This skill owns architectural evaluation, coupling and boundary problems,
  challenges to unnecessary abstractions, and whether decisions reduce complexity.
- Load `../architecture-design/SKILL.md` when the user asks for new architecture,
  boundary choices, APIs/data shapes, or architectural change planning. A small
  corrective recommendation does not require redesigning the system.
- `../code-review/SKILL.md` owns standards, specification compliance, general code
  smells, and diff-level implementation review. Load it for its documented intent;
  do not automatically turn ordinary code review into architecture review.
- Load `../domain-modeling/SKILL.md` when resolving domain terminology, conceptual
  models, ambiguous/conflicting terms, or context and ADR decisions.
- Load `../tdd/SKILL.md` for explicit test-first or integration-test requests. It
  owns behavioural seams, test quality, and the red → green → refactor workflow.
  Do not duplicate that workflow here.

Prefer simple architecture with strong boundaries and deep, cohesive modules over
elaborate architecture with many shallow abstractions. Clean Architecture, SOLID,
and DRY are tools for that goal, not goals in themselves.
