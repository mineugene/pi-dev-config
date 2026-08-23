export interface RoutingModelIdentity {
    provider: string;
    id: string;
}

export interface RoutingTargetIdentity {
    model: RoutingModelIdentity;
    thinkingLevel?: string;
}

/** Stable identity for a physical model, independent from reasoning effort. */
export function modelKey(model: RoutingModelIdentity): string {
    return `${model.provider}/${model.id}`.toLowerCase();
}

/** Stable identity for a configured route, including its effective reasoning effort. */
export function routingTargetKey(target: RoutingTargetIdentity): string {
    return `${modelKey(target.model)}:${target.thinkingLevel ?? "default"}`;
}

export type RoutingModelRole = "base" | "fast" | "escalated" | "deep" | "manual";
export type RoutingRecoveryRole = Exclude<RoutingModelRole, "fast" | "manual">;

export interface RoutingRecoveryTarget<T extends RoutingTargetIdentity = RoutingTargetIdentity> {
    role: RoutingRecoveryRole;
    target: T;
}

/** Build the fixed recovery order, omitting missing and adjacent duplicate targets. */
export function buildRoutingRecoveryLadder<T extends RoutingTargetIdentity>(
    base: T | undefined,
    escalated: T | undefined,
    deep: T | undefined,
): RoutingRecoveryTarget<T>[] {
    const targets: RoutingRecoveryTarget<T>[] = [];
    for (const candidate of [
        base === undefined ? undefined : { role: "base" as const, target: base },
        escalated === undefined ? undefined : { role: "escalated" as const, target: escalated },
        deep === undefined ? undefined : { role: "deep" as const, target: deep },
    ]) {
        if (!candidate) continue;
        const previous = targets.at(-1);
        if (previous && routingTargetKey(previous.target) === routingTargetKey(candidate.target)) {
            continue;
        }
        targets.push(candidate);
    }
    return targets;
}

export interface FailureSignatureState {
    signature?: string;
    occurrences: number;
    attemptsSinceChange: number;
}

export interface RoutingState {
    /** Index in the resolved base → escalated → deep recovery ladder. */
    recoveryIndex: number;
    consecutiveFailures: number;
    correctionCount: number;
    forceBase: boolean;
    failureSignature: FailureSignatureState;
    /** Total stagnation signals in this subtask, retained for telemetry. */
    stagnationEvents: number;
}

export type RoutingUserSignal = "negative" | "complete" | "continuation" | "new-task";

export function initialRoutingState(): RoutingState {
    return {
        recoveryIndex: 0,
        consecutiveFailures: 0,
        correctionCount: 0,
        forceBase: false,
        failureSignature: { occurrences: 0, attemptsSinceChange: 0 },
        stagnationEvents: 0,
    };
}

export function normalizeFailureThreshold(value: number | undefined): number {
    return Number.isInteger(value) && (value ?? 0) > 0 ? (value as number) : 2;
}

export type RoutingFailureKind =
    | "none"
    | "assistant"
    | "context-limit"
    | "tool-infrastructure"
    | "development"
    | "repeated"
    | "unknown";

export interface RoutingToolFailureInput {
    toolName?: string;
    isError: boolean;
    output?: string;
}

export interface RoutingFailureInput {
    assistant?: { stopReason?: string; errorMessage?: string };
    toolResults: readonly RoutingToolFailureInput[];
}

export interface RoutingFailure {
    kind: RoutingFailureKind;
    /** Bounded normalized identifier for a development failure, never raw output. */
    signature?: string;
    /** Every observed category in this turn, for telemetry. */
    kinds: readonly RoutingFailureKind[];
}

const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");
const NO_MATCH_OUTPUT = /\b(?:no matches?(?: found)?|0 matches?|nothing found)\b/i;
const INFRASTRUCTURE_OUTPUT =
    /\b(?:timed? ?out|timeout|etimedout|network|econn\w*|enotfound|eai_again|service unavailable|unavailable service|permission denied|access denied|rate limit)\b/i;
const MALFORMED_ASSISTANT_OUTPUT =
    /\b(?:malformed (?:tool )?(?:request|arguments?)|invalid (?:tool )?(?:request|arguments?)|tool call parse)\b/i;
