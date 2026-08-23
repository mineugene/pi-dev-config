# Permission and safety guidance

Read this when changing tool authorization, Bash classification, secret handling,
PR guards, signing, approval UI, or session grants.

Keep these concepts separate: operation normalization, configurable policy,
restrictive guard decisions, human approval, session grants, and display. A model
safety assertion is not a grant. Fail-safe behaviour belongs in code.

## Authorization flow

Use one flow for supported tool calls:

```text
normalize operation
→ derive effects
→ evaluate permission policy
→ compose restrictive guards
→ apply a narrowly scoped session grant
→ allow / ask / deny
```

The stable effects are `read`, `write`, `delete`, `process`, `network`,
`external-path`, `credential`, and `privileged`. Multi-effect operations take the
most restrictive decision, ordered `allow < ask < deny`.

`guarded` is conservative, `auto` is the default and permits routine project work,
and `bypass` is a permissive profile rather than an off switch: it resolves every
ask, but explicit denials and hard credential, privilege, catastrophic-operation,
secret, PR, and signing guards still apply.
The legacy `--yolo` flag starts the session in `bypass`; the shortcut can cycle away.

Global and project permission settings merge monotonically. A project may tighten
a global decision but cannot loosen it.

An `ask` result must fail closed when no dialog-capable UI exists. Read-only Bash
access under the immutable `/nix/store` is treated as a trusted external read.
Interactive approval offers allow once, allow for session, or deny. Session grants
are scoped to an agent context. Unknown Bash may grant executable-plus-subcommand
families after explicit human approval when no write, delete, network, external-path,
credential, privileged, ambiguous, or protected effect is present. A compound command
grants each unknown family independently; every later pipeline or chain component
must still be built-in allowed, configured allowed, or session-granted. Other Bash
and mutation grants remain exact-operation. Approving an external file read grants
its containing directory; approving a directory-targeted read grants that directory
itself. If the target type cannot be determined, the grant remains exact-resource.
Grants are memory-only, cleared at session start, and never override a hard or
explicit denial.

The permission adapter creates one private `pi-<session-id>-*` directory under the
OS temp directory at session start. Its exact canonical path is runtime-owned,
projected in permission guidance, and treated as session-local for direct file tools
and classified Bash path arguments. Canonical containment rejects symlink escapes.
The directory has mode `0700`, is removed at session shutdown, is not persisted, and
is recreated on resume. Each process owns its own directory; deny-policy Bash
restrictions still apply.

## Model guidance

Before every agent turn, the permission adapter projects a concise five-bullet
summary of the effective mode, effect decisions, common approval-free operations,
approval boundaries, and denial behaviour into the system prompt. The block is
rebuilt from runtime state, active tools, configured Bash restrictions, and the
current subagent policy. It omits session grants.

This guidance is advisory. The model should prefer genuinely lower-effect
alternatives, ask when the distinction is unclear, and stop pursuing an operation
after a hard denial. It must not evade a boundary with another spelling, wrapper,
or shell indirection. Authorization remains the enforcing source of truth.

## Bash authorization

Parsing lives in `infra/bash-parser.ts`. `domain/bash.ts` derives effects from the
parsed facts and owns Bash-specific hard or configured restrictions. Do not add a
second shell parser.

Unknown Bash asks unless `bypass` resolves the ask. A compound expression combines
every parsed command and redirect. `git restore --staged` and `git restore -S` are
routine index writes; plain restore, working-tree restore, and alternate-source
restore remain protected. CLI flags are matched case-sensitively. Protected
configured `bashGate.rules` remain restrictive overlays. Global user
`bashGate.allowRules` can classify extra routine command patterns, but project
positive rules are ignored and all protected rules still win. Known catastrophic
commands deny even in bypass.

Deny-policy subagents may run read-only classified Bash, but state-changing,
external-path, privileged, credential, or ambiguous Bash remains blocked.
Prompt-policy subagents use the parent approval broker. Parent session grants do
not flow into children.

## Other guards

`secretGuard`, `prGuard`, signing checks, and the permission engine are independent
restrictive layers. The permission normalizer reuses the secret guard's path and
Bash matchers to assign the hard `credential` effect even when supplemental secret
guard warnings or scrubbing are off. Registration order may short-circuit on a
block, but no later handler may turn another guard's denial into an allow. Do not weaken secret
protection, PR protections, signing behaviour, or subagent isolation.

Permission UI describes effects and targets, not internal IDs or session keys.
Real secret enforcement remains OS permissions, key isolation, and egress control.
