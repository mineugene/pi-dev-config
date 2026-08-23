/**
 * Proactive auto-compaction policy.
 *
 * Pi core compacts when `contextTokens > contextWindow - reserveTokens`, which
 * only fires deep inside a turn (often only after the provider rejects the
 * prompt). This decides whether to compact earlier, at a boundary we choose.
 *
 * Two axes, kept separate:
 *   - the threshold decides WHETHER the context is big enough to compact;
 *   - the task state decides WHEN it is safe to do so.
 *
 * Percent alone is wrong on models advertising a very large window, so the soft
 * and hard bands each also carry an absolute ceiling and the lower one wins.
 * Retry or failure counts are deliberately not an input: a retry loop's cost is
 * already visible in the token count, and compacting mid-retry drops the exact
 * error text at the moment it matters most.
 */

/** Never compact below this, so short sessions on small models stay verbatim. */
export const MIN_COMPACT_TOKENS = 40_000;
/** Compact at a task boundary from here up. */
export const SOFT_PERCENT = 0.7;
export const SOFT_CEILING_TOKENS = 180_000;
/** Compact even mid-task from here up. */
export const HARD_PERCENT = 0.85;
export const HARD_CEILING_TOKENS = 220_000;
/** Let this many turns pass after a compaction before considering another. */
export const MIN_TURNS_SINCE_COMPACTION = 2;

export interface AutoCompactSettings {
    /** Off by default; the registry passes the configured value. */
    enabled?: boolean;
    minTokens?: number;
    softPercent?: number;
    softCeilingTokens?: number;
    hardPercent?: number;
    hardCeilingTokens?: number;
    minTurnsSinceCompaction?: number;
}

export interface AutoCompactState {
    /** Estimated context tokens, or null when pi cannot tell yet (e.g. just compacted). */
    tokens: number | null;
    /** Model context window; 0 or negative means unknown. */
    contextWindow: number;
    /** True while a plan has pending or in-progress items. */
    todosOpen: boolean;
    /** Turns since the last compaction, or null when the session has never compacted. */
    turnsSinceCompaction: number | null;
}

export type AutoCompactDecision =
    | { compact: false; reason: "disabled" | "unknown" | "below-floor" | "cooldown" | "mid-task" }
    | { compact: true; band: "soft" | "hard" };

/** Lower of the percentage band and its absolute ceiling. */
function bandThreshold(contextWindow: number, percent: number, ceiling: number): number {
    return Math.min(Math.floor(contextWindow * percent), ceiling);
}

/**
 * Decide whether to compact now. Callers must only ask at a settled point: this
 * never authorizes a mid-turn compaction, which would force pi's split-turn cut
 * and a second summarization call.
 */
export function decideCompaction(
    state: AutoCompactState,
    settings: AutoCompactSettings = {},
): AutoCompactDecision {
    if (settings.enabled === false) return { compact: false, reason: "disabled" };
    const { tokens, contextWindow } = state;
    if (tokens === null || contextWindow <= 0) return { compact: false, reason: "unknown" };

    const minTokens = settings.minTokens ?? MIN_COMPACT_TOKENS;
    if (tokens < minTokens) return { compact: false, reason: "below-floor" };

    const minTurns = settings.minTurnsSinceCompaction ?? MIN_TURNS_SINCE_COMPACTION;
    if (state.turnsSinceCompaction !== null && state.turnsSinceCompaction < minTurns) {
        return { compact: false, reason: "cooldown" };
    }

    const hard = bandThreshold(
        contextWindow,
        settings.hardPercent ?? HARD_PERCENT,
        settings.hardCeilingTokens ?? HARD_CEILING_TOKENS,
    );
    if (tokens >= hard) return { compact: true, band: "hard" };

    const soft = bandThreshold(
        contextWindow,
        settings.softPercent ?? SOFT_PERCENT,
        settings.softCeilingTokens ?? SOFT_CEILING_TOKENS,
    );
    if (tokens < soft) return { compact: false, reason: "below-floor" };

    // Soft band: a boundary only. Open to-dos mean the agent stopped mid-plan.
    return state.todosOpen
        ? { compact: false, reason: "mid-task" }
        : { compact: true, band: "soft" };
}
