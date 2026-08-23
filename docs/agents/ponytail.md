# Ponytail guidance

Read this when changing Ponytail modes, commands, prompt injection, persistence, status, skills, or documentation.

- `src/domain/ponytail.ts` owns pure modes, parsing, persistence validation, and prompt-block transformation.
- `src/adapters/ponytail.ts` owns the foreground runtime mode, events, `/ponytail`, optional natural-language deactivation, persistence and recovery, prompt injection, and status.
- `skills/ponytail/SKILL.md` contains workflow and intensity guidance. It is not the state machine.
- Auxiliary Ponytail skills are task workflows, not persistent core modes unless code explicitly says otherwise.

Ponytail does not load into subagent children by default. Foreground persistence must still follow the branch semantics in [stateful-features.md](./stateful-features.md).

Every Ponytail README claim must map to the runtime owner and a behavioural regression test.
