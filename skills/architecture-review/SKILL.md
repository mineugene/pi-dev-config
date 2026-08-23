---
name: architecture-review
disable-model-invocation: true
description: "Critically evaluate an existing architecture, proposed design, or architectural change. Invoke when the user asks to review architecture, critique a proposed design, evaluate module boundaries or an architectural refactor, find architectural coupling, or assess whether Clean Architecture/SOLID/DRY is applied appropriately. Do not invoke merely because a normal code review contains architectural code, the user mentions architecture-review, names a skill, or writes 'skill <word>'."
---
# Architecture Review

## Contents

- **Read scope** - how to consume this skill when a read is truncated.
- **Objective** - the question a review answers; cross-language scope.
- **Review priorities** - the 12-point precedence order; a lower number wins.
- **Establish the evidence** - what to inspect and when to ask.
- **Boundary and ownership checks** - real responsibilities, leaks, authoritative owners.
- **Cohesion, depth, and locality checks** - module purpose, fragmentation, change locality.
- **Dependency direction checks** - inward leaks, cycles, needless inversions.
- **SOLID checks** - SRP/OCP/LSP/ISP/DIP with architectural consequences only.
- **Semantic DRY checks** - harmful duplication versus harmful abstraction.
- **API and data-shape checks** - parameter grouping and value objects, including CancellationToken checks.
- **Clean Architecture checks** - boundary value, not diagram resemblance.
- **Review output** - finding classes (Blocking, Significant, Minor, Observation) and the five-part finding format.
- **Skill boundaries** - when to load design, code-review, domain-modeling, or tdd.

## Read scope

Read this entire skill, including every section listed in Contents, before
applying it. If a read is truncated, continue from the next unread line until the
end.

## Objective

Challenge whether the architecture is good, not whether it resembles a preferred
pattern. Do not redesign everything because another architecture is
theoretically cleaner. Work across C#, ASP.NET, C++, Rust, Go, and TypeScript,
respecting each repository's conventions.

## Review priorities

Review in this order; a lower number wins:

1. Requirements and intended behaviour.
2. Existing repository architecture and conventions.
3. Dependency direction.
4. Ownership and boundaries.
5. Cohesion and module depth.
6. Locality of change.
7. Abstraction quality.
8. API ergonomics.
9. SOLID concerns with architectural consequences.
10. DRY concerns or harmful abstractions.
11. Clean Architecture boundary concerns.
12. Unnecessary complexity.

## Establish the evidence

1. Read applicable `AGENTS.md` instructions, requirements, and architectural
   documentation.
2. Inspect the reviewed design or implementation, its callers, neighbouring
   modules, dependency direction, existing abstractions, state and behaviour
   owners, and tests at established seams.
3. Evaluate against the repository, not in isolation.
4. Investigate facts yourself. Ask only for missing review scope, intended
   behaviour, or user-owned constraints that change the verdict.
5. Distinguish demonstrated problems from unverified risks.
6. A proposed design can be reviewed without a diff; require a branch or
   merge-base only when the requested scope needs one.

Use the checks below as diagnostic guidance, not automatic violations. Ground
findings in demonstrated consequences and the repository's requirements.

## Boundary and ownership checks

- Does each boundary represent a real responsibility?
- Is a dependency crossing a meaningful architectural boundary?
- Is infrastructure leaking into domain or application code unnecessarily?
- Are framework concerns infecting core logic?
- Is the proposed boundary improving isolation?
- Is there one authoritative owner of each state and behaviour, with a clear
  lifetime?

Conceptually: domain owns business concepts, rules, invariants, and behaviour;
application owns use cases and orchestration; infrastructure supplies external
mechanisms; adapters handle transport and presentation. These are useful concepts,
not mandatory directories or a reason to impose competing layers.

## Cohesion, depth, and locality checks

- Does this module have a strong purpose?
- Are related decisions kept together?
- Is behaviour separated from the data or policy it naturally belongs with?
- Has the design fragmented into too many tiny abstractions?
- Would one likely requirement change force scattered edits across unrelated
  modules?
- Does each abstraction hide meaningful complexity, or merely rename an
  implementation?
- Are recommendations tied to a concrete change scenario rather than
  hypothetical flexibility?

## Dependency direction checks

- Infrastructure leaking inward.
- Domain depending directly on infrastructure.
- Application logic coupled to transport or framework concerns.
- Circular dependencies.
- Abstractions that exist only to reverse an otherwise harmless dependency.

Explain the practical harm in context. Do not require every dependency to be
inverted and do not treat every concrete dependency as a defect.

## SOLID checks

Report only violations with architectural consequences:

