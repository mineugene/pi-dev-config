# pi-dev-config

Domain language for this Pi configuration package: the planning and issue workflows of its bundled skills, and its model routing.

## Language

### Planning and issue workflows

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

### Model routing

**Task**:
One piece of user-requested work, with its follow-ups, that routing treats as a single unit. It ends at completion, a new request, a preset switch, a return to automatic routing, or shutdown.
_Avoid_: subtask

**Routing role**:
The semantic strength a task runs at: fast, base, escalated, or deep, or manual when the user selects an exact model. A routing preset maps each semantic role to a model and reasoning effort.
_Avoid_: tier, level

**Entry route**:
The routing role a task starts on, chosen from its risk before the first response.
_Avoid_: initial route, first pass

**Risk**:
The assessed chance that a cheaper routing role cannot finish a task without moving to a stronger one: low, uncertain, or high. Low must be earned by a simple request; the absence of risk signals alone means uncertain.
_Avoid_: difficulty, complexity score

**Risk signal**:
A cheap, explainable observation in a request that raises its risk: complexity (steps, files, scope), failure evidence (stack traces, compiler or test output, patches), or a sensitive topic (security, data loss, concurrency).
_Avoid_: heuristic

**Handover**:
Fast passing a task to base for the rest of the task, when execution evidence, a follow-up that is not low risk, or the fast turn limit shows the task is not simple.
_Avoid_: escalation, fallback

**Recovery**:
Moving a task up from base to escalated to deep when execution evidence crosses a threshold. It lasts only for the current task.
_Avoid_: escalation

**Correction**:
User feedback that the previous response was wrong or incomplete and needs rework. It is evidence that the current routing role is struggling, independent of tool failures.
_Avoid_: negative feedback, retry

**Stagnation**:
A development failure whose signature persists after a remediation attempt. Unlike an isolated compiler or test failure, it is evidence that the current routing role is struggling.
_Avoid_: repeated failure

**Task outcome**:
How a task ended: completed (an explicit acknowledgement or a finished to-do list), superseded (a new request arrived with nothing pending), unresolved (a correction or failure was still pending), or interrupted (a preset switch, a return to automatic routing, or shutdown).
_Avoid_: task status

**Successful task**:
A task whose outcome is completed or superseded. Routing is judged by its cost per successful task.
_Avoid_: completed task, when any success is meant

## Relationships

### Planning and issue workflows

- **Feature intake** produces a **Shared understanding**.
- `to-spec` turns a **Shared understanding** into a **Specification**.
- `to-tickets` splits a **Specification** into **Implementation issues**.
- **Blockers** determine which Implementation issues are on the **Frontier**.
- An **Issue tracker** stores Specifications and Implementation issues.
- A **Pull request** may reference Issues but does not replace them.
- `domain-modeling` maintains the **Domain glossary** and offers Architectural decision records when warranted.

### Model routing

- A **Task** has one **Entry route**, chosen from its **Risk**.
- **Risk signals** raise **Risk**; low **Risk** requires a simple request with no **Risk signal**.
- Automatic entry puts only low **Risk** on fast; uncertain and high **Risk** enter on base.
- Execution evidence outranks **Risk**: it triggers **Handover** from fast and **Recovery** beyond base.
- **Corrections** and **Stagnation** are execution evidence; an isolated development failure counts toward neither **Handover** nor **Recovery**.
- Automatic routing never moves a **Task** to a weaker **Routing role**, and **Recovery** never carries into the next **Task**.
- Every **Task** ends with one **Task outcome**.
