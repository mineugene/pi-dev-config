---
name: pr
disable-model-invocation: true
description: "Reference for the pull request body shape. Invoke when writing a pull request body, or when another skill needs the PR body template. Do not invoke merely because the user mentions pr, names a skill, or writes 'skill <word>'."
---
# PR

Reference for the pull request body. The size of the change selects the sections.

## Size

Choose the first matching size:

1. **Large**: touches more than one subsystem or changes a public interface.
2. **Medium**: changes more than two files or at least 20 lines of observable
   behaviour.
3. **Small**: changes more than one file or any observable behaviour.
4. **Tiny**: none of the above.

Include a section from a larger size when it helps explain the change.

## Sections

Render the sections for the size, in this order:

- tiny: `Summary`.
- small: `Summary`, `Changes`.
- medium: `Summary`, `Changes`, `Testing`.
- large: `Summary`, `Changes`, `Validation`, `Testing`.

## Template

```markdown
## Summary

<visual>

## Changes

- <change>

## Validation

- **Before:** <before>
  **After:** <after>

## Testing

<command and result>
```

## Summary

Use the smallest view that makes the change clear, chosen from:

- Pseudocode for logic or an algorithm.
- A call tree for runtime control flow.
- A component tree for UI structure, including state and module boundaries.
- A file tree for responsibility or a wide refactor.
- A Mermaid diagram for component interaction, control flow, or data flow.
- A `diff` when the point is what changes and the surrounding shape exists.

Place the visual next to the short text it supports. Keep only the calls, files,
props, states, and boundaries the reader needs. Use one or more; do not use all.

## Changes

List each change. Add the reversibility and impact scope when the change is hard
to revert or affects other consumers.

## Testing

Name the command run and its result.

## Validation

Use a screenshot for a visual change and captured execution output, such as a
test result or console output, for a behaviour change.

## Domain language

Use the project's domain terms exactly. Read
[domain-docs.md](../domain-docs.md) for where the glossary lives.
