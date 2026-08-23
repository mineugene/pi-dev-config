---
name: graphify
description: "Build, update, or query a persistent knowledge graph for a codebase or mixed corpus. Invoke only when the user asks to build, update, or query a graph, or after broad exploration requires graph lookup. Do not invoke merely because the user mentions graphify, names a skill, or writes 'skill <word>'. Requires the optional graphify CLI."
---

# Graphify

Run `graphify --version` first. If unavailable, say Graphify is an optional dependency and give the installation guidance from this package's README; do not install packages with pip.

Pick the command from the goal and graph state; never ask the user to choose among routine commands. Check for a usable `graphify-out/` to decide build versus update; use a supplied path, otherwise the current directory.

- No usable `graphify-out/`: build with `graphify <path>`.
- Refresh request, stale corpus, or no goal at all: `graphify <path> --update`.
- Discovery or architecture question: `graphify query "<question>"`.
- One named node: `graphify explain "<node>"`. How two named nodes relate: `graphify path "<node-a>" "<node-b>"`.
- Hook check, install, or remove: `graphify hook status|install|uninstall`. Watcher: `graphify <path> --watch`. Only on explicit request; these also need explicit user approval.

Prefer query over update; update only when freshness is needed. Graphify writes results under `graphify-out/`; report the output location and a concise summary of command output. Do not add `graphify-out/` to `.gitignore` unless the user requests it.