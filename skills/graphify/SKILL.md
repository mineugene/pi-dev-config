---
name: graphify
description: "Build, update, or query a persistent knowledge graph for a codebase or mixed corpus. Invoke only when the user asks to build, update, or query a graph, or after broad exploration requires graph lookup. Do not invoke merely because the user mentions graphify, names a skill, or writes 'skill <word>'. Requires the optional graphify CLI."
---
# Graphify

## Before starting

1. Run `graphify --version`. If it fails, show the installation guidance in this
   package's README, explain that Graphify is optional, and stop. Do not install
   packages with pip.
2. Work in the path supplied in `$ARGUMENTS`, or the current directory when no
   path is supplied. Graph files live in that directory's `graphify-out/`.
3. If `graphify --help` disagrees with a command below, follow its syntax.

## Authorisation

Run `graphify extract` or `graphify update` only when the user's arguments
explicitly request that operation. A missing graph, pending work, a query needing
fresh evidence, or a finished refactor does not authorise a refresh.

Run `graphify hook ...` or `graphify watch ...` only on explicit request and
after explicit user approval.

## Choose the command

Use the first matching case:

1. Code-only graph requested: run `graphify extract <path> --code-only`.
2. Full build or semantic/mixed refresh requested: run `graphify extract <path>`.
   Reuse incremental extraction and its cache; do not add `--force`.
3. Code refresh requested: run `graphify update <path>`. This uses local AST
   parsing, no LLM, and does not refresh non-code semantics.
4. `/graphify --update` requested: check `graphify-out/needs_update`. If it
   exists, run incremental `graphify extract <path>` and explain that semantic
   extraction can use LLM tokens. Otherwise run `graphify update <path>`.
5. Discovery or architecture question: run `graphify query "<question>"`.
6. One node named: run `graphify explain "<node>"`.
7. Two nodes named: run `graphify path "<node-a>" "<node-b>"`.
8. Hook status, install, or removal requested: run
   `graphify hook status|install|uninstall`.
9. Watcher requested: run `graphify watch <path>`.
10. Other arguments supplied: ask which operation to run.
11. No arguments supplied: report whether `graphify-out/graph.json` and
    `graphify-out/needs_update` exist, and list the available query and refresh
    operations. Run no graph command.

Choose routine query commands yourself rather than asking the user to choose.

## Before querying

Check `graphify-out/needs_update` and any recorded failures in
`graphify-out/.graphify_status.json`.

- If the marker exists, failures are recorded, or status cannot be read, treat
  graph results as leads and verify each conclusion against source files.
- An absent marker does not prove non-code content is current. Verify
  conclusions that depend on non-code content against source files.
- Users can run `/graphify status` in Pi for a local, token-free report. It does
  not invoke this skill or the CLI.
- This skill provides guidance; it does not intercept commands.

## Failures

1. On a refresh failure or unavailable model backend, report the failure. Leave
   the marker and pending work unchanged, and retry at most once.
2. Continue with existing graph leads and source verification.
3. Never delete the marker or claim freshness because a command exited 0.
4. If the marker remains after extraction, report it as pending or unconfirmed.

## Output

Report the output location under `graphify-out/` and summarise the command
output. Add `graphify-out/` to `.gitignore` only when the user requests it.
