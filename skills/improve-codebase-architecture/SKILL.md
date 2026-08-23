---
name: improve-codebase-architecture
description: "Scan a codebase for deepening opportunities, present them as a visual HTML report, then grill through the chosen one."
disable-model-invocation: true
---
# Improve Codebase Architecture

## References

Read `../codebase-design/SKILL.md` for module-design vocabulary. Follow
[domain-docs.md](../domain-docs.md) to find the project's glossary and
architectural decision records.

## Scope

Find deepening opportunities: refactors that turn shallow modules into deep
ones. Increase testability and AI-navigability. Do not re-litigate an ADR unless
the friction is real enough to warrant revisiting it.

## Procedure

1. Choose the search area:
   - If the user names a module, subsystem, or pain point, use it.
   - Otherwise read `git log --oneline`, find the hot spots, and weight recently
     changed paths first.
   - If changes are scattered, widen the search.
2. Read the glossary and architectural decision records for the area.
3. Spawn one sub-agent to walk the codebase. It reports friction:
   - Understanding one concept requires bouncing between many small modules.
   - A module is shallow: the interface is nearly as complex as the
     implementation.
   - Pure functions exist only for testability, while real bugs hide in how they
     are called.
   - Tightly coupled modules leak across their seams.
   - An area is untested or hard to test through its current interface.
   Apply the deletion test to each suspected shallow module.
4. Write one self-contained HTML report named
   `architecture-review-<timestamp>.html` in a temporary directory. Use
   `$TMPDIR` when set, otherwise `/tmp` on Unix or `%TEMP%` on Windows. Follow
   [HTML-REPORT.md](./HTML-REPORT.md).
5. Open the report: `xdg-open <path>` on Linux, `open <path>` on macOS, or
   `start <path>` on Windows. Report the absolute path.
6. Ask: "Which of these would you like to explore?" Wait for the answer.
7. On a chosen candidate, load `../grilling/SKILL.md` and walk the decision
   tree.
8. During the interview, keep the model current:
   - A deepened module named after a term not in the glossary: add the term.
   - A fuzzy term sharpened: update the glossary.
   - The user rejects a candidate for a load-bearing reason: offer an ADR when a
     future explorer needs the reason. Skip ephemeral reasons.
   - Alternative interfaces wanted: use
     `../codebase-design/DESIGN-IT-TWICE.md`.

## Report vocabulary

Use the codebase-design terms exactly for module design and the project's
glossary terms for the domain. Keep module, interface, and seam distinct; do not
substitute component, service, API, signature, or boundary.
