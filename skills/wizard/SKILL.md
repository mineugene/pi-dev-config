---
name: wizard
description: "Generate an interactive bash wizard for steps only a human can perform. Invoke when the user asks for a script or wizard for manual setup: infrastructure provisioning, credentials or CI secrets, a third-party dashboard, or a one-off migration or cutover. Do not invoke for steps the agent can perform, or merely because the user mentions wizard, names a skill, or writes 'skill <word>'."
---
# Wizard

A **wizard** is a bash script that walks a human through a manual procedure. It
opens each URL, states what to click and copy, captures values, writes them to
their destination, confirms each stage, and shows the stages remaining.

[template.sh](template.sh) owns the library: stage progress, confirmation gates,
URL opening, hidden secret entry, idempotent `.env` upserts, `gh secret` and
`gh variable` writes, and the closing summary. The agent authors only the
stages below the `STAGES` marker. Leave the library above it unchanged.

For each captured value, choose a destination: `.env`, a GitHub secret, a GitHub
variable, or no storage.

A wizard is ephemeral. Save it to a scratch path or `scripts/`, and commit it
only when the user asks for a repeatable setup path.

## Procedure

1. Scope the procedure.
   - Read the repository first. For setup, read `.env*`, `README`,
     `docker-compose*`, framework config, and `.github/workflows/*`; every
     `secrets.*` and `vars.*` reference names a value the wizard needs to produce.
     For a migration, read the current state, the target state, and the
     irreversible actions between them.
   - Show the user the ordered stages and the values each produces. Apply the
     user's additions, removals, and reordering.
   - Done when each stage is named in order and each captured value has a
     source, one destination, and a secret or public label.
2. Map each stage's journey.
   - Write the path a human follows: the URL, the action, where the value
     appears, and the variable it fills.
   - When the current UI or command is unknown, check the docs or ask the user.
     Use verified steps rather than inventing them.
   - Done when each stage has instructions a stranger can follow.
3. Author the wizard.
   - Copy `template.sh` to the target path.
   - Replace the example stage with one `stage` per step, in dependency order,
     using the library helpers. Set `TOTAL_STAGES` to the stage count.
   - Open the URL before asking for its value. Use `ask_secret` for each secret
     value. Call `write_env` for each persisted value. Call `set_secret` only
     for values CI reads. Call `confirm` before each irreversible action.
   - Keep each stage to one task, because each stage clears the screen.
   - Done when every value from step 1 is captured and handled according to its
     chosen destination.
4. Verify and hand off.
   - Run `bash -n <script>` and, when installed, `shellcheck <script>`.
   - Run `chmod +x <script>`.
   - Leave execution to the user: the wizard opens browsers and blocks on human
     input. Trace it statically and check that each `set_secret` name matches a
     `secrets.*` reference in CI.
   - Done when the checks pass and the user has the run command.
