export type RoutingModelRole = "base" | "fast" | "deep" | "manual";
export type RoutingPhase = "NORMAL" | "ESCALATED";

export interface RoutingState {
    phase: RoutingPhase;
    consecutiveBaseFailures: number;
    correctionCount: number;
    forceBase: boolean;
}

export type RoutingUserSignal = "negative" | "complete" | "continuation" | "new-task";

export function initialRoutingState(): RoutingState {
    return {
        phase: "NORMAL",
        consecutiveBaseFailures: 0,
        correctionCount: 0,
        forceBase: false,
    };
}

export function normalizeFailureThreshold(value: number | undefined): number {
    return Number.isInteger(value) && (value ?? 0) > 0 ? (value as number) : 2;
}

/** Count user-requested rework independently from provider and tool failures. */
export function recordRoutingCorrection(
    state: RoutingState,
    correctionThreshold: number,
    canEscalate: boolean,
): RoutingState {
    if (state.phase === "ESCALATED") return state;

    const correctionCount = state.correctionCount + 1;
    if (canEscalate && correctionCount >= correctionThreshold) {
        return { ...state, phase: "ESCALATED", correctionCount, forceBase: false };
    }
    return { ...state, correctionCount, forceBase: true };
}

/** Record one turn-level outcome. Parallel tool failures count as one failed turn. */
export function recordRoutingOutcome(
    state: RoutingState,
    role: RoutingModelRole,
    failed: boolean,
    failureThreshold: number,
    canEscalate: boolean,
): RoutingState {
    if (state.phase === "ESCALATED" || role === "deep" || role === "manual") return state;

    if (!failed) {
        return role === "base" ? { ...state, consecutiveBaseFailures: 0, forceBase: false } : state;
    }

    if (role === "fast") return { ...state, forceBase: true };
    if (role !== "base") return state;

    const consecutiveBaseFailures = state.consecutiveBaseFailures + 1;
    if (canEscalate && consecutiveBaseFailures >= failureThreshold) {
        return { ...state, phase: "ESCALATED", consecutiveBaseFailures, forceBase: false };
    }
    return { ...state, consecutiveBaseFailures, forceBase: true };
}

const BASE_TASK_SIGNAL =
    /\b(?:architect\w*|audit\w*|bugs?|build|debug\w*|design\w*|diagnos\w*|fail(?:ed|ing|ures?|s)?|fix(?:e[ds]|ing)?|implement\w*|investigat\w*|migrat\w*|multi[- ]step|overhaul\w*|refactor\w*|regression|review\w*|rewrite\w*|root cause)\b/i;
const LARGE_SCOPE_SIGNAL =
    /\b(?:across (?:the )?(?:codebase|project|repo(?:sitory)?)|entire (?:codebase|project|repo(?:sitory)?|system)|large[- ]scale|major|multiple (?:changes|files?|modules?|steps?|tasks?)|several (?:changes|files?|modules?|steps?|tasks?|things)|whole (?:codebase|project|repo(?:sitory)?|system))\b/i;
const SEQUENCED_STEP = /\b(?:after that|and then|finally|followed by|then)\b/i;
const ADDITIONAL_ACTION =
    /(?:\b(?:also|and)\s+|[,;.!?]\s*)(?:add|change|check|create|fix|implement|remove|replace|run|test|update|write)\b/i;
const LIST_STEP = /(?:^|\n)\s*(?:[-*+]|\d+[.)])\s+\S/g;
const ACTION_LINE =
    /(?:^|\n)\s*(?:please\s+)?(?:add|change|check|create|fix|implement|remove|replace|run|test|update|write)\b/gim;
const EXPANDED_PROMPT_COMMAND = /^\/\S+/;

/** Route work that is likely to need several decisions or tool turns to base. */
export function routingTaskNeedsBase(text: string): boolean {
    if (
        BASE_TASK_SIGNAL.test(text) ||
        LARGE_SCOPE_SIGNAL.test(text) ||
        SEQUENCED_STEP.test(text) ||
        ADDITIONAL_ACTION.test(text) ||
        EXPANDED_PROMPT_COMMAND.test(text.trim())
    ) {
        return true;
    }
    return (text.match(LIST_STEP)?.length ?? 0) > 1 || (text.match(ACTION_LINE)?.length ?? 0) > 1;
}

const COMPLETE_SIGNAL =
    /^(?:all done|done|fixed|resolved|looks good|works now|that works|that is done|that's done|thank you|thanks)[.!]*$/i;
const NEGATIVE_SIGNAL =
    /(?:^(?:no|wrong)\b|(?:this|it) is wrong|that(?:'s| is) wrong|wrong answer|not (?:quite|exactly) right|not right|not what i (?:asked|meant)|didn't work|doesn't work|does not work|wasn't done|was not done|still (?:broken|fail(?:ed|ing|s)?|incorrect|not|wrong)|try again|retry (?:it|that|this)|redo (?:it|that)|you (?:didn't|did not|forgot|missed|overlooked)|incorrect|less than optimal)/i;
const REFERENTIAL_CONTINUATION =
    /\b(?:again|above|it|previous|remaining|same|still|that|these|this|those)\b/i;
const LEADING_CONTINUATION =
    /^(?:also|and|another thing|but|continue|go on|keep going|next|one more|so|then|instead)\b/i;
const CORRECTION_CONTINUATION = /^(?:please\s+)?(?:correct|fix|redo)\s+(?:it|that|this)\b/i;

/** Deterministic fallback for subtask boundaries when no task tracker reports completion. */
export function classifyRoutingUserSignal(text: string): RoutingUserSignal {
    const normalized = text.trim().replace(/\s+/g, " ");
    if (COMPLETE_SIGNAL.test(normalized)) return "complete";
    if (NEGATIVE_SIGNAL.test(normalized) || CORRECTION_CONTINUATION.test(normalized)) {
        return "negative";
    }
    if (
        LEADING_CONTINUATION.test(normalized) ||
        REFERENTIAL_CONTINUATION.test(normalized) ||
        normalized.length === 0
    ) {
        return "continuation";
    }
    return "new-task";
}