- **SRP**: multiple independent reasons to change, not class size.
- **OCP**: a real axis of variation obstructed by the design, not a missing
  speculative extension point.
- **LSP**: an implementation that breaks its abstraction's behavioural contract.
- **ISP**: consumers forced to depend on capabilities they do not need.
- **DIP**: a dependency direction that harms isolation or testability.

Never report "Class has too many methods", "Concrete class has no interface", or
"Method has multiple statements" as SOLID violations. Explain why the heuristic
matters in this design.

## Semantic DRY checks

Look for both:

- Harmful duplication of genuinely identical concepts, invariants, or policies
  that change together.
- Harmful abstractions that combine concepts only because their implementations
  currently resemble one another.

Repeated implementation is not automatically a DRY violation. Allow duplication
when reasons to change differ, or when sharing would require awkward
conditionals or configuration. Choose duplication over a wrong abstraction.

## API and data-shape checks

Check whether related parameters warrant a request/value/options structure:

- Primitive-heavy signatures and ambiguous booleans.
- Repeated parameter groups that represent one concept.
- Poor property discoverability or call-site readability.

Also check the opposite: giant parameter objects, unrelated values bundled
together, and structures created only to reduce parameter count.

Evaluate property names, nullability, defaults, invalid states, async semantics,
cancellation semantics, and future evolution. Use named options over
unreadable flag lists when the choices are independent and meaningful.

Respect natural lightweight representations: C# value records or reference types,
C++ aggregates with RAII and ownership intact, Rust domain structs, Go
request/options structs without gratuitous methods, and TypeScript types,
interfaces, or object shapes consistent with the repository.

### CancellationToken checks

Inspect cancellation separately from business or application input:

- Business or application data belongs in request or value objects.
- Configuration belongs in options structures.
- Execution and control flow belongs in separate parameters such as
  `CancellationToken`.

Flag `CancellationToken` inside a request, command, options, or data structure
without a framework-specific reason. Use:

```csharp
ExecuteAsync(ExecuteRequest request, CancellationToken cancellationToken = default)
```

Do not suggest moving cancellation into a request because other arguments were
grouped. Check propagation across asynchronous boundaries and flag created,
replaced, ignored, or swallowed caller cancellation.

## Clean Architecture checks

Do not score resemblance to a Clean Architecture diagram. Apply the boundary
conditions from the design skill: useful dependency direction, testability,
isolation from volatile dependencies, one authoritative owner of each state and
behaviour, replaceability, or locality of change.

Flag:

- Empty domain layers or domain abstractions created because "Clean Architecture
  says so".
- Application services or service/manager classes that only forward calls.
- Repositories that only wrap an ORM without hiding persistence concerns.
- Interfaces created only to satisfy dependency inversion mechanically.
- Excessive DTO or mapping layers, including DTOs that only rename an object.
- Framework-independent abstractions with no reason to exist.
- Interface-per-class, repository-per-entity, and mandatory
  `Controller -> Service -> Repository` layering.
- Speculative extension points and abstract factories with no variability.
- Inheritance primarily for code reuse or fragmentation of cohesive modules.

For ASP.NET, do not assume
`Controller -> Service -> Repository -> IRepository -> UnitOfWork -> DbContext`
is necessary. Accept simpler architectures that preserve dependency direction and
locality.

## Review output

State scope, intended behaviour, constraints, and evidence gaps. Classify
every finding into exactly one class:

- **Blocking**: correctness or major architectural boundary problems; requirements
  cannot be satisfied safely; serious dependency inversion or ownership problems.
- **Significant**: meaningful complexity, coupling, poor locality, or abstraction
  problems.
- **Minor**: worth improving, not materially harmful.
- **Observation**: a trade-off or design consideration that requires no change.

For each finding, state:

1. What the design currently does, citing a concrete location or design element.
2. Why it is a problem, including the actual consequence.
3. The architectural principle or heuristic that applies.
4. The smallest useful correction.
5. Whether to correct it now or defer it, and why.

Do not manufacture findings. If no finding is supported, state that. Apply no
fixes during a review unless the user asks for implementation.

## Skill boundaries

- This skill owns architectural evaluation, coupling and boundary problems,
  challenges to unnecessary abstractions, and whether decisions reduce complexity.
- Load `../architecture-design/SKILL.md` for new architecture, boundary choices,
  APIs and data shapes, or architectural change planning.
- Load `../code-review/SKILL.md` for standards, specification compliance, general
  code smells, and diff-level review.
- Load `../domain-modeling/SKILL.md` when resolving domain terminology,
  conceptual models, conflicting terms, or context and ADR decisions.
- Load `../tdd/SKILL.md` for explicit test-first or integration-test requests.
