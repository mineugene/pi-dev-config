/**
 * Interactive `commit` tool.
 *
 * Creates a git commit with a caller-supplied conventional message. In the TUI
 * it delegates terminal handoff to shared infrastructure and runs `git commit`
 * with inherited stdio. GPG pinentry passphrase prompts and YubiKey touch happen
 * on the real terminal; Pi never handles their secret input. The `/commit` prompt
 * template drives the branch and message decisions, then calls this tool.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";

import { commitMessageArgs } from "../domain/git.ts";
import { runInteractiveProcess } from "../infra/interactive-terminal.ts";

const commitSchema = Type.Object({
    subject: Type.String({
        description:
            "Conventional Commits subject: type(scope): summary. Imperative, lower-case, no trailing period.",
    }),
    body: Type.Optional(
        Type.String({
            description:
                "Optional commit body; include only when the subject does not tell the whole story.",
        }),
    ),
});

type CommitInput = Static<typeof commitSchema>;

export default function registerCommit(pi: ExtensionAPI): void {
    pi.registerTool({
        name: "commit",
        label: "commit",
        description:
            "Create a git commit from the given conventional message. Runs interactively so the gpg pinentry passphrase prompt and a YubiKey touch work in the terminal; prefer this over `git commit` in bash. Stage the changes first.",
        parameters: commitSchema,
        async execute(_toolCallId, params: CommitInput, signal, _onUpdate, ctx) {
            const result = await runInteractiveProcess(
                ctx,
                "git",
                ["commit", ...commitMessageArgs(params.subject, params.body)],
                { cwd: ctx.cwd, env: process.env, signal },
            );

            if (result.code !== 0) {
                throw new Error(`git commit exited with code ${result.code ?? "null"}`);
            }
            return { content: [{ type: "text", text: "Commit created." }], details: {} };
        },
    });
}
