# Planning and Issue Workflows

Domain language shared by the feature-intake, specification, and issue-publishing skills bundled with this Pi configuration.

## Language

**Feature intake**:
The pre-implementation interview used when a requested feature still has material user-owned decisions. Repository facts are investigated by the agent rather than asked of the user.
_Avoid_: requirements guessing, assumption gathering

**Shared understanding**:
The confirmed outcome of feature intake: agreed behaviour, boundaries, risks, and testing seams. Implementation or publication starts only after the user confirms it.
_Avoid_: complete knowledge, perfect requirements

**Specification**:
The agreed feature contract produced by `to-spec`. It records the problem, user-facing solution, implementation decisions, testing decisions, and explicit exclusions.
_Avoid_: ticket, implementation plan

**Issue tracker**:
The service that stores project issues: Azure Boards, GitHub Issues, or Forgejo/Gitea issues. A project-specific workflow takes precedence over remote-based detection.
_Avoid_: backlog manager, backlog backend, issue host

**Issue**:
A tracked unit of work in an **Issue tracker**. Azure Boards calls it a work item; `to-tickets` retains its upstream command name but produces Issues.
_Avoid_: ticket, except when naming the `to-tickets` skill

**Implementation issue**:
An independently reviewable vertical slice produced by `to-tickets`. It delivers observable behaviour and fits in one fresh agent context.
_Avoid_: layer task, horizontal slice

**Blocker**:
An Issue that must finish before another Issue can start. A preferred ordering is not a blocker unless it prevents useful independent work.
_Avoid_: predecessor when discussing trackers generically

**Frontier**:
The set of open Issues whose blockers are complete. These Issues can be implemented next or in parallel.
_Avoid_: queue, backlog

**Pull request**:
A proposal to merge branch changes. It may use the same host and CLI as the Issue tracker, but it is a separate workflow and resource.
_Avoid_: Issue

**Domain glossary**:
A `CONTEXT.md` containing canonical project-specific terms and their relationships. It excludes implementation details, feature requirements, and general programming concepts.
_Avoid_: specification, architecture document

**Architectural decision record**:
A short record of an accepted decision that is hard to reverse, surprising without context, and based on a real trade-off.
_Avoid_: ADR for routine or easily reversed choices

## Relationships

- **Feature intake** produces a **Shared understanding**.
- `to-spec` turns a **Shared understanding** into a **Specification**.
- `to-tickets` splits a **Specification** into **Implementation issues**.
- **Blockers** determine which Implementation issues are on the **Frontier**.
- An **Issue tracker** stores Specifications and Implementation issues.
- A **Pull request** may reference Issues but does not replace them.
- `domain-modeling` maintains the **Domain glossary** and offers Architectural decision records when warranted.
