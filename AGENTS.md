# pi-dev-config

Pi coding-agent package: extensions and config resources that shape the harness.

## Architecture

`src/` is an onion; `src/architecture.test.ts` enforces dependency direction.

- `domain/`: pure, state-independent parsing, classification, validation, formatting, and transitions. No Pi runtime or I/O. Pi references must be `import type`.
- `infra/`: I/O and external mechanisms. It may import domain, never adapters.
- `adapters/`: Pi hooks, commands, tools, UI, and mutable runtime state.
- `adapters/registry.ts`: the feature and process-tier source of truth.
- `index.ts`: loads config and registers active features.

Feature tiers are:

- `core`: every Pi process, including headless and subagent children;
- `session`: full foreground sessions, including non-interactive ones;
- `interactive`: terminal and UI only.

Keep `core` child-safe. When changing tiers, subagents, agent prompts, tools, inheritance, or parent-child coordination, read [`docs/agents/subagents.md`](docs/agents/subagents.md).

## State and prompts

Every user-visible behaviour has one authoritative owner. Distinguish configured defaults, current runtime state, and persisted state. Code owns transitions, persistence, permissions, and side effects; prompts, skills, docs, and status only project them.

When changing state, persistence, mutable prompts, commands, skills, status, resume, or fork behaviour, read [`docs/agents/stateful-features.md`](docs/agents/stateful-features.md).

When changing Ponytail, read [`docs/agents/ponytail.md`](docs/agents/ponytail.md). When changing tmux tracking, read [`docs/agents/tmux-session-tracking.md`](docs/agents/tmux-session-tracking.md).

## Permissions

Do not conflate policy classification, reviewer decisions, human approval, cached grants, and display. A model assertion is never a grant. Protected policy wins, unknown Bash commands prompt, and project config cannot weaken built-in boundaries.

When changing Bash authorization, secrets, PR guards, signing, approval UI, or grants, read [`docs/agents/permissions.md`](docs/agents/permissions.md).

## Changes and tests

1. Put pure logic in domain, I/O in infra, and Pi state or hooks in adapters.
2. Register each feature once in `adapters/registry.ts`.
3. Add behavioural tests before documenting stateful behaviour.
4. Reuse existing code and keep one source of truth.

Run `npm ci` once, then `npm run check` (Biome, TypeScript, architecture, Vitest).

## Repository specifics

- New config options normally need only a `PiDevConfig` field; change `src/infra/config.ts` merge code only for merge-policy changes.
- `keybindings.json` installs at `~/.pi/agent/keybindings.json`.
- `settings.example.json` starts `~/.pi/agent/settings.json`.
- `prompts/` and `skills/` are bundled through `package.json`'s `pi` field.

## Conventions

- TypeScript ESM uses `.ts` specifiers and `import type` for type-only imports.
- Pi core packages are peer dependencies and must never be bundled.
- Use Canadian English. Do not use em or en dashes in code.
- Co-locate tests with source.
- Prefer the smallest design with one clear source of truth.
