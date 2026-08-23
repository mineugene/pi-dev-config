---
name: grill-with-docs
description: "Interview before implementing an underspecified feature or design, and record resolved domain language and durable decisions. Invoke when the user asks to build or implement something with material user-owned decisions still unresolved. Skip for fully specified or trivial work."
---

# Grill With Docs

Load and follow both the `grilling` and `domain-modeling` skills.

Inspect the repository before asking questions. Facts available from code, tests,
documentation, configuration, or external primary sources are the agent's job.
Ask the user only for decisions, preferences, constraints, and missing product
knowledge that could materially change the result.

Use the `grilling` design-tree rounds until the frontier is empty. While decisions
settle, use `domain-modeling` to update the applicable `CONTEXT.md` when domain
language changes and to offer an ADR only for a hard-to-reverse, surprising
trade-off. Do not create documentation merely to prove that the interview ran.

Do not implement while the interview is active. When the frontier is empty,
summarize the agreed behaviour, boundaries, unresolved risks, and testing seams.
Wait for the user to confirm the shared understanding.

After confirmation, offer these phase choices:

1. Implement now.
2. Load `to-spec`, show the draft, and publish it after confirmation.
3. Load `to-spec`, publish after confirmation, then load `to-tickets`, show the
   proposed issue graph, and publish it after a second confirmation.

Never create remote issues or begin implementation before the corresponding
choice is confirmed.
