# Permission and safety guidance

Read this when changing Bash authorization, secret handling, PR guards, signing, approval UI, or cached grants.

Keep these concepts separate: command classification, policy, reviewer decision, human approval, cached or session approval, and display. A model safety assertion is not a grant. Fail-safe behaviour belongs in code.

Do not weaken secret protection, Bash authorization, PR protections, signing behaviour, or subagent isolation. Permission UI describes effects, not internal IDs or session keys.

## Bash authorization

Policy outcomes are protected, routine allowlisted, and unknown. Protected wins. Run a compound expression unattended only when every executable command is allowlisted and no protected construct matches.

The allowlist describes routine intent, not binary safety. Unknown commands prompt. Project config may add protected rules but cannot weaken built-in boundaries.

For Bash path searches, prefer `fd` when installed. Search-tool command-execution flags require approval.