const CONTEXT_LIMIT_OUTPUT = /\b(?:context (?:length|limit|window)|maximum context)\b/i;
const MAX_FAILURE_SIGNATURE_LENGTH = 160;
const DEVELOPMENT_OUTPUT =
    /\b(?:TS\d{4,5}|E\d{4}|error CS\d+|AssertionError|FAIL(?:ED)?|failures?|compil(?:e|ation)|lint(?:ing)?|TypeError|ReferenceError|SyntaxError|panic!)\b/i;

function normalizedOutput(output: string): string {
    return output.replace(ANSI_ESCAPE, "").replace(/\r/g, "").replace(/\s+/g, " ").trim();
}

function sourcePath(output: string): string | undefined {
    const match = output.match(
        /(?:[A-Za-z0-9_.@-]+\/)*[A-Za-z0-9_.@-]+\.(?:[cm]?[jt]sx?|rs|py|java|cs|go)/i,
    );
    if (!match) return undefined;
    const path = match[0] ?? "";
    const rooted = /(?:^|\/)(?:src|test|tests)\//i.exec(path);
    if (!rooted || rooted.index === undefined) return path;
    return path.slice(rooted.index + (path[rooted.index] === "/" ? 1 : 0));
}

function boundedFailureSignature(signature: string): string {
    return signature.length <= MAX_FAILURE_SIGNATURE_LENGTH
        ? signature
        : `${signature.slice(0, MAX_FAILURE_SIGNATURE_LENGTH - 1)}…`;
}

/** Create a bounded, volatile-location-free signature for a development failure. */
export function routingFailureSignature(
    toolName: string | undefined,
    output: string,
): string | undefined {
    const text = normalizedOutput(output);
    const path = sourcePath(text);
    const tsCode = /\bTS\d{4,5}\b/i.exec(text)?.[0]?.toUpperCase();
    if (tsCode) return boundedFailureSignature(`tsc:${tsCode}${path ? `:${path}` : ""}`);

    const rustCode = /\bE\d{4}\b/i.exec(text)?.[0]?.toUpperCase();
    if (rustCode) return boundedFailureSignature(`cargo:${rustCode}${path ? `:${path}` : ""}`);

    const csharpCode = /\berror CS\d+\b/i.exec(text)?.[0]?.replace(/\s+/g, "");
    if (csharpCode) return boundedFailureSignature(`dotnet:${csharpCode}${path ? `:${path}` : ""}`);

    const test = /\bFAIL(?:ED)?\s+([^\s]+)/i.exec(text)?.[1];
    if (test) {
        const assertion = /\b(AssertionError|TypeError|ReferenceError)\b/.exec(text)?.[1];
        return boundedFailureSignature(
            `test:${test.replace(/::.+$/, "")}${assertion ? `:${assertion}` : ""}`,
        );
    }

    const runtime = /\b(TypeError|ReferenceError|SyntaxError)\b/.exec(text)?.[1];
    if (runtime) return boundedFailureSignature(`runtime:${runtime}${path ? `:${path}` : ""}`);
    if (DEVELOPMENT_OUTPUT.test(text)) {
        return boundedFailureSignature(`development:${toolName ?? "tool"}`);
    }
    return undefined;
}

/** Classify turn failures without treating routine development output as model inadequacy. */
export function classifyRoutingFailure(input: RoutingFailureInput): RoutingFailure {
    const kinds = new Set<RoutingFailureKind>();
    const assistant = input.assistant;
    if (
        assistant?.stopReason === "length" ||
        CONTEXT_LIMIT_OUTPUT.test(assistant?.errorMessage ?? "")
    ) {
        kinds.add("context-limit");
    } else if (assistant?.stopReason === "error") {
        kinds.add("assistant");
    }

    let signature: string | undefined;
    for (const result of input.toolResults) {
        const output = normalizedOutput(result.output ?? "");
        const toolName = result.toolName?.toLowerCase();
        if ((toolName === "grep" || toolName === "find") && NO_MATCH_OUTPUT.test(output)) continue;
        if (CONTEXT_LIMIT_OUTPUT.test(output)) {
            kinds.add("context-limit");
            continue;
        }
        if (MALFORMED_ASSISTANT_OUTPUT.test(output)) {
            kinds.add("assistant");
            continue;
        }
        if (INFRASTRUCTURE_OUTPUT.test(output)) {
            kinds.add("tool-infrastructure");
            continue;
        }
        const developmentSignature = routingFailureSignature(result.toolName, output);
        if (developmentSignature) {
            kinds.add("development");
            signature ??= developmentSignature;
            continue;
        }
        if (result.isError) kinds.add("unknown");
    }

    const priority: readonly RoutingFailureKind[] = [
        "context-limit",
        "assistant",
        "development",
        "tool-infrastructure",
        "unknown",
    ];
    const kind = priority.find((candidate) => kinds.has(candidate)) ?? "none";
    return { kind, ...(signature === undefined ? {} : { signature }), kinds: [...kinds] };
}

