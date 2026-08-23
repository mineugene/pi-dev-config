---
name: ponytail
disable-model-invocation: true
description: >
  Enforce the smallest working scope with existing code, standard libraries, and
  native features. Invoke only when the user asks for a minimal or simplest
  solution, YAGNI, less code, or relief from over-engineering, bloat,
  boilerplate, or unnecessary dependencies. Do not invoke merely because the
  user mentions ponytail, names a skill, or writes 'skill <word>'.
license: MIT
---
# Ponytail

## Runtime mode

The `ponytail` extension owns the active mode and persists it with the current
session branch. Default: `full`.

- Commands: `/ponytail off|lite|full|ultra`.
- `/ponytail` and `/ponytail status` report the active mode.
- The exact input `stop ponytail` or `normal mode` sets the mode to `off`.
- Resuming a branch restores that branch's newest mode entry.
- Child subagents start at the default mode.

Invoking `$skill:ponytail` adds context and does not change the runtime mode.

## Selection ladder

Select the first rung that applies:

1. The change has no present requirement: skip it and report
   `skipped: <change>, add when <trigger>`.
2. The codebase already provides a helper, util, type, or pattern: reuse it.
3. The standard library provides it: use it.
4. A native platform feature covers it: use it.
5. An already-installed dependency solves it: use it. Add no new dependency for
   a change a few lines can make.
6. It can be one line: write one line.
7. Otherwise: write the minimum code that works.

Run the ladder only after reading the task, reading every file the change
touches, and tracing the flow end to end. When two rungs apply, take the higher
rung and continue.

## Rules

- Add no abstraction with one implementation, no factory with one product, and
  no configuration for a value that does not change.
- Add no boilerplate and no scaffolding for later.
- Delete before adding.
- Use the fewest files and the shortest diff that works.
- When two standard-library options are equal in size, choose the one that is
  correct on edge cases.
- For a complex request: ship the minimum version and state the unbuilt part in
  the same response.
- A deliberate shortcut can carry one intent comment naming its ceiling and
  upgrade trigger. Do not add branded prefixes to comments.

## Bug fixes

1. A report names a symptom.
2. Grep every caller of each function the fix touches.
3. Fix the root cause at the shared function all callers route through.
4. A fix that patches only the reported path leaves sibling callers broken.

## Intensity

| Level | Change |
| --- | --- |
| `lite` | Build what was asked and name the lazier alternative in one line. |
| `full` | Enforce the ladder. Standard library and native first. Shortest diff. |
| `ultra` | Delete before adding and challenge every requirement with no present need. |

## Output

1. Code first.
2. Then at most three lines: what was skipped and the trigger to add it.
3. Pattern: `skipped: <X>, add when <Y>.`
4. Add no unrequested prose. Explanation the user explicitly requested is not
   unrequested prose.

## Exclusions

Preserve input validation at trust boundaries, error handling that prevents data
loss, security measures, accessibility features, and anything the user
explicitly requested. When the user requires the full version, build it without
re-arguing.

## Verification

Non-trivial logic (a branch, a loop, a parser, a money path, or a security path)
leaves exactly one runnable check: the smallest check that fails on a logic
error. Trivial one-liners need no check.

## Hardware

For hardware, keep one calibration parameter per physical quantity that drifts
or reads off. A minimal model cannot encode physical variation.

## Boundaries

Ponytail governs what is built, not prose style. The extension, not this skill,
controls the runtime mode.
