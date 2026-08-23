/**
 * Proactive auto-compaction.
 *
 * Pi's built-in trigger (`contextTokens > contextWindow - reserveTokens`) is a
 * last resort: it fires deep inside a turn, and on models whose advertised
 * window exceeds the provider's real limit it never fires at all before the API
 * rejects the prompt. This compacts earlier and only at a settled point, so the
 * cut lands on a turn boundary instead of pi's split-turn path, and the
 * summarization latency and cache invalidation land while the user reads.
 *
 * Policy lives in domain/auto-compact.ts; this only gathers state and calls
 * `ctx.compact()`. Pi core stays the backstop for a runaway single turn.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { type AutoCompactSettings, decideCompaction } from "../domain/auto-compact.ts";
import type { ConfigRef } from "./feature.ts";
import { todosOpen } from "./todo.ts";

/**
 * Assistant turns recorded after the newest compaction, or null when the session
 * has never compacted. Drives the cooldown that stops summary churn.
 */
function turnsSinceCompaction(entries: readonly { type: string }[]): number | null {
    let lastCompaction = -1;
    for (let i = entries.length - 1; i >= 0; i--) {
        if (entries[i]?.type === "compaction") {
            lastCompaction = i;
            break;
        }
    }
    if (lastCompaction === -1) return null;
    let turns = 0;
    for (let i = lastCompaction + 1; i < entries.length; i++) {
        const entry = entries[i] as { type: string; message?: { role?: string } };
        if (entry.type === "message" && entry.message?.role === "assistant") turns++;
    }
    return turns;
}

export default function registerAutoCompact(pi: ExtensionAPI, config: ConfigRef): void {
    let running = false;
    /** Set after a real compaction failure so we stop retrying every settle. */
    let failed = false;

    pi.on("agent_settled", (_event, ctx) => {
        const settings: AutoCompactSettings = config.current.autoCompact ?? {};
        if (running || failed) return;
        const usage = ctx.getContextUsage();
        const decision = decideCompaction(
            {
                tokens: usage?.tokens ?? null,
                contextWindow: usage?.contextWindow ?? 0,
                todosOpen: todosOpen(),
                turnsSinceCompaction: turnsSinceCompaction(ctx.sessionManager.getBranch()),
            },
            settings,
        );
        if (!decision.compact) return;

        running = true;
        ctx.compact({
            onComplete: () => {
                running = false;
            },
            // ctx.compact() rethrows AgentSession#compact()'s own error unchanged. That
            // method computes "aborted" (user cancel, stays retryable) with exactly this
            // predicate before emitting compaction_end, so matching it here reuses pi
            // core's own cancellation signal instead of guessing from message text.
            onError: (error) => {
                running = false;
                if (error.name === "AbortError" || error.message === "Compaction cancelled") return;
                failed = true;
                ctx.ui.notify(
                    `Auto-compaction disabled for this session: ${error.message || "compaction failed"}`,
                    "warning",
                );
            },
        });
    });

    pi.on("session_start", () => {
        running = false;
        failed = false;
    });
}
