# Subagent guidance

Read this when changing feature tiers, agent prompts, tool allowlists, routing, grants, session data, or parent and child coordination.

Tier loading does not share state. Parent and child inheritance needs an explicit, tested path through session data, environment or config propagation, IPC, or an equivalent mechanism.

Do not infer that modes, grants, routing, session entries, tools, or UI state carry into a child. Define and test each data path. Preserve subagent isolation and explicit built-in tool allowlists.

The `core` feature tier runs in `PIDEV_SUBAGENT` children. Keep it limited to child-safe tools and gates. Foreground response-style prompts, persistent planning tools, and parent session controllers belong in `session` or `interactive` unless a specialised child design explicitly opts in.

Subagents have purpose-specific prompts. Do not inject the foreground `caveman-lite` block, Ponytail runtime-mode block, or persistent `todo` tool by default. Default specialised agents should keep `skills: false` and `inherit_context: false` where configured; do not broaden either without a demonstrated need and regression tests.

Keep background lifecycle state separate from LLM tool exposure. Once helper schemas are activated during a foreground session, activation is additive even after the current agent finishes. UI lifecycle state may still become idle or completed.
