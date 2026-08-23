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

Track which issues block others. The **frontier** contains the issues whose
blockers are all resolved; these are ready to implement.

Communicate with subagents through context pointers to the specification,
issues, research notes, and prior commits. Do not duplicate content a pointer
already reaches.

## Steps

1. Read the specification and issues, and identify each issue's blockers.
2. When research would help, you can run one exploration subagent. Have it save
   Markdown notes outside the repository where later subagents can read them.
3. Create the integration branch. Open a draft pull request only when the
   tracker closes work through pull requests or the user asks for one, and only
   after the first merge in step 5.
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
7. When every issue is resolved, load `../code-review/SKILL.md` against the
   integration branch. Use one implementer subagent to fix every finding.
8. If a draft pull request exists, mark it ready for review. Otherwise resolve
   each issue through the tracker's workflow and report the integration branch.
9. Delete every implementer worktree.

## Output

Report the integration branch, each issue's resolution, and the pull request URL
when one exists.
