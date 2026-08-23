---
name: graphify
disable-model-invocation: true
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
4. `/graphify --update` requested: run `graphify update <path>`. If the user
   also wants non-code content refreshed, run incremental `graphify extract
   <path>` and explain that semantic extraction can use LLM tokens.
5. Discovery or architecture question: run `graphify query "<question>"`.
6. One node named: run `graphify explain "<node>"`.
7. Two nodes named: run `graphify path "<node-a>" "<node-b>"`.
8. Hook status, install, or removal requested: run
   `graphify hook status|install|uninstall`.
9. Watcher requested: run `graphify watch <path>`.
10. Other arguments supplied: ask which operation to run.
11. No arguments supplied: report whether `graphify-out/graph.json` exists, and list the available query and refresh
    operations. Run no graph command.

Choose routine query commands yourself rather than asking the user to choose.

## Freshness

Graphify's own git hook and `graphify pi guard` manage freshness. Do not read
or delete marker files. This skill provides guidance; it does not intercept
commands.

## Failures

1. On a refresh failure or unavailable model backend, report the failure and
   retry at most once.
2. Continue with existing graph results, and verify conclusions against source
   files when a refresh failed.
