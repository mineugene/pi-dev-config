/**
 * Elapsed timers for pi's working row and thinking blocks.
 *
 * Pi's hidden-thinking label is global, so changing it rewrites every old
 * label. This adapter suppresses that label and renders one durable timer card
 * per thinking turn instead. The working row also rotates through curated verbs
 * (timer.workingVerbs); this adapter owns that message, so the verb and the
 * elapsed timer never fight over the same label.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

import { formatDuration } from "../domain/duration.ts";
import { pickWorkingVerb, WORKING_VERBS } from "../domain/working-verbs.ts";
import type { PiDevConfig } from "../infra/config.ts";

const ENTRY_TYPE = "pidev-thinking-timer";
const TICK_MS = 200;
const WORKING_TEXT = "Working...";
const THINKING_TEXT = "Thinking...";

interface ThinkingTimerEntry {
    id: string;
    phase: "start" | "end";
    elapsedMs?: number;
}

interface ThinkingTimerState {
    startedAt?: number | undefined;
    elapsedMs?: number | undefined;
}

function elapsedSince(startedAt: number, now = performance.now()): number {
    return Math.max(0, now - startedAt);
}

function label(text: string, elapsedMs: number): string {
    return `${text} ${formatDuration(elapsedMs)}`;
}

function parseEntry(data: unknown): ThinkingTimerEntry | undefined {
    if (typeof data !== "object" || data === null) return undefined;
    const value = data as Record<string, unknown>;
    if (typeof value.id !== "string" || (value.phase !== "start" && value.phase !== "end")) {
        return undefined;
    }
    if (
        value.elapsedMs !== undefined &&
        (typeof value.elapsedMs !== "number" || !Number.isFinite(value.elapsedMs))
    ) {
        return undefined;
    }
    return {
        id: value.id,
        phase: value.phase,
        ...(value.elapsedMs === undefined ? {} : { elapsedMs: value.elapsedMs as number }),
    };
}

export default function registerTimer(pi: ExtensionAPI, configRef: { current: PiDevConfig }): void {
    let ctx: ExtensionContext | undefined;
    let ticker: ReturnType<typeof setInterval> | undefined;
    let workingStartedAt: number | undefined;
    let lastWorkingLabel: string | undefined;
    let workingVerb: string | undefined;
    let currentThinkingId: string | undefined;
    let entrySequence = 0;
    const thinkingTimers = new Map<string, ThinkingTimerState>();

    const enabled = (): boolean => configRef.current.timer?.enabled !== false;

    /** Resolve the active verb list: built-ins unless replaced; false or empty yields none. */
    const verbs = (): readonly string[] => {
        const setting = configRef.current.timer?.workingVerbs;
        if (setting === false) return [];
        return setting && setting.length > 0 ? setting : WORKING_VERBS;
    };

    const workingText = (): string => (workingVerb ? `${workingVerb}...` : WORKING_TEXT);

    function setWorkingLabel(context: ExtensionContext, elapsedMs: number): void {
        const next = label(workingText(), elapsedMs);
        if (next === lastWorkingLabel) return;
        lastWorkingLabel = next;
        context.ui.setWorkingMessage(next);
    }

    function tick(context: ExtensionContext, now = performance.now()): void {
        if (workingStartedAt !== undefined) {
            setWorkingLabel(context, elapsedSince(workingStartedAt, now));
        }
    }

    function stopTicker(): void {
        if (ticker) clearInterval(ticker);
        ticker = undefined;
    }

    function startTicker(): void {
        if (ticker) return;
        ticker = setInterval(() => {
            if (ctx) tick(ctx);
        }, TICK_MS);
        ticker.unref();
    }

    function finishThinking(): void {
        if (!currentThinkingId) return;
        const state = thinkingTimers.get(currentThinkingId);
        if (!state || state.startedAt === undefined || state.elapsedMs !== undefined) return;

        state.elapsedMs = elapsedSince(state.startedAt);
        state.startedAt = undefined;
        pi.appendEntry(ENTRY_TYPE, {
            id: currentThinkingId,
            phase: "end",
            elapsedMs: state.elapsedMs,
        } satisfies ThinkingTimerEntry);
    }

    pi.registerEntryRenderer(ENTRY_TYPE, (entry, _options, theme) => {
        const data = parseEntry(entry.data);
        if (!enabled() || data?.phase !== "start") return undefined;
        if (!thinkingTimers.has(data.id)) return undefined;

        return {
            invalidate(): void {},
            render(width: number): string[] {
                const currentState = thinkingTimers.get(data.id);
                const elapsedMs =
                    currentState?.elapsedMs ??
                    (currentState?.startedAt === undefined
                        ? undefined
                        : elapsedSince(currentState.startedAt));
                if (elapsedMs === undefined) return [];
                const timer = theme.italic(
                    theme.fg("thinkingText", label(THINKING_TEXT, elapsedMs)),
                );
                return [truncateToWidth(` ${timer}`, width, "")];
            },
        };
    });

    pi.on("session_start", (_event, context) => {
        ctx = context;
        thinkingTimers.clear();
        currentThinkingId = undefined;
        for (const entry of context.sessionManager.getBranch()) {
            if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE) continue;
            const data = parseEntry(entry.data);
            if (!data) continue;
            const state = thinkingTimers.get(data.id) ?? {};
            if (data.phase === "end") state.elapsedMs = data.elapsedMs;
            thinkingTimers.set(data.id, state);
        }
        if (enabled() && context.mode === "tui") context.ui.setHiddenThinkingLabel("");
    });

    pi.on("agent_start", (_event, context) => {
        if (context.mode !== "tui") return;
        ctx = context;
        workingVerb = pickWorkingVerb(verbs());
        if (!enabled()) {
            if (workingVerb) context.ui.setWorkingMessage(workingText());
            return;
        }
        if (workingStartedAt === undefined) {
            workingStartedAt = performance.now();
            lastWorkingLabel = undefined;
        }
        tick(context);
        startTicker();
    });

    pi.on("turn_start", (event, context) => {
        if (!enabled() || context.mode !== "tui" || workingStartedAt === undefined) return;
        finishThinking();
        currentThinkingId = `${event.timestamp}-${event.turnIndex}-${entrySequence++}`;
        thinkingTimers.set(currentThinkingId, {});
    });

    pi.on("message_update", (event) => {
        if (!enabled() || !currentThinkingId) return;
        const update = event.assistantMessageEvent;
        const id = currentThinkingId;
        const state = thinkingTimers.get(id);
        if (!state) return;

        if (update.type === "thinking_start") {
            if (state.startedAt === undefined && state.elapsedMs === undefined) {
                state.startedAt = performance.now();
                pi.appendEntry(ENTRY_TYPE, {
                    id,
                    phase: "start",
                } satisfies ThinkingTimerEntry);
            }
            return;
        }
        if (update.type === "text_start" || update.type === "toolcall_start") finishThinking();
    });

    pi.on("message_end", (event) => {
        if (event.message.role === "assistant") finishThinking();
    });

    pi.on("turn_end", () => {
        finishThinking();
        currentThinkingId = undefined;
    });

    pi.on("agent_end", (_event, context) => {
        if (workingStartedAt === undefined) return;
        if (enabled()) tick(context);
        finishThinking();
    });

    pi.on("agent_settled", (_event, context) => {
        if (workingStartedAt === undefined) return;
        if (enabled()) tick(context);
        finishThinking();
        workingStartedAt = undefined;
        workingVerb = undefined;
        currentThinkingId = undefined;
        ctx = undefined;
        stopTicker();
    });

    pi.on("session_shutdown", () => {
        workingStartedAt = undefined;
        workingVerb = undefined;
        currentThinkingId = undefined;
        ctx = undefined;
        stopTicker();
    });
}
