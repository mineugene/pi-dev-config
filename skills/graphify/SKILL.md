---
name: graphify
description: "Build, update, or query a persistent knowledge graph for a codebase or mixed corpus. Invoke only when the user asks to build, update, or query a graph, or after broad exploration requires graph lookup. Do not invoke merely because the user mentions graphify, names a skill, or writes 'skill <word>'. Requires the optional graphify CLI."
---

# Graphify

Use Graphify when the user asks to build, update, or query a knowledge graph, or when pi automatically queues it after broad codebase exploration.

## Prerequisites

Run `graphify --version` first. If it is unavailable, say that Graphify is an
optional dependency and provide the installation guidance from this package's
README. Do not install packages with pip.

## Action selection

Choose the command from the user's goal and the graph state. Do not ask the user
to choose among routine Graphify commands.

- Build when the target has no usable `graphify-out/` directory.
- Update when a graph exists and the user asks to refresh it, or the indexed
  corpus changed and the task needs current graph data.
- Query when the user asks a discovery or architecture question.
- Explain when the user asks about one named node; trace a path when they ask
  how two named nodes relate.
- Check, install, or remove hooks, and start watchers, only when explicitly
  requested.
- If the request has no goal, such as "use Graphify", ask what outcome the user
  wants. Otherwise choose the least invasive command that fulfils the goal.

Inspect the target for `graphify-out/` when build versus update is unclear.
Query an existing graph for discovery before updating it; update only when
freshness is needed. Build only when no usable graph exists.

## Commands

- Build a graph: `graphify .` or `graphify <path>`.
- Incrementally update: `graphify <path> --update`.
- Query: `graphify query "<question>"`.
- Trace a path: `graphify path "<node-a>" "<node-b>"`.
- Explain a node: `graphify explain "<node>"`.
- Check, install, or remove Graphify's post-commit hook: `graphify hook status`,
  `graphify hook install`, or `graphify hook uninstall`.
- Watch code changes: `graphify <path> --watch`.

Use a supplied path; otherwise use the current directory. Graphify writes its
results under `graphify-out/`. Report the output location and give a concise
summary of command output.

Do not install the post-commit hook or start a watcher without explicit user
approval. Do not add `graphify-out/` to `.gitignore` unless the user requests it.
