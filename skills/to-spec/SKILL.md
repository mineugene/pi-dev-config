---
name: to-spec
description: "Turn agreed conversation context into a specification and publish it after confirmation."
disable-model-invocation: true
---
# To Spec

Do not restart the requirements interview. Use only what is already agreed.

1. Read the relevant code. Follow [domain-docs.md](../domain-docs.md) to find
   the glossary and architectural decision records, and read those covering the
   change.
2. Choose the highest public testing seam that covers the change.
   - Use an existing seam when one covers the change; otherwise use the highest
     new seam.
   - Use the fewest seams that cover the change.
3. Show the chosen seam and ask the user to confirm it. If two equally high
   seams are unresolved, ask the user to choose one.
4. Load `../spec/SKILL.md` and draft `title` and `body` with its template and
   rules.
5. Select the provider with [tracker-workflow.md](../tracker-workflow.md) and
   read only the guide it names.
6. Print `title` and `body`, and wait for confirmation before publishing.
7. Publish with the provider guide from step 5.
8. Apply the label `ready-for-agent` only when project policy defines that label.
