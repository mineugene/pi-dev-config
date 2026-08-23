---
name: implement-spec
description: "Implement a specification and its tickets in code on one integration branch."
disable-model-invocation: true
---
# Implement Spec

## Inputs and goal

Use the specification from `to-spec`, the implementation issues from
`to-tickets`, and the configured issue tracker. Follow
[tracker-workflow.md](../tracker-workflow.md) to identify the tracker. If none
is configured, tell the user to run the setup flow and stop.

Implement the entire specification on one integration branch. Resolve every
issue through the tracker's documented workflow.

## Coordination

Track each issue's blockers. The **frontier** contains unstarted issues whose
blockers have all been implemented and merged into the integration branch.
These are ready to implement; tracker closure can wait for the final pull
request.

Start every subagent with a fresh context
(`inherit_context: false`, no `resume`). Run implementers in the background
(`run_in_background: true`) where possible.

Communicate with subagents through context pointers to the specification,
issues, research notes, and prior commits. Do not duplicate content a pointer
already reaches.

## Steps

1. Read the specification and issues, and identify each issue's blockers.
2. When research would help, you can run one exploration subagent. Save
   Markdown notes outside the repository where later subagents can read them.
   Use a write-capable subagent, or have read-only Explore return findings and
   write the notes from the parent.
3. Create the integration branch. Open a draft pull request only when the
   tracker closes work through pull requests or the user asks for one, and only
   after the first merge in step 5. Include the provider's closing references
   for the specification and implementation issues.
4. Run one implementer subagent per ready issue, each in its own worktree and
   branch. Have each implementer:
   1. Confirm its worktree is based on the integration branch, and reset onto it
      if not.
   2. Load `../tdd/SKILL.md` to build the issue.
   3. Merge the integration branch tip into its branch before reporting done.
5. Use a merger subagent to merge each completed implementer branch into the
   integration branch.
6. Identify the newly ready issues and run their implementers. Repeat until no
   issues are ready.
7. When every issue is implemented, load `../code-review/SKILL.md` against the
   integration branch. Use one fresh implementer subagent to fix every finding.
8. If a draft pull request exists, mark it ready for review. Otherwise resolve
   each issue through the tracker's workflow and report the integration branch.
9. Delete every implementer worktree.

## Output

Report the integration branch, each issue's resolution, and the pull request URL
when one exists.
