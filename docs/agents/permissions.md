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

An `ask` result must fail closed when no dialog-capable UI exists. Interactive
approval offers allow once, allow for session, or deny. Session grants are scoped
to an exact operation and agent context. Approving an external file read grants its
containing directory; approving a directory-targeted read grants that directory
itself. If the target type cannot be determined, the grant remains exact-resource.
Grants are memory-only, cleared at session start, and never override a hard or
explicit denial.

## Bash authorization

Parsing lives in `infra/bash-parser.ts`. `domain/bash.ts` derives effects from the
parsed facts and owns Bash-specific hard or configured restrictions. Do not add a
second shell parser.

Unknown Bash asks unless `bypass` resolves the ask. A compound expression combines
every parsed command and redirect. Protected configured `bashGate.rules` remain restrictive
overlays; they cannot grant permission. Known catastrophic commands deny even in
bypass.

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
