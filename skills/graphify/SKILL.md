---
name: graphify
description: "Build, update, or query a persistent knowledge graph for a codebase or mixed corpus. Invoke only when the user asks to build, update, or query a graph, or after broad exploration requires graph lookup. Do not invoke merely because the user mentions graphify, names a skill, or writes 'skill <word>'. Requires the optional graphify CLI."
---

# Graphify

Run `graphify --version` first. If unavailable, say Graphify is an optional dependency and give the installation guidance from this package's README; do not install packages with pip. Use `graphify --help` if the installed version's command syntax differs from the commands below.

Pick the command from the goal and graph state; never ask the user to choose among routine commands. Use a supplied path, otherwise the current directory. Check for `graphify-out/graph.json` and `graphify-out/needs_update` in that project's directory.

Refresh and extraction require an explicit user request, subject to existing permissions. Never run them automatically because the graph is absent, a marker exists, a query needs fresh evidence, or refactoring has finished. With no goal, report graph/marker presence and the available query and refresh operations; do not start a build.

- Explicit build request: `graphify extract <path>`. Use `--code-only` for an explicitly code-only graph; otherwise semantic extraction can use LLM tokens.
- Explicit code refresh request: `graphify update <path>`. This uses local AST parsing, no LLM, and does not refresh changed non-code semantics.
- Explicit semantic or mixed-corpus refresh request: `graphify extract <path>`. Reuse incremental extraction and its cache; do not add `--force`.
- `/graphify --update`: an explicit refresh request. If `needs_update` exists, use incremental `graphify extract <path>` and state that pending semantic extraction can use LLM tokens. Otherwise use `graphify update <path>`. A marker's absence is not proof that all non-code content is current.
- Discovery or architecture question: `graphify query "<question>"`.
- One named node: `graphify explain "<node>"`. How two named nodes relate: `graphify path "<node-a>" "<node-b>"`.
- Hook check, install, or remove: `graphify hook status|install|uninstall`. Watcher: `graphify watch <path>`. Only on explicit request; these also need explicit user approval.

Before queries, check `needs_update` and any recorded failures in `graphify-out/.graphify_status.json`. Pending work, failures, or unreadable signals mean results may be stale: use the graph as leads and verify relevant source files before drawing conclusions. Users can run `/graphify status` in Pi for a local, token-free report; it does not invoke this skill or the CLI. A marker's absence is not proof of whole-graph freshness. Skill guidance is advisory, not enforced command interception.

On refresh failure or an unavailable model backend, report the failure, leave pending work intact, and do not retry repeatedly. Continue with stale graph leads and source verification when useful. Never delete the marker or claim freshness merely because a command exited successfully. Some Graphify versions leave the marker after extraction; report a remaining marker as pending or unconfirmed rather than silently clearing it.

Graphify writes results under `graphify-out/`; report the output location and a concise summary of command output. Do not add `graphify-out/` to `.gitignore` unless the user requests it.