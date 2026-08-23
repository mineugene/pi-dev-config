---
name: implement
description: "Implement the work described by a specification or set of tickets."
disable-model-invocation: true
---
# Implement

## Preconditions

1. Read the user's specification or issues to establish the work to implement.
2. If `$ARGUMENTS` gives a ticket reference, fetch it from the issue tracker
   (see [tracker-workflow.md](../tracker-workflow.md)) and state its title
   before starting.
3. If a ticket reference is ambiguous, ask the user to choose one.

## Procedure

1. Load `../tdd/SKILL.md` and apply it at the seams agreed with the user. If no
   seam is agreed, agree the seams before writing any code.
2. Run the typechecker after each coherent change.
3. Run the test file for each changed unit after the change.
4. Run the full test suite once, after all changes.
5. Load `../code-review/SKILL.md` and review the work since its fixed point.
6. Fix every finding from step 5.
7. Commit the work to the current branch.

## Output

Report each command run, its exit code, and each commit hash created.