function canAdvanceRecovery(state: RoutingState, recoveryTargetCount: number): boolean {
    return (
        Number.isInteger(recoveryTargetCount) &&
        recoveryTargetCount > 0 &&
        state.recoveryIndex + 1 < recoveryTargetCount
    );
}

function advanceRecovery(state: RoutingState): RoutingState {
    return {
        ...state,
        recoveryIndex: state.recoveryIndex + 1,
        consecutiveFailures: 0,
        correctionCount: 0,
        forceBase: false,
    };
}

/** Count user-requested rework independently from provider and tool failures. */
export function recordRoutingCorrection(
    state: RoutingState,
    correctionThreshold: number,
    recoveryTargetCount: number,
    role: RoutingModelRole = "base",
): RoutingState {
    if (role === "deep" || role === "manual") return state;
    if (role === "fast") return { ...state, forceBase: true };

    const correctionCount = state.correctionCount + 1;
    const corrected = { ...state, correctionCount, forceBase: role === "base" };
    if (correctionCount < correctionThreshold || !canAdvanceRecovery(state, recoveryTargetCount)) {
        return corrected;
    }
    return advanceRecovery(corrected);
}

/** Record one turn-level outcome. Parallel tool failures count as one failed turn. */
export function recordRoutingOutcome(
    state: RoutingState,
    role: RoutingModelRole,
    failed: boolean,
    failureThreshold: number,
    recoveryTargetCount: number,
): RoutingState {
    if (role === "deep" || role === "manual") return state;

    if (!failed) {
        return role === "fast" ? state : { ...state, consecutiveFailures: 0, forceBase: false };
    }

    if (role === "fast") return { ...state, forceBase: true };
    if (role !== "base" && role !== "escalated") return state;

    const consecutiveFailures = state.consecutiveFailures + 1;
    const failedState = {
        ...state,
        consecutiveFailures,
        forceBase: role === "base",
    };
    if (consecutiveFailures < failureThreshold || !canAdvanceRecovery(state, recoveryTargetCount)) {
        return failedState;
    }
    return advanceRecovery(failedState);
}

export interface RoutingFailureOptions {
    failureThreshold: number;
    stagnationThreshold: number;
    recoveryTargetCount: number;
    attemptedRemediation?: boolean;
    developmentSucceeded?: boolean;
}

function emptyFailureSignature(): FailureSignatureState {
    return { occurrences: 0, attemptsSinceChange: 0 };
}

/**
 * Apply classified failure evidence. Development failures only advance after
 * the same signature recurs following a remediation attempt.
 */
