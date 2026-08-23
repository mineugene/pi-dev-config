---
name: ponytail-review
disable-model-invocation: true
description: >
  Code review focused exclusively on over-engineering. Finds what to delete:
  reinvented standard library, unneeded dependencies, speculative abstractions,
  dead flexibility. One line per finding: location, what to cut, what replaces
  it. Use when the user says "review for over-engineering", "what can we
  delete", "is this over-engineered", or "simplify review". Complements
  correctness-focused review; this one only hunts complexity.
---
# Ponytail Review

Review the diff for unnecessary complexity.

## Format

- Single-file diff: `L<line>: <tag> <what>. <replacement>.`
- Multi-file diff: `<file>:L<line>: <tag> <what>. <replacement>.`

## Tags

- `delete:` dead code, unused flexibility, speculative feature. Replacement:
  nothing.
- `stdlib:` hand-rolled code the standard library ships. Name the function.
- `native:` a dependency or code doing what the platform already does. Name the
  feature.
- `yagni:` an abstraction with one implementation, configuration nobody sets, or
  a layer with one caller.
- `shrink:` the same logic in fewer lines. Show the shorter form.

## Output

1. One line per finding.
2. End with `net: -<N> lines possible.`
3. If no finding exists: `Lean already. Ship.`

## Exclusions

- Scope is over-engineering and complexity only. Correctness bugs, security
  holes, and performance are out of scope; route them to a normal review.
- A single smoke test or `assert`-based self-check is the required minimum, not
  bloat. Do not flag it.
- Apply no fixes.
- Do not change the Ponytail runtime mode.
