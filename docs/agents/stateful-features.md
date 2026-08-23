# Stateful feature guidance

Read this when changing user-visible state, persistence, prompts, commands, skills, or status UI.

## Define the state model first

Before changing a stateful feature, define:

1. valid and default states, plus transition events;
2. the authoritative owner and lifetime: hook, turn, process, session branch, project, or global;
3. persistence, recovery, resume, fork, and child-process semantics;
4. every projection: adapter, domain, config, prompt, skill, status UI, and README.

Configured defaults, current runtime state, and persisted state are distinct. Prompts, skills, README text, comments, and status labels only project state. Code must own every claimed transition, persistence rule, permission, or side effect. Model instructions cannot implement one.

## Persistence and prompt mutation

For conversation-local state, use feature-specific Pi session entries with a narrow validated payload. Ignore malformed and unknown entries. Restore the newest valid entry on the active branch, and make fork behaviour intentional.

A mutable prompt feature owns explicit delimiters. On every build, remove its old block, derive zero or one block from authoritative state, then append it. Repeated builds must be idempotent, and transitions must remove stale instructions.

## Commands, skills, and status

Commands may mutate adapter-owned state. Skills are instructions and do not mutate runtime state unless code delegates them to the command owner. Do not create two controllers for one mode.

Status is output, not storage. Keep independently determined facts separate, such as mode and activity. Track outstanding background work explicitly. Main-agent completion does not mean the session is idle while background work remains.

For child-process inheritance and tool exposure, also read [subagents.md](./subagents.md).

## Behavioural tests and claims

Test public seams before documenting stateful behaviour. Cover the default, transition, reflected next hook, resume, fork, disable cleanup, and repeated-hook idempotence. Add negative natural-language transition cases and overlapping background-work cases where relevant.

When adding claims such as `always`, `persists`, `inherits`, `enabled`, `idle`, or `approved`, identify the backing data, mutator or event, persistence and recovery path, and regression test. If behaviour is advisory model guidance only, say so.

Search `README.md`, `AGENTS.md`, `skills/`, `prompts/`, and `src/` for stale claims and duplicate state vocabulary after a change.
