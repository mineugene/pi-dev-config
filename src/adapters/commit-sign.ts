/**
 * Signed-commit heads-up.
 *
 * When the repo signs commits (git `commit.gpgsign=true`), a `git commit` (or
 * merge/rebase/cherry-pick/revert, or a `git tag -s`) blocks until the signing
 * key is used; on a touch-required YubiKey that means a physical touch. This
 * extension warns before those commands via the `tool_call` hook so you are
 * ready to touch, and blocks a too-short bash timeout that would otherwise kill
 * the process mid-touch. A `git commit` in bash is always redirected to the
 * `commit` tool: bash pipes stdio, so gpg pinentry would fall back to /dev/tty
 * and paint over the live TUI. Merge/rebase/cherry-pick/revert/tag have no tool
 * replacement, so they keep the warn/confirm flow; bash cannot host gpg pinentry
 * itself — use the agent-backed terminal handoff of the commit tool.
 *
 * Config: pidev.json `commitSign` (mode: warn | confirm | block; minTimeoutSec).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isCommitCommand, isSigningCommand } from "../domain/git.ts";
import type { PiDevConfig } from "../infra/config.ts";
import { repoSignsCommits } from "../infra/git.ts";

/** Floor for a signing commit's bash timeout, unless pidev.json overrides it. */
const DEFAULT_MIN_TIMEOUT_SEC = 120;

export default function registerCommitSign(
    pi: ExtensionAPI,
    configRef: { current: PiDevConfig },
): void {
    let signingEnabled = repoSignsCommits(process.cwd());

    pi.on("session_start", async (_event, ctx) => {
        signingEnabled = repoSignsCommits(ctx.cwd);
    });

    pi.on("tool_call", async (event, ctx) => {
        if (event.toolName !== "bash" || !signingEnabled) return undefined;
        const command = typeof event.input?.command === "string" ? event.input.command : "";
        if (!isSigningCommand(command)) return undefined;

        const cfg = configRef.current.commitSign;
        const mode = cfg?.mode ?? "confirm";
        const minTimeoutSec = cfg?.minTimeoutSec ?? DEFAULT_MIN_TIMEOUT_SEC;

        // A timeout shorter than the touch window would kill the commit mid-sign.
        // We cannot rewrite the argument from tool_call (block only), so refuse and
        // tell the model how to re-run. The bash tool has no default timeout, so
        // this only fires when the model set a short one explicitly.
        const timeout = typeof event.input?.timeout === "number" ? event.input.timeout : undefined;
        if (timeout !== undefined && timeout < minTimeoutSec) {
            return {
                block: true,
                reason: `This commit signs with a hardware key and can block waiting for a YubiKey touch. The ${timeout}s timeout may kill it mid-sign; re-run without a timeout, or with timeout >= ${minTimeoutSec}.`,
            };
        }

        if (mode === "block") {
            return {
                block: true,
                reason: "Signed commits are disabled here (pidev commitSign.mode = block); run the commit yourself.",
            };
        }

        if (!ctx.hasUI) {
            // Nothing can prompt or touch here; block confirm mode so a headless run
            // never hangs on the touch. warn mode proceeds and lets it try.
            if (mode === "confirm") {
                return {
                    block: true,
                    reason: "This commit needs an interactive YubiKey touch, which is unavailable in this mode.",
                };
            }
            return undefined;
        }

        // A bash `git commit` cannot host pinentry: stdio is piped, so gpg falls
        // back to prompting on /dev/tty over the live TUI. The commit tool hands
        // the real terminal to git, so route every bash commit there regardless of
        // warn/confirm mode.
        if (isCommitCommand(command)) {
            return {
                block: true,
                reason: "Bash cannot show the gpg pinentry or take a YubiKey touch for a signed commit; use the commit tool instead (stage first if needed).",
            };
        }

        if (mode === "warn") {
            ctx.ui.notify("Signed commit incoming; touch your YubiKey when it blinks.", "warning");
            return undefined;
        }

        // mode === "confirm" (default)
        const ready = await ctx.ui.confirm(
            "Signed commit",
            "This commit signs with your key and will wait for a YubiKey touch. Ready?",
        );
        if (!ready) return { block: true, reason: "Commit cancelled before signing." };
        return undefined;
    });
}
