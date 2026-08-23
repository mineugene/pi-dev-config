# Design It Twice

Parallel sub-agent pattern for exploring alternative interfaces for a chosen
deepening candidate. Uses the vocabulary in [SKILL.md](./SKILL.md): module,
interface, seam, adapter, leverage.

## Procedure

1. Frame the problem space for the user:
   - The constraints any new interface must satisfy.
   - The dependencies and their categories from [DEEPENING.md](./DEEPENING.md).
   - A rough code sketch that makes the constraints concrete. It is not a
     proposal.
   Show this to the user, then continue to step 2 immediately.
2. Spawn at least 3 sub-agents in parallel, each designing a radically
   different interface. Give each one a separate technical brief with the file
   paths, coupling, dependency category, and what sits behind the seam. Assign
   one constraint each:
   - Minimise the interface: 1 to 3 entry points, maximum leverage each.
   - Maximise flexibility: many use cases and extension points.
   - Optimise the common caller: make the default case trivial.
   - Use ports and adapters when a dependency crosses a seam. Include
     codebase-design vocabulary and `GLOSSARY.md` vocabulary in each brief.
3. Each sub-agent outputs:
   1. The interface: types, methods, parameters, invariants, ordering, error
      modes.
   2. A usage example.
   3. What the implementation hides behind the seam.
   4. The dependency strategy and adapters.
   5. Trade-offs: where leverage is high and where it is thin.
4. Present the designs sequentially, then compare them by depth, locality, and
   seam placement.
5. Recommend the strongest design and why. Propose a hybrid when elements
   combine. State a position; do not present a menu.
