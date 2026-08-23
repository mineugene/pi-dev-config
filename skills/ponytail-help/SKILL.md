---
name: ponytail-help
disable-model-invocation: true
description: >
  Quick-reference card for Ponytail modes, skills, and commands. One-shot
  display, not a persistent mode.
---

# Ponytail Help

Display this reference card when invoked. Do not change or persist mode state.

## Runtime modes

| Mode      | Command            | Behaviour                                                        |
| --------- | ------------------ | ---------------------------------------------------------------- |
| **Off**   | `/ponytail off`    | Remove Ponytail runtime instructions.                            |
| **Lite**  | `/ponytail lite`   | Build what was asked and name a lazier alternative in one line.  |
| **Full**  | `/ponytail full`   | Enforce YAGNI, reuse, standard library, native, then minimum code. |
| **Ultra** | `/ponytail ultra`  | Prefer deletion and challenge unproven requirements.             |

`/ponytail` and `/ponytail status` report the current mode. The default is
`full`. A mode persists with its session branch until changed; resuming or
forking restores the newest mode on that branch. Child subagents start
independently at `full`.

Exact `stop ponytail` or `normal mode` also switches the runtime mode off.

## Skills

Invoke skills with `$skill:<name>`. Skills add task guidance but do not change
the extension-owned runtime mode.

| Skill               | What it does                                      |
| ------------------- | ------------------------------------------------- |
| **ponytail**        | Detailed minimal-code implementation guidance.    |
| **ponytail-review** | Review a diff for over-engineering.                |
| **ponytail-audit**  | Audit a repository for removable complexity.      |
| **ponytail-debt**   | Collect deliberate shortcuts into a debt ledger.  |
| **ponytail-gain**   | Show the published benchmark scoreboard.          |
| **ponytail-help**   | Show this card.                                    |
