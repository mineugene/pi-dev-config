# ADR Format

ADRs live in `docs/adr/` or the context-specific ADR directory selected by
`CONTEXT-MAP.md`. Use sequential names such as `0001-event-sourced-orders.md`.
Create the directory only when the first ADR is accepted.

## Template

```md
# {Short title of the decision}

{One to three sentences covering the context, decision, and reason.}
```

Add status, considered options, or consequences only when they add information.
Scan the target ADR directory for the highest existing number and increment it.

Create an ADR only when the decision is hard to reverse, surprising without
context, and the result of a real trade-off. Easy, obvious, or forced decisions
do not need ADRs.
