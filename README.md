# pi-dev-config

A personal [pi](https://pi.dev) coding-agent package for a vim-flavoured,
fff-powered workflow. It bundles extensions, prompt templates, keybindings, a
Tokyo Night theme, and the Ponytail skill suite. Every extension is optional.
Forgejo is the source of truth; GitHub is a read-only mirror.

## Installation

### Home Manager

Add the repository to your flake inputs:

```nix
pi-dev-config = {
    url = "git+https://git.eugenemin.xyz/mineugene/pi-dev-config.git";
    inputs.nixpkgs.follows = "nixpkgs";
};
```

Import its Home Manager module:

```nix
imports = [ inputs.pi-dev-config.homeModules.default ];
```

The module enables pi, writes the bundled keybindings, selects the bundled
`tokyo-night` theme, and installs this package from Forgejo on first startup. After
rebuilding, start `pi` and run `/login`.
Git, npm, and `rtk` must be available on `PATH`. tmux is optional; multi-session
tracking activates only for Pi processes launched inside tmux.

### Manual

Requires Linux, Git, [pi](https://pi.dev), Node.js 22.19 or newer, and npm:

```bash
git clone https://git.eugenemin.xyz/mineugene/pi-dev-config.git ~/pi-dev-config
cd ~/pi-dev-config
nix develop # NixOS only
```

Install the package and user config:

```bash
npm ci
pi install .
mkdir -p ~/.pi/agent
ln -sfn "$PWD/keybindings.json" ~/.pi/agent/keybindings.json
cp -n pidev.json.example ~/.pi/agent/pidev.json
```

Select `tokyo-night` in `/settings`, then start `pi` in any project. The theme keeps
the editor border colour fixed across thinking levels. To try this checkout without
registering it:

```bash
pi --no-extensions -e ./src/index.ts
```

## Configuration

Configuration is optional. pi-dev-config reads:

- `~/.pi/agent/pidev.json` for global settings.
- `<project>/.pi/pidev.json` for project settings.

Project settings override global scalars. Objects merge by key and lists are
unioned, so a global restriction remains active in projects. Copy the starter
instead of symlinking it so it stays editable.

The starter disables nothing, so `rtk` and `caveman` load by default. Add names
to `disable` only when you want to turn features off.

```json
{
    "disable": [],
    "notifications": { "mode": "both" },
    "timer": { "enabled": true },
    "promptSlim": { "enabled": true },
    "web": {
        "search": { "limit": 5 },
        "read": { "maxTokens": 6000, "maxResponseBytes": 2097152, "timeoutMs": 10000 }
    },
    "read": {
        "grepGateKb": 256,
        "grepGateBypass": ["pdf", "*.wasm"]
    },
    "routing": {
        "defaultPreset": "general",
        "presets": {
            "general": {
                "base": { "model": "openai/gpt-5.6-terra", "thinkingLevel": "high" },
                "fast": { "model": "openai/gpt-5.6-luna", "thinkingLevel": "low" },
                "deep": { "model": "openai/gpt-5.6-sol", "thinkingLevel": "max" }
            }
        },
        "failureThreshold": 2,
        "correctionThreshold": 2,
        "cacheTtlMinutes": 5
    },
    "bashGate": {
        "rules": [
            { "cmd": "terraform", "subcommands": ["apply", "destroy"] },
            { "redirects": "any-write" }
        ]
    }
}
```

| Setting | Purpose |
| --- | --- |
| `disable` | Feature names to skip. Names appear in code font in the feature reference below. |
| `vim.enabled` | Enable the experimental modal normal/insert editor. Vim-style keybindings work without it. |
| `promptSlim.enabled` | Omit generic Pi documentation guidance on coding turns. Default: `true`; `/pi` restores it for Pi-help questions. |
| `autocompleteMaxVisible` | Pi setting for visible completion rows (3-20). Set `20` to browse matching skills; use Up/Down to scroll the list. Run `/skill-info` for full descriptions and argument usage. |
| `compaction.keepRecentTokens` | Pi setting in `settings.json`. The starter keeps 16k recent tokens, down from Pi's 20k default; auto-compaction and the 16,384-token response reserve remain enabled. |
| `statusline.command` | Append one command's stdout as an extra status-line row. |
| `statusline.palettes.<theme>` | Set `outer` and `inner` pill backgrounds per Pi theme, each as `{ rgb: [red, green, blue], ansi256 }`. Invalid or missing palettes use Pi theme tokens. |
| `sessionTracker.needsInputModel` | Small model ID for narrow required-input classification. Defaults to `fast` in the default routing preset. |
| `timer.enabled` | Show elapsed time beside Working and hidden or visible Thinking labels. Default: `true`. |
| `web.search` | Public search uses Brave Search. Set `WEB_SEARCH_API_KEY`; `limit` defaults to 5 and caps at 10. Search returns only result metadata. |
| `web.read` | Static reader limits: output defaults to 6,000 estimated tokens and caps at 12,000; responses default to 2 MiB and 10 seconds. |
| `read.grepGateKb` | Redirect large unbounded reads to grep first. `0` disables the gate. |
| `read.grepGateBypass` | File extensions that bypass the read gate. |
| `commitSign` | Set `mode` to `warn`, `confirm`, or `block`, and tune `minTimeoutSec`. |
| `bashGate.rules` | Add protected command, subcommand, flag, or write-redirection rules. These can only make policy stricter. |
| `graphify.enabled` | Enable `/graphify` and automatic exploration detection. Default: `false`; requires the optional `graphify` CLI. An existing `graphify-out/graph.json` adds a query-first policy to parent and child agents. After 12 `read`/`grep`/`find` calls across 6 paths, the parent queues one graph build for the current project. |
| `notifications.mode` | Use `off`, `bell`, `desktop`, or `both`. Default: `both`. |
| `checkpoints.enabled` | Disable edit/write snapshots when set to `false`. |
| `subagents.<type>.model` | Explicitly override the model for an agent type such as `explore`. |
| `routing.defaultPreset` | Named preset activated for new sessions. A preset selected with `/routing-preset` is restored with that session. |
| `routing.presets.<name>.base` | Required baseline model for a named preset and `/routing-auto`. Use a model-id string or `{ model, thinkingLevel }`. |
| `routing.presets.<name>.fast` | Optional cheap first response for simple tasks. Complex prompts and continuations move to base. |
| `routing.presets.<name>.deep` | Optional escalation model after repeated base failures or correction feedback. |
| `routing.failureThreshold` | Consecutive failed base turns before deep escalation. Default: `2`. |
| `routing.correctionThreshold` | Correction requests within one task before deep escalation. Default: `2`. |
| `routing.cacheTtlMinutes` | Keep a warm higher-tier model before de-escalating. `0` disables. Default: 5 minutes; with `PI_CACHE_RETENTION=long`, direct OpenAI uses 24 hours and Anthropic uses 1 hour. |
| `secretGuard` | Configure `mode`, extra `paths`, `scrubFrom`, `runSecretsDir`, and `minSecretLen`. |

### Web research

Set `WEB_SEARCH_API_KEY` for Brave Search, then use progressive retrieval:

```text
web_search({ query: "Node.js permission model changes" })
→ inspect compact results
web_read({ url: "https://…", query: "breaking changes and migration", maxTokens: 3000 })
```

`web_search` never downloads result pages. `web_read` fetches one explicit HTTP(S)
page, strips static page chrome, ranks heading sections for `query`, and reports when
its bounded result was truncated.

### Bash authorization

Bash commands receive one classification: protected, routine allowlisted, or
unknown. Protected rules always win. Unknown commands require approval, and a
compound expression runs unattended only when every executable component is
allowlisted. `bashGate.rules` adds protected rules; project config cannot add
allow rules or weaken built-in protection.

The allowlist represents routine developer intent, not proof that a binary is
safe. It trusts installed tools and normal project test/build code. Bash Gate is
not a sandbox or malware detector.

Routing preset names are arbitrary object keys. Run `/routing-preset [name]` to switch
all three roles together; omit the name for a picker. When invoked during work, it
confirms the selected preset and applies it after that work finishes. Successful
selections persist with the session. The legacy flat `routing.base`, `routing.fast`,
and `routing.deep` form remains supported.

Routing model values match available `models.json` ids. Simple tasks get one fast
response; tool continuations and user follow-ups move to the base. Debugging,
multi-step work, reviews, implementation, and refactors start on base. Repeated base
failures and repeated user-requested corrections escalate independently to deep. Use
`provider/id` when an id exists under more than one provider.

The router never de-escalates within a subtask. Across task boundaries it keeps a
higher-tier model while that model's prompt prefix should still be warm, then permits
a downshift after `cacheTtlMinutes`. A manual model change pauses automatic switches
until the current subtask ends. Run `/routing-auto` to clear an override immediately
and return to the configured base (or session-start model), without restarting pi.
Completed `todo` plans provide an exact boundary, with explicit completion or a
non-continuation user instruction as the fallback.

`secretGuard` reduces accidental disclosure; it is not a security boundary. Use
OS permissions, key isolation, and egress controls for enforcement.

## Features

### Editing and navigation

- **Files and search** (`fileMention`, `search`): `@` fuzzy-searches files and
  directories; `grep` and `find` provide fff-backed content and path search.
  Search defaults to at most 20 results and marks output truncated at 20,000 characters.
- **Context references** (`atMentionContext`, `inlineReferences`): attach
  `$skill:name` or `$prompt:name` as hidden context and expand `@file:10-20` ranges.
- **Quieter reads** (`read`): collapse read output and route large unbounded files
  through grep first.
- **Web research** (`web`): `web_search` returns compact Brave Search metadata only.
  Choose a source, then call `web_read` for one static page as clean bounded Markdown.
  Give `web_read` a `query` for section-focused extraction and a smaller `maxTokens`
  when enough. Search results are never fetched automatically. JavaScript-rendered pages,
  PDFs, private-network URLs, and non-text content are unsupported.
- **Vim editing** (`vim`): install vim-style keybindings, with an optional modal
  normal/insert editor.
- **External editor and help** (`help`): `Ctrl+G` opens the prompt in `$VISUAL` or
  `$EDITOR`; `/help` shows the resolved editor and active keybindings.
- **Paste handling** (`paste`): collapse multi-line pastes into editable placeholders.

### Workflow

- **Plans** (`todo`): maintain a live task list and print it with `/todos`.
- **Lazy tools** (`lazyTools`): keep `Agent`, `todo`, `commit`, questions, and
  subagent helpers out of the initial schema set. `search_tools` enables matching
  tools additively for the session; core coding and safety tools remain active.
- **Context audit** (`contextAudit`): `/context-audit` reports prompt, skill, tool,
  conversation, and session counts without making a model request.
- **Model routing** (`routing`): use fast for one simple response, base for complex or
  continuing work, and deep after repeated failures or corrections. Warm-prefix leases
  prevent needless de-escalation churn. `/routing-preset` swaps named model sets and
  `/routing-auto` clears a manual model override; the footer shows the preset, role,
  and model.
- **Subagents** (`subagents`): run parallel or isolated agents and inspect them with
  `/agents`; custom agents load from `.pi/agents/*.md`.
- **Checkpoints** (`checkpoints`): snapshot pi edits and restore them with `/rollback`.
- **Graphify** (`graphify`): opt-in `/graphify` command and automatic parent/subagent graph-use policy when `graphify-out/graph.json` exists.
- **Commit and PR flows** (`commit`, `commitSign`, `prGuard`): create Conventional
  Commits and pull requests through `/commit` and `/pr`, with signing and mutation gates.
- **Questions** (`question`): ask structured multiple-choice questions with a free-text
  fallback.

### Visibility

- **Effort selection** (`effort`): choose with `/effort` or `Alt+E`, or set a level
  directly with `/effort off|minimal|low|medium|high|xhigh|max`.
- **Status line** (`statusline`): show the routing profile and route, model, thinking
  level, context, tokens, cost, project root, Git branch, modes, and right-aligned
  session activity. Lower-priority details hide on narrow terminals. Per-theme
  palettes can retain theme-specific status-bar backgrounds.
- **tmux session tracker** (`sessionTracker`): self-register Pi panes, report live
  attention state, recover from tmux metadata, and navigate with `/pi-sessions`,
  `/next-session`, or `Ctrl+Shift+N`.
- **Elapsed timers** (`timer`): show live, human-friendly durations beside Working and
  both hidden and visible Thinking blocks.
- **Working animation** (`workingIndicator`): replace the inline Working spinner with a
  custom Braille animation.
- **Codex quota** (`tokenCount`): show OpenAI Codex usage and reset times.
- **Usage dashboard** (`usageDashboard`): inspect provider, model, token, cost, and
  quota data with `/usage`.
- **Notifications** (`notifications`): use the terminal bell, `notify-send`, or both
  for turn completion and confirmation prompts.

### Guardrails and prompt control

- **Bash gate** (`bashGate`): allow routine developer commands; require approval
  for protected or unknown shell operations using tree-sitter parsing.
- **Secret guard** (`secretGuard`): block secret-file reads and scrub learned secret
  values from tool output.
- **Prompt normalization** (`promptNormalization`): strip trailing whitespace from
  user prompts.
- **Pi prompt slimming** (`promptSlim`): omit generic Pi help guidance on coding
  turns; `/pi` restores it for Pi-specific questions.
- **RTK** (`rtk`): rewrite bash commands through an installed `rtk` CLI to reduce tool
  output tokens.
- **Caveman-lite** (`caveman`): keep routine responses terse while preserving detail
  for explanations, confirmations, and security warnings.
- **Ponytail** (`ponytail`): enforce minimal-code policy with session-scoped `off`,
  `lite`, `full`, and `ultra` modes. `/ponytail` changes the authoritative mode;
  the newest mode is restored when its foreground session branch resumes. Child
  subagents do not receive the foreground Ponytail prompt block.

### Commands

- `/help`: active keybindings and external editor.
- `/context-audit`: current prompt, tool, conversation, and session footprint.
- `/pi [question]`: ask about Pi with its bundled documentation guidance restored.
- `/graphify [path|query ...]`: invoke the opt-in Graphify skill.
- `/commit`, `/pr`: Conventional Commit and pull-request flows.
- `/todos`: current plan.
- `/skill-info [name]`: browse full skill descriptions, instructions, and argument usage.
- `/effort [level]`: select or directly set the model effort level.
- `/routing-preset [name]`: select a named fast/base/deep model set after current work finishes.
- `/routing-auto`: clear a manual model override and restore the preset base.
- `/ponytail [off|lite|full|ultra|status]`: show or set the session Ponytail mode.
  Exact `stop ponytail` and `normal mode` also switch it off.
- `/agents`: subagent fleet and conversation viewer.
- `/rollback`: restore a checkpoint and optionally fork the conversation.
- `/usage`: cost, token, and quota dashboard.
- `/pi-sessions`: attention-sorted picker for tracked Pi panes.
- `/next-session`: focus the next tracked pane; `Ctrl+Shift+N` is the shortcut.
- `/hotkeys`: pi's built-in shortcut list.

## tmux multi-session tracking

Each parent Pi process launched inside tmux registers its `TMUX_PANE` with a
host-local, disposable daemon. tmux remains authoritative for sessions, windows,
panes, focus, layouts, working directories, and process lifetime. The tracker
holds only reconstructible metadata and these four states, in attention order:

1. `needs-permission`: a real Bash Gate prompt is waiting for a person.
2. `needs-input`: useful work is blocked on a required answer or choice. Explicit
   deterministic phrases are handled locally; `sessionTracker.needsInputModel` or
   the default routing preset's `fast` model classifies other endings and fails back
   to `idle`.
3. `working`: the main agent or at least one background subagent is active.
4. `idle`: no work or required input is outstanding.

The custom footer appends a plain-text summary after the Ponytail mode pill:

```text
sessions: 1 working, 4 idle
```

Only nonzero state categories appear. Permission and input waits stay distinct
from idle when present. The daemon writes its compact projection to:

```text
/tmp/pi-dev-config-<uid>/session-tracker.status
```

A tmux status bar can read that file without opening a socket on each redraw.
The bundled `pi-session-tracker` helper supports `focus-next`, `focus-pane`,
`snapshot`, and `shutdown`; the public Nix configuration binds tmux prefix + `a`
to `focus-next`.

Pi mirrors recovery hints onto pane-scoped tmux options:

```text
@pidev_agent  @pidev_state  @pidev_runtime  @pidev_session
@pidev_cwd    @pidev_title  @pidev_role     @pidev_group  @pidev_parent
```

Inspect them with `tmux show-options -p -t %1`. `/name` supplies the optional
pane title; `PIDEV_AGENT_TITLE`, `PIDEV_AGENT_ROLE`, `PIDEV_AGENT_GROUP`, and
`PIDEV_PARENT_PANE` can supply annotations. These options are not a database.
After a daemon restart, they seed a short-lived snapshot until live heartbeats
confirm it. Missing heartbeats and dead tmux panes are pruned.

The socket, bounded log, and status file live under
`/tmp/pi-dev-config-<uid>/`. Clients start the daemon lazily and re-register on
heartbeat after a restart. If the daemon fails, Pi and tmux continue normally;
the session pill hides until the tracker returns. Disable only this feature with
`"disable": ["sessionTracker"]`.

## Skills

The package bundles a small Ponytail code-quality suite and selected skills from
[Matt Pocock Skills](https://github.com/mattpocock/skills). Invoke a skill explicitly
with `$skill:<name>`. Model-invoked skills activate only for their documented,
intent-specific requests; a bare skill name or `skill <word>` is discussion, not an
invocation. The imported Matt Pocock material is MIT-licensed; see
[`skills/mattpocock-skills.LICENSE`](./skills/mattpocock-skills.LICENSE).

### Model-invoked

- [`diagnosing-bugs`](./skills/diagnosing-bugs/SKILL.md): investigate reported bugs,
  failures, and performance regressions with an evidence-first loop.
- [`graphify`](./skills/graphify/SKILL.md): build, update, and query persistent knowledge graphs. It requires the optional `graphify` CLI and is available through `/graphify` only when `graphify.enabled` is `true`.
- [`ponytail`](./skills/ponytail/SKILL.md): Ponytail implementation guidance. The
  foreground `ponytail` extension owns and persists its runtime mode; loading this skill
  adds context but does not change that mode.
- [`grilling`](./skills/grilling/SKILL.md): stress-test a plan, decision, or idea with
  a round-based design-tree interview.
- [`tdd`](./skills/tdd/SKILL.md): guide a test-first red-green loop at agreed public
  seams.
- [`code-review`](./skills/code-review/SKILL.md): review a diff against repository
  standards and its originating specification in parallel.

### User-invoked

These remain available through `/skill:<name>` but are hidden from the baseline
model skill catalogue.

- [`grill-me`](./skills/grill-me/SKILL.md): explicitly start the `grilling`
  design-tree interview.
- [`to-spec`](./skills/to-spec/SKILL.md): synthesise the current conversation into a
  publishable feature specification.
- [`handoff`](./skills/handoff/SKILL.md): save a concise, redacted session handoff for
  a fresh agent.
- [`quick-commit`](./skills/quick-commit/SKILL.md): commit intended changes directly
  when the user explicitly requests the lightweight workflow.
- [`ponytail-audit`](./skills/ponytail-audit/SKILL.md): rank repo-wide code that can
  be deleted or simplified. Read-only.
- [`ponytail-review`](./skills/ponytail-review/SKILL.md): review a diff only for
  over-engineering. Read-only.
- [`ponytail-debt`](./skills/ponytail-debt/SKILL.md): collect deliberate shortcut
  comments into a debt ledger. Read-only.
- [`ponytail-gain`](./skills/ponytail-gain/SKILL.md): show the published Ponytail
  benchmark scoreboard.
- [`ponytail-help`](./skills/ponytail-help/SKILL.md): show modes, commands, and skill
  usage.

## Development

### Environment

The Nix dev shell provides Node.js 22, npm, just, nixfmt, and the commit hooks:

```bash
nix develop
just install
just lint
```

For automatic shell loading and hook installation, install `direnv` with
`nix-direnv` and run `direnv allow`. Use `just --list` to see all recipes.

Useful commands:

- `just ci`: run the clean install and checks used by CI.
- `just lint`: run source, formatting, and type checks without reinstalling.
- `just test`: run the test suite once.
- `just coverage`: run the test suite with text, HTML, and LCOV coverage reports. Open `coverage/index.html` locally; `coverage/lcov.info` is machine-readable.
- `just ci-coverage`: generate CI coverage files: `coverage/lcov.info` and `coverage/cobertura-coverage.xml`.
- `just fmt`: apply safe source and formatting fixes.
- `just dev`: run pi with only this package's extensions.

### Dependencies

Runtime dependencies:

- [`@ff-labs/fff-node`](https://github.com/dmtrKovalenko/fff): native fuzzy search.
- `tree-sitter-bash` and `web-tree-sitter`: bash-gate parsing.
- [`graphify`](https://graphify.net/): optional external CLI for the opt-in Graphify skill and `/graphify` command. The OpenAI backend is also required for semantic extraction. On Nix, install `pkgs.graphify` with its `openai` optional dependencies; other systems can use `uv tool install "graphifyy[openai]"` or an equivalent isolated environment.
- pi core packages and `typebox`: peer dependencies supplied by the pi host.

Development dependencies:

- `@biomejs/biome`: linting, formatting, and import organisation.
- `typescript` and `@types/node`: static type checking.
- `vitest`: tests.
- `@earendil-works/pi-agent-core`: pi development and test APIs.

`package-lock.json` is committed so local development and CI resolve the same
dependency graph.

## Credits

The usage dashboard includes MIT-licensed work from
[`@tmustier/pi-usage-extension`](https://github.com/tmustier/pi-usage-extension).
The question UI credits juicesharp. fff integration follows
[`@ff-labs/pi-fff`](https://github.com/dmtrKovalenko/fff). The bundled theme uses
[Tokyo Night](https://github.com/folke/tokyonight.nvim)'s palette. Licensed under
the [MIT License](./LICENSE).
