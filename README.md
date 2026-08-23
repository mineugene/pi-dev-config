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

Project settings normally override global scalars. Objects merge by key and lists
are unioned. Permissions instead compose restrictively, so project settings cannot
weaken global decisions. Copy the starter instead of symlinking it so it stays
editable.

The starter disables nothing, so `rtk` and `caveman` load by default. Add feature
names to `disable` only when you want to turn them off.

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
                "fast": { "model": "openai/gpt-5.6-luna", "thinkingLevel": "low" },
                "base": { "model": "openai/gpt-5.6-terra", "thinkingLevel": "medium" },
                "escalated": { "model": "openai/gpt-5.6-terra", "thinkingLevel": "max" },
                "deep": {
                    "model": "openai/gpt-5.6-sol",
                    "thinkingLevel": "max"
                }
            }
        },
        "failureThreshold": 2,
        "correctionThreshold": 2,
        "stagnationThreshold": 2,
        "repeatedToolCallThreshold": 10
    },
    "permissions": {
        "mode": "auto",
        "effects": {
            "credential": "deny",
            "privileged": "deny",
            "external-path": "ask",
            "network": "ask"
        }
    },
    "bashGate": {
        "rules": [
            { "cmd": "terraform", "subcommands": ["apply", "destroy"] },
            { "redirects": "any-write" }
        ],
        "allowRules": [
            { "cmd": "nix-store", "args": ["--query"] },
            { "cmd": "nix", "subcommands": ["show-derivation"] }
        ]
    }
}
```

| Setting | Purpose |
| --- | --- |
| `disable` | Feature names to skip. |
| `vim.enabled` | Enable the experimental modal normal/insert editor. Vim-style keybindings work without it. |
| `promptSlim.enabled` | Omit generic Pi documentation guidance on coding turns. Default: `true`; `/pi` restores it for Pi-help questions. |
| `autocompleteMaxVisible` | Pi setting for visible completion rows (3-20). Set `20` to browse matching skills; use Up/Down to scroll the list. Run `/skill-info` for full descriptions and argument usage. |
| `compaction.keepRecentTokens` | Pi setting in `settings.json`. The starter keeps 24k recent tokens, up from Pi's 20k default, because `autoCompact` triggers with headroom left. Pi's own auto-compaction and the 16,384-token response reserve remain enabled as the backstop. |
| `autoCompact.enabled` | Compact proactively at a settled task boundary. Default: `true`. |
| `autoCompact.minTokens` | Never compact below this context size. Default: `40000`. |
| `autoCompact.softPercent`, `autoCompact.softCeilingTokens` | Task-boundary band; the lower of the two wins. Defaults: `0.7` of the window, capped at `180000` tokens. |
| `autoCompact.hardPercent`, `autoCompact.hardCeilingTokens` | Mid-task band, applied even with an unfinished plan. Defaults: `0.85` of the window, capped at `220000` tokens. |
| `autoCompact.minTurnsSinceCompaction` | Assistant turns to let pass after a compaction. Default: `2`. |
| `statusline.command` | Append one command's stdout as an extra status-line row. |
| `statusline.palettes.<theme>` | Set `outer` and `inner` pill backgrounds per Pi theme, each as `{ rgb: [red, green, blue], ansi256 }`. Invalid or missing palettes use Pi theme tokens. |
| `sessionTracker.needsInputModel` | Small model ID for narrow required-input classification. Defaults to `fast` in the default routing preset. |
| `timer.enabled` | Show elapsed time beside Working and hidden or visible Thinking labels. Default: `true`. |
| `web.search` | Public search uses Brave Search. Set `WEB_SEARCH_API_KEY`; `limit` defaults to 5 and caps at 10. Search returns only result metadata. |
| `web.read` | Static reader limits: output defaults to 6,000 estimated tokens and caps at 12,000; responses default to 2 MiB and 10 seconds. |
| `read.grepGateKb` | Redirect large unbounded reads to grep first. `0` disables the gate. |
| `read.grepGateBypass` | File extensions that bypass the read gate. |
| `commitSign` | Set `mode` to `warn`, `confirm`, or `block`, and tune `minTimeoutSec`. |
| `permissions.mode` | Use `guarded`, `auto` (default), or `bypass`. Bypass resolves every ask but keeps hard safety denials. |
| `permissions.effects` | Override `allow`, `ask`, or `deny` per normalized effect. Global and project values merge restrictively. |
| `bashGate.rules` | Add Bash-specific command, subcommand, flag, or write-redirection restrictions above the generic permission policy. |
| `bashGate.allowRules` | Globally trust extra routine command, argument-prefix, subcommand, or flag patterns. Built-in and configured protections still win; project values are ignored. |
| `graphify.enabled` | Enable `/graphify` and advisory query-first guidance for existing graphs. Default: `false`; build and query operations require the optional `graphify` CLI. `/graphify status` reads local files without invoking an LLM. Never queues builds or refreshes automatically. |
| `notifications.mode` | Use `off`, `bell`, `desktop`, or `both`. Default: `both`. |
| `checkpoints.enabled` | Disable edit/write snapshots when set to `false`. |
| `subagents.<type>.model` | Explicitly override the model for an agent type such as `explore`. |
| `routing.defaultPreset` | Named preset activated for new sessions. A preset selected with `/routing-preset` is restored with that session. |
| `routing.presets.<name>.fast` | Optional cheap entry route for low-risk tasks. It is an entry optimisation, not a recovery rung. |
| `routing.presets.<name>.base` | Required normal target for a named preset and the target restored by `/routing-auto`. Use a model-id string or `{ model, thinkingLevel, cacheTtlMinutes }`. |
| `routing.presets.<name>.escalated` | Optional intermediate recovery target after base struggles. It may use the base model at a higher thinking level. |
| `routing.presets.<name>.deep` | Optional final recovery target after continued difficulty. |
| `routing.fast`, `routing.base`, `routing.escalated`, `routing.deep` | Backward-compatible flat equivalents when not using a preset. An omitted flat base uses Pi's session model. |
| `routing.presets.<name>.cacheTtlMinutes` | Hold a warm base over fast for a new low-risk task, unless the base target sets its own TTL. Unset means no hold unless a global TTL is set. |
| `routing.failureThreshold` | Meaningful failures on one recovery rung before advancing to the next configured rung. Default: `2`. |
| `routing.correctionThreshold` | Correction requests on one recovery rung before advancing. Default: `2`. |
| `routing.stagnationThreshold` | Repeated matching development failures after a remediation attempt before they become stagnation. Default: `2`. |
| `routing.repeatedToolCallThreshold` | Identical tool calls in one assistant response before routing treats the turn as a model failure. Default: `10`. |
| `routing.cacheTtlMinutes` | Minutes to hold a warm base over fast for a new low-risk task. Unset or `0` disables. Base-target TTL wins over preset TTL, then this value. Other targets' TTLs are ignored; `PI_CACHE_RETENTION` has no effect. This does not promise an upstream prompt-cache lifetime. |
| `secretGuard` | Configure supplemental warning/blocking and output scrubbing with `mode`, `paths`, `scrubFrom`, `runSecretsDir`, and `minSecretLen`. Recognized credential access remains a hard permission denial. |

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

### Permissions and Bash authorization

The core permission engine normalizes supported Bash, PowerShell, file, web, and
interactive commit tool calls into `read`, `write`, `delete`, `process`, `network`,
`external-path`, `credential`, and `privileged` effects. `guarded` allows reads and routine read-only processes but
prompts for changes. `auto` also allows ordinary project writes and network reads.
Reads outside the working directory prompt in `guarded` and `auto`, except under the Pi agent directory,
which is trusted harness configuration, read-only Bash access under the immutable `/nix/store`, and the
private session temp directory shown in the permission guidance. Pi creates that `pi-<session-id>-*`
directory with mode `0700`, permits canonical paths inside it as session-local work, and removes it at
session shutdown. Each process, including a subagent, owns a separate directory; deny-policy Bash
restrictions still apply.
Approving an external file read grants its containing directory for the
session; approving a directory-targeted read grants that directory itself. If the target type is unavailable, the
grant remains scoped to that exact resource.
Network writes, deletes, external writes, unknown and ambiguous Bash remain approval-gated.
`bypass` resolves every ask, including unknown Bash, but cannot override explicit denials, credential
or privilege protection, or catastrophic Bash rules. The legacy
`--yolo` flag starts the session in this bypass profile instead of disabling
authorization; Ctrl+Shift+y can cycle away from it.
`ctrl+shift+y` cycles the session permission mode through `guarded`, `auto`, and `yolo`.

Bash uses the existing tree-sitter parser to derive effects. Unknown commands ask
unless `bypass` resolves the ask; compound commands combine all effects. `bashGate.rules` adds
Bash-specific restrictions above this policy. Global `bashGate.allowRules` can classify extra
routine commands without an LLM; protected rules and the generic effect policy still apply.
Project positive rules are ignored so repositories cannot weaken the user's boundary.
Project permission settings merge
with global settings using `allow < ask < deny`, so a repository cannot weaken a
global decision. An `ask` result fails closed when no dialog-capable UI exists.
Interactive approvals may be granted once or for the current session. Unknown Bash can grant
an executable-plus-subcommand family after explicit approval when no higher-risk effect is
present. Compound commands grant each unknown family independently, and every later pipe or
chain component must be allowed separately. Other grants remain exact-operation. All grants
are agent-context scoped, in-memory only, and cleared on session start.
Before each turn, the model receives a five-bullet summary of the effective policy,
active tools, common approval-free operations, and required denial behaviour. The
summary is advisory; the permission engine remains authoritative.

This policy is a guardrail, not a sandbox or malware detector. OS permissions,
credential isolation, and egress controls remain the security boundary.

Routing roles have fixed semantics:

| Role | Purpose |
| --- | --- |
| `fast` | Optional cheap entry route for a low-risk task. |
| `base` | Required normal working target. |
| `escalated` | Optional intermediate recovery target after base struggles. |
| `deep` | Optional final recovery target after continued difficulty. |

Routing preset names are arbitrary object keys. Run `/routing-preset [name]` to switch
all four roles together; omit the name for a picker. When invoked during work, it
confirms the selected preset and applies it after that work finishes. Successful
selections persist with the session. The flat `routing.fast`, `routing.base`,
`routing.escalated`, and `routing.deep` form remains supported.

Routing model values match available `models.json` ids. Model identity and routing-target
identity differ: the same model remains a valid fast, base, escalated, or deep route when
its effective thinking level differs. For example, base may use Terra at medium while
escalated uses Terra at max; that transition changes thinking without an unnecessary
model switch. Entry risk is assessed locally with bounded reason codes, without a model call.
Low risk requires a request of at most two lines and 400 characters, at most one file
reference, no risk signal, and a simple intent: a question, rename, format, typo, comment,
or version bump.
Uncertain risk includes generic requests such as `Add CSV export`, images, and one weak
signal (a large code block or long prompt). High risk includes failure evidence, broken or
not-working wording, multiple
steps or files, broad scope, expanded commands, sensitive security/data-loss/concurrency
topics, or two weak signals. A bare `token` is not sensitive. Only low risk starts on fast;
uncertain and high risk start on base. Without fast, every task starts on base.
Fast keeps a low-risk task across tools and low-risk follow-ups for up to six responses.
Parallel tool calls in one response count once; follow-ups share the limit. Handover sends
the task to base on a model error, context limit, repeated tool calls, stagnation, correction,
a follow-up that is not low risk, or the response limit. An isolated failing check lets fast
try a fix. After handover, the task never returns to fast and base has clean failure and
correction budgets. The footer shows `base · fast turn limit` for limit handover; records
save `handover` as `failure`, `correction`, `follow-up`, or `limit`.
Recovery follows `base → escalated → deep`,
skips missing optional roles, and gives each configured rung a fresh failure and
correction budget. Use `provider/id` when an id exists under more than one provider.

The router classifies provider failures and context limits as strong signals. It does not
escalate for a grep no-match, a routine compiler or test failure, or an infrastructure
failure alone. Ten identical tool calls in one response count as an assistant failure by
default. A matching compiler, test, or runtime signature that persists after an edit
becomes stagnation and can advance the recovery ladder. Footer routing status
uses explicit `fast`, `base`, `escalated`, `deep`, or `manual override` labels with
entry labels such as `fast · low risk`, `base · uncertain risk`, or
`base · high risk: stack trace`, and recovery reasons such as
`assistant failure threshold reached` or `stagnation threshold reached`.

The router never moves to a weaker role within a task. Recovery is task-scoped:
escalated and deep never carry into the next task. A new low-risk task stays on a warm
base instead of fast only with a configured `cacheTtlMinutes`, while base's model use is
within that time. Base-target TTL takes precedence over preset TTL, then global TTL.
Unset means no hold; `0` disables it. TTLs on fast, escalated, and deep are accepted but
ignored. `PI_CACHE_RETENTION` does not affect routing. The footer retains the
`base · warm route: Nm` label for a hold.

`/routing-role fast|base|escalated|deep` forces a routing role for the current task; `/routing-role auto` and `/routing-auto` clear role and exact-model overrides.
A manual exact-model change (such as the Ctrl+L model picker) pauses automatic
routing for the rest of the session and confirms with a notification. Manual model and
role overrides pause the fast response limit and follow-up assessment. `/routing-auto`,
`/routing-preset`, or leaving and resuming the session clears the exact-model override. Completed `todo` plans
provide an exact boundary, with explicit completion or
a non-continuation user instruction as the fallback. Finished tasks persist only
redacted routing metrics, including entry risk and bounded reason codes, never prompt text.

Every finished task records an outcome: `completed` for an explicit acknowledgement or a
finished to-do list; `superseded` for a new request with nothing pending; `unresolved` for
a failed last turn, a failing check that never passed again, or a correction without a
successful reply; `interrupted` for a preset switch, a return to automatic routing, or
shutdown. A successful task is completed or superseded. Old records still load and count
as successful only when their `completed` flag is true; records without an outcome appear
as `unassessed`. The `completed` flag is still written and is true only for that outcome.

In `/usage`, press `r` for routing statistics over the last 100 tasks in the selected period.
The view shows success beside explicit completion, outcome counts, recovery, token, and
cost data. Its entry-risk table (low, uncertain, high, unassessed) shows task counts,
success rate, handover rate, recovery rate, cost per successful task, and cached-input
share. All cost-per-success figures, including the model table, use successful tasks.

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
- **External editor and help** (`help`): `Alt+E` opens the prompt in `$VISUAL` or
  `$EDITOR`; `/help` shows the resolved editor and active keybindings.
- **Paste handling** (`paste`): collapse multi-line pastes into editable placeholders.

### Workflow

- **Plans** (`todo`): maintain a live task list and print it with `/todos`.
- **Proactive compaction** (`autoCompact`): compact when the agent settles rather than
  when the context overflows. Before each request it rechecks after routing, using the
  selected model's catalogued context window. The threshold decides whether the context
  is large enough; the `todo` list decides when it is safe. In the soft band an unfinished
  plan defers
  compaction to the next boundary; in the hard band it compacts anyway. Both bands take
  the lower of a percentage of the window and an absolute ceiling, so a model advertising
  a very large window does not run at 600k tokens. Retry and failure counts are
  deliberately not triggers: their cost already shows up in the token count, and
  compacting mid-retry discards the exact error text. Mid-turn compaction stays with Pi.
  A compaction that fails for a real reason (not a user abort) disables proactive
  compaction for the session and warns once, so the next settle does not repeat it.
- **Lazy tools** (`lazyTools`): keep `Agent`, `todo`, `commit`, questions, and
  subagent helpers out of the initial schema set. `search_tools` enables matching
  tools additively for the session; core coding and safety tools remain active.
- **Context audit** (`contextAudit`): `/context-audit` reports prompt, skill, tool,
  conversation, and session counts without making a model request.
- **Model routing** (`routing`): low-risk tasks enter on fast; uncertain and high risk
  enter on base. Fast keeps tools and low-risk follow-ups until handover or its six-response
  limit. Recovery through optional escalated and deep targets lasts one task. Repeated
  remediated development failures become stagnation; an isolated failing check does not
  cause handover or recovery. A configured TTL holds only warm base over fast. `/routing-preset` swaps named
  model sets, `/routing-role` forces a routing role, and `/routing-auto` clears
  role and exact-model overrides; the footer shows `role(preset) · decision reason`, omitting missing parts.
- **Subagents** (`subagents`): run parallel or isolated agents and inspect them with
  `/agents`; custom agents load from `.pi/agents/*.md`.
- **Checkpoints** (`checkpoints`): snapshot pi edits and restore them with `/rollback`.
- **Graphify** (`graphify`): opt-in `/graphify` command and advisory parent/subagent query-first policy when `graphify-out/graph.json` exists. `/graphify status` reports graph presence, pending semantics, and available failure signals from local files without invoking an agent or CLI. No status-bar badge, filesystem subscriptions, or automatic graph work. Stale graph leads must be checked against source files. Some CLI versions leave `needs_update` after extraction, and Pi does not clear it. `graphify update <path>` refreshes code without an LLM; pending non-code semantics require incremental `graphify extract <path>`, which can use LLM tokens.
- **Commit and PR flows** (`commit`, `commitSign`, `prGuard`): create Conventional
  Commits through `/commit` and pull requests through `/skill:create-pr`, with signing
  and mutation gates.
- **Questions** (`question`): ask structured multiple-choice questions with a free-text
  fallback.

### Visibility

Permission badges show their icon and `auto`, `guarded`, or `yolo`; configured bypass is displayed as `yolo`. Ponytail badges show their icon and uppercase mode without a label prefix. These are display-only changes.

- **Status line** (`statusline`): show the routing profile and route, model, thinking
  level, context, tokens, cost, project root, Git branch, modes, and a right-aligned
  pill chain for session activity and the current `/name`, or `Unnamed session` until one
  is set. Tokyo Night uses its teal accent for the name pill. Lower-priority details hide
  on narrow terminals. Per-theme
  palettes can retain theme-specific status-bar backgrounds.
- **tmux session tracker** (`sessionTracker`): self-register Pi panes, report live
  attention state, recover from tmux metadata, and navigate with `/pi-sessions`,
  `/next-session`, or `Ctrl+Shift+N`. Blocking `ctx.ui` prompts flip the pane to
  `needs-input` immediately; end-of-turn prose still goes through the narrow classifier.
- **Elapsed timers** (`timer`): show live, human-friendly durations beside Working and
  both hidden and visible Thinking blocks, and rotate the Working label through curated
  verbs (`timer.workingVerbs`).
- **Working animation** (`workingIndicator`): replace the Working spinner with a custom
  Braille animation, rendered in the editor's top border.
- **Codex quota** (`tokenCount`): show OpenAI Codex usage and reset times.
- **Usage dashboard** (`usageDashboard`): inspect provider, model, token, cost, quota,
  and redacted routing task metrics with `/usage`. Press `r` for routing statistics.
- **Notifications** (`notifications`): use the terminal bell, `notify-send`, or both
  for turn completion and confirmation prompts.

### Guardrails and prompt control

- **Permissions** (`permissions`): evaluate normalized tool effects under `guarded`,
  `auto`, or `bypass`; project effective guidance into each model turn, prompt
  interactively, and fail closed in headless runs. Bash-specific `bashGate.rules`
  remain restrictive overlays.
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
- `/commit`: branch-aware Conventional Commit flow.
- `/todos`: current plan.
- `/skill-info [name]`: browse full skill descriptions, instructions, and argument usage.
- `/routing-preset [name]`: select a named fast/base/escalated/deep model set after current work finishes.
- `/routing-role <fast|base|escalated|deep|auto>` or `/route ...`: force a routing role for the current task, or resume automatic routing (low risk enters on fast; uncertain/high risk enters on base).
- `/routing-auto`: clear role and exact-model overrides, reset routing recovery state, and restore the preset base.
- `/ponytail [off|lite|full|ultra|status]`: show or set the session Ponytail mode.
  Exact `stop ponytail` and `normal mode` also switch it off.
- `/agents`: subagent fleet and conversation viewer.
- `/rollback`: restore a checkpoint and optionally fork the conversation.
- `/usage`: cost, token, and quota dashboard.
- `/pi-sessions`: attention-sorted picker for tracked Pi panes.
- `/next-session`: focus the next tracked pane; `Ctrl+Shift+N` is the shortcut.
- `Ctrl+Shift+Y`: toggle the session-scoped bypass profile; hard and explicit denials remain.
- `/hotkeys`: pi's built-in shortcut list.

## tmux multi-session tracking

Each parent Pi process launched inside tmux registers its `TMUX_PANE` with a
host-local, disposable daemon. tmux remains authoritative for sessions, windows,
panes, focus, layouts, working directories, and process lifetime. The tracker
holds only reconstructible metadata and these four states, in attention order:

1. `needs-permission`: an interactive Bash permission prompt is waiting for a person.
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
with `/skill:<name>`. Model-invoked skills activate only for their documented,
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
- [`domain-modeling`](./skills/domain-modeling/SKILL.md): maintain domain language
  and sparse architectural decisions while designs are resolved.
- [`grill-with-docs`](./skills/grill-with-docs/SKILL.md): interview before implementing
  an underspecified feature, record durable decisions, then offer implementation,
  specification, and issue-splitting phases.
- [`tdd`](./skills/tdd/SKILL.md): guide a test-first red-green loop at agreed public
  seams.
- [`code-review`](./skills/code-review/SKILL.md): review a diff against repository
  standards and its originating specification in parallel.

### User-invoked

These remain available through `/skill:<name>` but are hidden from the baseline
model skill catalogue.

- [`create-pr`](./skills/create-pr/SKILL.md): create a pull request through the
  detected Git forge after preview and confirmation.
- [`grill-me`](./skills/grill-me/SKILL.md): explicitly start the `grilling`
  design-tree interview.
- [`to-spec`](./skills/to-spec/SKILL.md): synthesise the current conversation into a
  publishable feature specification.
- [`to-tickets`](./skills/to-tickets/SKILL.md): split an approved specification into
  dependency-linked, reviewable implementation issues.
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

`to-spec` and `to-tickets` use a documented project workflow when present. Otherwise
remote detection selects Azure Boards through `az`, GitHub Issues through `gh`, or
Forgejo/Gitea issues through `tea`. Remote publication always requires confirmation.

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
- `tree-sitter-bash` and `web-tree-sitter`: Bash effect and safety-rule parsing.
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
