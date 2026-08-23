---
name: handoff
description: Compact the current conversation into a handoff document for another agent to pick up.
argument-hint: "What will the next session be used for?"
disable-model-invocation: true
---
# Handoff

## Procedure

1. Choose a temporary directory outside the workspace: use `$TMPDIR` when set,
   otherwise `/tmp` on Unix or `%TEMP%` on Windows.
2. Use `$ARGUMENTS` as the focus when supplied. Otherwise use the work in the
   current conversation.
3. Write one document in the temporary directory with these sections in order:
   - `## Goal`: what the next session needs to accomplish.
   - `## State`: what is done, in progress, and blocked.
   - `## Next actions`: ordered actions, each naming its target path.
   - `## Suggested skills`: the skills the next agent needs to load.
   - `## References`: paths or URLs for existing artifacts.
4. Reference each artifact by path or URL rather than restating its content.
5. Remove API keys, passwords, secrets, credentials, and personally identifiable
   information before writing the document.

## Output

Report the absolute path of the written document.
