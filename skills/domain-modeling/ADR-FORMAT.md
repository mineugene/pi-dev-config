# ADR Format

ADRs live in `docs/adr/`, or in the ADR directory selected by `GLOSSARY-MAP.md`.

## Naming

- File name: four-digit zero-padded sequence + `-` + kebab-case title + `.md`,
  for example `0001-event-sourced-orders.md`.
- Use the next number after the highest existing four-digit number in the
  target directory. Start at `0001` when the directory is empty.
- Create the directory only when the first ADR is accepted.

## Template

```md
# {Short title of the decision}

{One to three sentences covering the context, the decision, and the reason.}
```

Add status, considered options, or consequences only when they carry information
not already in those three sentences.

## When to create an ADR

Create an ADR when all three conditions hold:

1. The decision is hard to reverse.
2. The decision is surprising without its context.
3. The decision is the result of a real trade-off.

Otherwise do not create an ADR.
