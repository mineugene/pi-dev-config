/**
 * Interactive `commit` tool.
 *
 * Creates a git commit with a caller-supplied conventional message. When the
 * repo signs commits it hands the terminal to `git commit` (inherited stdio) so
 * a GPG pinentry passphrase prompt or YubiKey touch reaches the real terminal;
 * Pi never handles their secret input. An unsigned commit runs captured instead,
 * so the fullscreen UI is not suspended and cleared for an unused handoff. The
 * `/commit` prompt template drives the branch and message decisions, then calls
 * this tool.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";

import { commitMessageArgs } from "../domain/git.ts";
import { repoSignsCommits } from "../infra/git.ts";
import { runCapturedProcess, runInteractiveProcess } from "../infra/interactive-terminal.ts";

import { STRICT_PREFER_SAMPLING } from "./constrained-sampling.ts";

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
            "Create a git commit from the given conventional message. Hands the terminal to git when the repo signs commits, so the gpg pinentry passphrase prompt and a YubiKey touch work; otherwise runs non-interactively. Use this instead of `git commit` in bash. Stage the changes first.",
        parameters: commitSchema,
        constrainedSampling: STRICT_PREFER_SAMPLING,
        async execute(_toolCallId, params: CommitInput, signal, _onUpdate, ctx) {
            const args = ["commit", ...commitMessageArgs(params.subject, params.body)];
            const options = { cwd: ctx.cwd, env: process.env, signal };
            // An unsigned commit never reads the terminal, so run it captured and
            // leave the fullscreen UI up instead of blanking it for a handoff the
            // child does not use.
            const result = repoSignsCommits(ctx.cwd)
                ? await runInteractiveProcess(ctx, "git", args, options)
                : await runCapturedProcess("git", args, options);

            if (result.code !== 0) {
                const detail = result.stderr?.trim() ?? "";
                throw new Error(
                    `git commit exited with code ${result.code ?? "null"}${detail ? `: ${detail}` : ""}`,
                );
            }
            return { content: [{ type: "text", text: "Commit created." }], details: {} };
        },
    });
}
