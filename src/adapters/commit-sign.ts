/**
 * Signed-commit heads-up.
 *
 * When the repo signs commits (git `commit.gpgsign=true`), a `git commit` (or
 * merge/rebase/cherry-pick/revert, or a `git tag -s`) blocks until the signing
 * key is used; on a touch-required YubiKey that means a physical touch. This
 * extension prompts before those commands via the `tool_call` hook so the user
 * warms the GPG pinentry first, and blocks a too-short bash timeout that would
 * otherwise kill the process mid-touch. Bash pipes stdio, so gpg pinentry would
 * fall back to /dev/tty and paint over the live TUI; warming the pinentry caches
 * the passphrase so the commit needs only the touch.
 *
 * Config: pidev.json `commitSign` (mode: warn | confirm | block; minTimeoutSec).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isSigningCommand } from "../domain/git.ts";
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

        // Bash pipes stdio, so gpg pinentry cannot prompt there; the user must
        // warm the pinentry (cache the passphrase) before the command runs.
        if (mode === "warn") {
            ctx.ui.notify(
                "Signed commit incoming; warm the GPG pinentry and touch your YubiKey when it blinks.",
                "warning",
            );
            return undefined;
        }

        // mode === "confirm" (default)
        const ready = await ctx.ui.confirm(
            "Signed commit",
            "This commit signs with your key. Warm the GPG pinentry first (so gpg does not prompt over the UI), then approve; it will wait for a YubiKey touch.",
        );
        if (!ready) return { block: true, reason: "Commit cancelled before signing." };
        return undefined;
    });
}
