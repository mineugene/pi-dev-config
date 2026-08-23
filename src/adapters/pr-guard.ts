/**
 * PR guard.
 *
 * Creating or editing a pull request is a server-side POST that is hard to roll
 * back, so this blocks any mutating gh / az / tea PR command from the bash tool
 * unless the turn was started with the `/pr` command. It recognises a `/pr` turn
 * by a sentinel that the `/pr` prompt template carries in the user message.
 * Read-only PR commands (list, view, diff, ...) and everything else pass through.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { isGuardedPrCommand } from "../domain/pr.ts";

/** Marker the /pr prompt template embeds so this guard can recognise its turns. */
const PR_SENTINEL = "pidev:pr-command";

export default function registerPrGuard(pi: ExtensionAPI): void {
    pi.on("tool_call", async (event, ctx) => {
        if (event.toolName !== "bash") return undefined;
        const command = typeof event.input?.command === "string" ? event.input.command : "";
        if (!isGuardedPrCommand(command)) return undefined;

        // Allow only when this turn came from /pr: scan back to the most recent
        // user message and look for the template's sentinel.
        const entries = ctx.sessionManager.getEntries();
        for (let i = entries.length - 1; i >= 0; i--) {
            const entry = entries[i];
            if (entry?.type !== "message" || entry.message.role !== "user") continue;
            if (JSON.stringify(entry.message).includes(PR_SENTINEL)) return undefined;
            break;
        }

        return {
            block: true,
            reason: "Creating or editing a pull request is only allowed via the /pr command; reads (list, view, diff) are fine. Ask me to run /pr.",
        };
    });
}
