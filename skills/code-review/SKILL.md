---
name: code-review
description: "Review changes since a fixed point along Standards and Spec axes with parallel sub-agents. Invoke only when the user asks to review a branch, PR, work in progress, or changes since a commit, branch, tag, or merge-base."
---
# Code Review

Review the diff between `HEAD` and a fixed point the user supplies, along exactly
two axes:

- **Standards**: does the code conform to this repository's documented coding standards?
- **Spec**: does the code implement the originating issue or specification?

Run both axes as parallel sub-agents, then aggregate their findings.

## 1. Pin the fixed point

1. Use the fixed point named by the user: a commit SHA, branch name, tag,
   `main`, `HEAD~5`, or another git revision.
2. If the user names no fixed point, ask for one and stop.
3. Run `git rev-parse <fixed-point>`. If it fails, report the failure and stop.
4. Capture `git diff <fixed-point>...HEAD` (three-dot) and
   `git log <fixed-point>..HEAD --oneline`.
5. If the diff is empty, report `empty diff` and stop.

## 2. Identify the spec source

Use the first source that yields a specification:

1. Issue references in the commit messages (`#123`, `Closes #45`, `!67`, and
   similar), fetched through the repository's documented tracker workflow.
2. A path passed in `$ARGUMENTS`.
3. A file under `docs/`, `specs/`, or `.scratch/` whose name matches the branch
   name or feature.
4. Ask the user where the specification is.
5. If the user says there is none, mark the Spec axis `skipped`, reason
   `no spec available`.

## 3. Identify the standards sources

1. Collect every repository file that documents how code is written, such as
   `CODING_STANDARDS.md` or `CONTRIBUTING.md`.
2. Add the smell baseline in section 4 to the Standards axis.

Apply the smell baseline with these limits:

- **The repository overrides.** A documented repository standard wins; where it
  endorses a baseline smell, suppress that smell.
- **Advisory only.** Every smell is a labelled heuristic (`possible Feature
  Envy`), never a hard violation. Skip anything tooling already enforces.

## 4. Smell baseline

Each smell reads *what it is* -> *how to fix*. Match it against the diff:

- **Mysterious Name**: a function, variable, or type whose name does not reveal
  what it does or holds. -> Rename it; if no honest name exists, the design is
  unclear.
- **Duplicated Code**: the same logic shape appears in more than one hunk or file.
  -> Extract the shared shape and call it from both.
- **Feature Envy**: a method reaches into another object's data more than its own.
  -> Move the method onto the data it envies.
- **Data Clumps**: the same few fields or parameters keep travelling together.
  -> Bundle them into one type and pass that.
- **Primitive Obsession**: a primitive or string stands in for a domain concept.
  -> Give the concept its own type.
- **Repeated Switches**: the same `switch` or `if` cascade on the same type
  recurs across the change. -> Replace with polymorphism or one shared map.
- **Shotgun Surgery**: one logical change forces scattered edits across many
  files. -> Gather what changes together into one module.
- **Divergent Change**: one file or module is edited for several unrelated
  reasons. -> Split so each module changes for one reason.
- **Speculative Generality**: abstraction, parameters, or hooks added for needs
  the specification does not have. -> Delete it and inline until a real need
  exists.
- **Message Chains**: long `a.b().c().d()` navigation the caller must not
  depend on. -> Hide the walk behind one method on the first object.
- **Middle Man**: a class or function that only delegates onward. -> Remove it
  and call the target directly.
- **Refused Bequest**: a subclass or implementer ignores or overrides most of
  what it inherits. -> Replace the inheritance with composition.

## 5. Spawn both sub-agents in parallel

Include the following in the **Standards sub-agent prompt**:

1. The diff command and the commit list.
2. Every standards source path from step 3.
3. The full smell baseline from section 4.
4. This brief: "Report, per file or hunk, (a) every place the diff
   violates a documented standard: cite the standard by file and rule; and
   (b) any baseline smell you find: name it and quote the hunk. Distinguish hard
   violations from judgement calls: documented-standard breaches can be hard,
   but baseline smells are always judgement calls, and a documented repository
   standard overrides the baseline. Skip anything tooling enforces. Under 400
   words."

Include the following in the **Spec sub-agent prompt**:

1. The diff command and the commit list.
2. The path or contents of the specification.
3. This brief: "Report: (a) requirements the specification asked for that are
   missing or partial; (b) behaviour in the diff that the specification did not
   ask for; (c) requirements that look implemented but whose implementation
   looks wrong. Quote the specification line for each finding. Under 400 words."

If the spec source is absent, spawn only the Standards sub-agent.

## 6. Aggregate

1. Print the Standards report under `## Standards`.
2. Print the Spec report under `## Spec`.
3. Do not merge or re-rank findings; the two axes stay separate.
4. End with one line: total findings per axis and the highest-severity finding
   within each axis.
5. Do not select a single finding across axes.

## Exclusions

- Apply no fixes; this skill reports only.

## Why two axes

A change can pass one axis and fail the other:

- Code that follows every standard but implements the wrong thing: Standards
  pass, Spec fail.
- Code that does exactly what the issue asked but breaks the repository's
  conventions: Spec pass, Standards fail.

Reporting them separately stops one axis from masking the other.
