---
name: retro
description: "Review a coding session and suggest improvements to skills, instructions, tools, and checks. Report only."
disable-model-invocation: true
---
# Retro

Suggest improvements to the coding agent's environment that would prevent
problems seen in a session. This skill reports only.
Do not edit files or apply fixes; get the user's approval before follow-up work.

## Steps

1. Read `../writing-for-agents/SKILL.md` and apply its writing guidance.
2. Read the primary sources for the session the user specifies. If none is
   specified, default to the current session. Use the conversation and tool
   results; locate session logs when needed. State which evidence is unavailable
   rather than inventing it. Redact secrets before quoting commands, logs, or
   artifacts.
3. Read the skills and instruction files involved, including their descriptions
   and referenced material. Read the repository's check command, pre-commit
   hooks, and CI workflows before proposing checks. Identify what already exists
   and whether it runs, rather than proposing a duplicate.
4. Evaluate the categories below against the session evidence. Separate
   observed failures from hypotheses. Keep only candidates supported by
   evidence.
5. Present candidates in order of severity. For each, give the observed problem,
   a source pointer or redacted excerpt, its impact, and the smallest proposed
   fix with its destination. State evidence limits. If no supported findings
   remain, say so. Stop after the report.

## Improvement categories

- **Skills and prompts**: did a skill fail to load, trigger for the wrong task,
  skip a needed step, or conflict with another instruction? Check its
  description, context pointers, completion criteria, and assumptions about
  available tools. Identify the instruction responsible before proposing a
  rewrite.
- **Navigation**: did finding information take too long? Look for hidden
  dependencies and missing navigation pointers to existing documentation.
- **Automated checks**: could linting, types, tests, or filesystem checks catch
  the mistake? An existing check that is unwired or broken is the finding. A
  repo with neither a pre-commit hook nor a CI job running its checks lacks a
  guardrail; flag that even when a check command exists.
- **Coding standards**: did review miss a mistake? Classify it first. Mechanical
  rules, such as a banned API, import shape, or file location, need a
  deterministic check in the existing linter, hook, or CI job, whichever fits
  most cheaply.
  Propose that check rather than more prose. Reserve `CODING_STANDARDS.md` for
  judgement calls that tooling cannot enforce, and clarify or remove bad rules.
- **Global AGENTS.md**: are project or global steering files overloaded with
  material that belongs in checks, review standards, or referenced docs?
- **Tool economy**: did expensive calls, large outputs, or repeated searches
  waste context? Identify the costly call and a cheaper path to the same
  information.
- **No-ops**: which instructions add load without changing behaviour? Check for
  redundant, stale, or ineffective instructions in the files the session used.
- **Information access**: was crucial evidence unavailable? Consider dev-server
  logs or read-only service access. Propose the access needed; do not expand
  permissions or expose credentials.

## Reference

### Implementation and review

Implementation carries exploration, coding, and debugging context. Review can
focus on the diff and standards. Put review-oriented judgement in review
standards rather than loading every implementation step with it. Keep safety
constraints and deterministic checks at their point of enforcement.

### Instruction destinations

- `AGENTS.md` / `CLAUDE.md`: always-loaded context; prefer short navigation
  pointers over more inline instructions.
- `CODING_STANDARDS.md`: judgement-based review rules. Split long reference
  material into docs reached by pointers.
- Docs: reusable reference material. Find existing docs before adding another.
- Skills: focused workflows or reference loaded on demand. Descriptions
  advertise model-invoked skills; explicit-only skills stay out of the baseline
  catalogue.
