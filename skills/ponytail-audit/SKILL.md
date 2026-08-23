---
name: ponytail-audit
disable-model-invocation: true
description: >
  Whole-repo audit for over-engineering. Like ponytail-review, but scans the
  entire codebase instead of a diff: a ranked list of what to delete, simplify,
  or replace with stdlib/native equivalents. Use when the user says "audit this
  codebase", "audit for over-engineering", "what can I delete from this repo",
  "find bloat", or "ponytail audit". One-shot report, does not apply fixes.
---
# Ponytail Audit

Run the ponytail-review rules over the whole tree instead of a diff. Rank
findings by lines removable, largest first.

## Tags

Same as ponytail-review: `delete:`, `stdlib:`, `native:`, `yagni:`, `shrink:`.

## Hunt

Dependencies the standard library or platform already ships,
single-implementation interfaces, factories with one product, wrappers that only
delegate, files exporting one thing, dead flags and configuration, hand-rolled
standard-library code.

## Output

1. One line per finding, ranked:
   `<tag> <what to cut>. <replacement>. [path]`.
2. End with `net: -<N> lines, -<M> deps possible.`
3. If no finding exists: `Lean already. Ship.`

## Exclusions

- Scope is over-engineering and complexity only. Correctness bugs, security
  holes, and performance are out of scope; route them to a normal review.
- Apply nothing.
- Do not change the Ponytail runtime mode.
