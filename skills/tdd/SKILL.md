---
name: tdd
description: "Test-driven development. Invoke only when the user asks to build a feature or fix a bug test-first, requests a red-green-refactor loop, or requests integration tests. Do not invoke merely because the user mentions TDD, names a skill, or writes 'skill <word>'."
---
# Test-Driven Development

TDD is the loop `red -> green`. Every section below applies on every cycle:
consult it before and during the loop, not after.

When exploring the codebase, follow [domain-docs.md](../domain-docs.md) to find
the glossary and architectural decision records. Use them to keep test names and
interface vocabulary aligned with the project's domain language.

## Required test properties

Keep tests that meet all three requirements:

1. Verify behaviour through a public interface, not an internal detail.
2. Read as a specification of one capability.
3. Survive a refactor that does not change behaviour.

See [tests.md](tests.md) for examples and [mocking.md](mocking.md) for mocking
rules.

## Seams

A seam is a public boundary where behaviour is observable without reaching
inside.

1. Before writing any test, write down the seams under test and confirm them
   with the user. For each proposed seam, write one line naming what it catches
   and what it misses.
2. Write no test at an unconfirmed seam.
3. When the interface shape is itself in question, load
   `../codebase-design/SKILL.md` for the module, interface, depth, seam, and
   adapter vocabulary.

## Prohibited test properties

Avoid these test patterns:

1. Mock an internal collaborator, call a private method, or verify through a
   side channel. Such a test breaks on refactor without a behaviour change.
2. Recompute the expected value the way the code does. Take expected values
   from an independent source: a known-good literal, a worked example, or
   the specification.
3. Follow horizontal slicing (all tests first, then all implementation). Work in
   vertical slices: one test, one implementation, repeat.

## Loop rules

1. Red before green: write the failing test, then only enough code to pass it.
   Do not add speculative features.
2. One slice at a time: one seam, one test, one minimal implementation per
   cycle.
3. Refactoring is not part of this loop. It belongs to the review stage (see the
   `code-review` skill).