export function recordRoutingFailure(
    state: RoutingState,
    role: RoutingModelRole,
    failure: RoutingFailure,
    options: RoutingFailureOptions,
): RoutingState {
    if (role === "deep" || role === "manual") return state;

    if (failure.kind === "none") {
        if (options.developmentSucceeded) {
            const settled = recordRoutingOutcome(
                state,
                role,
                false,
                options.failureThreshold,
                options.recoveryTargetCount,
            );
            return { ...settled, failureSignature: emptyFailureSignature() };
        }
        if (options.attemptedRemediation && state.failureSignature.signature) {
            return {
                ...state,
                failureSignature: {
                    ...state.failureSignature,
                    attemptsSinceChange: state.failureSignature.attemptsSinceChange + 1,
                },
            };
        }
        return recordRoutingOutcome(
            state,
            role,
            false,
            options.failureThreshold,
            options.recoveryTargetCount,
        );
    }

    if (
        failure.kind === "assistant" ||
        failure.kind === "context-limit" ||
        failure.kind === "repeated"
    ) {
        return recordRoutingOutcome(
            state,
            role,
            true,
            options.failureThreshold,
            options.recoveryTargetCount,
        );
    }

    if (failure.kind !== "development" || !failure.signature) return state;

    const previous = state.failureSignature;
    if (previous.signature !== failure.signature) {
        return {
            ...state,
            failureSignature: {
                signature: failure.signature,
                occurrences: 1,
                attemptsSinceChange: 0,
            },
        };
    }

    const occurrences = previous.occurrences + 1;
    const repeatedAfterRemediation =
        previous.attemptsSinceChange > 0 && occurrences >= options.stagnationThreshold;
    const nextSignature: FailureSignatureState = {
        signature: failure.signature,
        occurrences,
        attemptsSinceChange: repeatedAfterRemediation ? 0 : previous.attemptsSinceChange,
    };
    if (!repeatedAfterRemediation) return { ...state, failureSignature: nextSignature };

    const stagnant = {
        ...state,
        failureSignature: nextSignature,
        stagnationEvents: state.stagnationEvents + 1,
    };
    const escalated = recordRoutingOutcome(
        stagnant,
        role,
        true,
        options.failureThreshold,
        options.recoveryTargetCount,
    );
    return { ...escalated, failureSignature: nextSignature };
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
const STACK_TRACE_SIGNAL =
    /\b(?:traceback|TypeError|ReferenceError|SyntaxError)\b|\bat\s+[^\n]+\([^\n]+:\d+:\d+\)/i;
const COMPILER_OUTPUT_SIGNAL = /\b(?:TS\d{4,5}|E\d{4}|error CS\d+|javac:)\b/i;
const TEST_OUTPUT_SIGNAL = /\b(?:FAIL(?:ED)?|AssertionError|Tests:\s*\d+\s+failed)\b/i;
const PATCH_SIGNAL = /(?:^|\n)diff --git\s|(?:^|\n)@@\s|(?:^|\n)\+\+\+\s/m;
const ARCHITECTURE_SIGNAL =
    /\b(?:linearizable|deadlock|race condition|lock-free|memory ordering|distributed transaction|idempotency|consistency model)\b/i;
const SOURCE_PATH =
    /(?:^|[\s"'`(])((?:[A-Za-z0-9_.@-]+\/)*[A-Za-z0-9_.@-]+\.(?:[cm]?[jt]sx?|rs|py|java|cs|go))/gm;
const LARGE_PROMPT_CHARACTERS = 2_000;

export interface RoutingTaskComplexity {
    score: number;
    reason?:
        | "stack trace"
        | "compiler output"
        | "test output"
        | "patch"
        | "multiple files"
        | "architecture"
        | "code block"
        | "large prompt"
        | "multi-step task";
}

function hasLargeCodeBlock(text: string): boolean {
    for (const match of text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
        const body = match[1] ?? "";
        if (body.length >= 160 || body.split("\n").length >= 6) return true;
    }
    return false;
}

function sourcePathCount(text: string): number {
    const paths = new Set<string>();
    for (const match of text.matchAll(SOURCE_PATH)) {
        const path = match[1];
        if (path) paths.add(path.toLowerCase());
    }
    return paths.size;
}

/** Score inexpensive, explainable first-turn complexity signals. */
export function routingTaskComplexity(text: string): RoutingTaskComplexity {
    let score = 0;
    let reason: RoutingTaskComplexity["reason"];
    const add = (points: number, label: NonNullable<RoutingTaskComplexity["reason"]>): void => {
        score += points;
        reason ??= label;
    };

    if (STACK_TRACE_SIGNAL.test(text)) add(2, "stack trace");
    if (PATCH_SIGNAL.test(text)) add(2, "patch");
    if (COMPILER_OUTPUT_SIGNAL.test(text)) add(2, "compiler output");
    if (TEST_OUTPUT_SIGNAL.test(text)) add(2, "test output");
    if (ARCHITECTURE_SIGNAL.test(text)) add(2, "architecture");
    if (sourcePathCount(text) >= 2) add(2, "multiple files");
    if (hasLargeCodeBlock(text)) add(1, "code block");
    if (text.length > LARGE_PROMPT_CHARACTERS) add(1, "large prompt");
    if (
        BASE_TASK_SIGNAL.test(text) ||
        LARGE_SCOPE_SIGNAL.test(text) ||
        SEQUENCED_STEP.test(text) ||
        ADDITIONAL_ACTION.test(text) ||
        EXPANDED_PROMPT_COMMAND.test(text.trim()) ||
        (text.match(LIST_STEP)?.length ?? 0) > 1 ||
        (text.match(ACTION_LINE)?.length ?? 0) > 1
    ) {
        add(2, "multi-step task");
    }
    return reason === undefined ? { score } : { score, reason };
}

/** Route work that is likely to need several decisions or tool turns to base. */
export function routingTaskNeedsBase(text: string): boolean {
    return routingTaskComplexity(text).score >= 2;
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
