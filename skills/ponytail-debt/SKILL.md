---
name: ponytail-debt
disable-model-invocation: true
description: >
  Harvest existing shortcut comments in the codebase into a debt ledger, so
  deliberate shortcuts and deferrals get tracked instead of becoming
  permanent. Use when the user says "ponytail debt", "what did ponytail defer",
  "list the shortcuts", "ponytail ledger", or "what did we mark to do later".
  One-shot report, changes nothing.
---
# Ponytail Debt

Collect existing shortcut comments into one ledger. Do not add branded prefixes
to code comments.

## Scan

Run the following, skipping `node_modules`, `.git`, and build output:

```sh
grep -rnE '(#|//) ?(TODO|FIXME|HACK|XXX|debt|shortcut|temporary|naive|global lock)' .
```

Each hit is one ledger row.

## Output

One row per marker, grouped by file:

```text
<file>:<line>, <what was simplified>. ceiling: <the limit named>. upgrade: <the trigger to revisit>.
```

1. Take `ceiling` and `upgrade` from the comment when present.
2. To add an owner per row, run `git blame -L<line>,<line>`.
3. Tag every comment that names no upgrade path or trigger with `no-trigger`.
4. End with `<N> markers, <M> with no trigger.`
5. If no marker exists: `No deferred shortcut debt. Clean ledger.`

## Exclusions

- Read and report only. Change nothing.
- To persist the ledger, ask first; then write it to a file, for example
  `PONYTAIL-DEBT.md`.
- Do not change the Ponytail runtime mode.
