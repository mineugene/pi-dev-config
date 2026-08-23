---
name: grill-with-docs
description: "Interview before implementing an underspecified feature or design, and record resolved domain language and durable decisions. Invoke when the user asks to build or implement something whose user-owned decisions are not all resolved. Skip when the request fully specifies the work or changes at most one file."
---
# Grill With Docs

1. Inspect the repository before asking any question: code, tests,
   documentation, configuration, and external primary sources.
2. Ask the user only for decisions, preferences, constraints, and product
   knowledge that no repository source answers.
3. Follow the `grilling` rounds until no ready decisions remain.
4. While decisions settle, use `domain-modeling` to update the applicable
   `GLOSSARY.md` when domain language changes.
5. Offer an ADR only for a hard-to-reverse, surprising trade-off.
6. Do not write documentation whose only content is that the interview happened.
7. Do not implement while the interview is active.

## Output

Summarize agreed behaviour, boundaries, unresolved risks, and testing seams.
Wait for the user to confirm the shared understanding.

After confirmation, offer exactly these three choices:

1. Implement now.
2. Load `to-spec`, show the draft, and publish it after confirmation.
3. Load `to-spec`, publish after confirmation, then load `to-tickets`, show the
   proposed issue graph, and publish it after a second confirmation.

Never create remote issues or begin implementation before the corresponding
choice is confirmed.
