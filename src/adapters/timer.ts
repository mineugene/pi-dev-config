/**
 * Elapsed timers for pi's working row and thinking blocks.
 *
 * Pi's hidden-thinking label is global, so changing it rewrites every old
 * label. This adapter suppresses that label and renders one durable timer card
 * per thinking turn instead. The cards preserve linked summaries without
 * exposing their bodies.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

import { formatDuration } from "../domain/duration.ts";
import type { PiDevConfig } from "../infra/config.ts";

const ENTRY_TYPE = "pidev-thinking-timer";
const TICK_MS = 100;
const WORKING_TEXT = "Working...";
const THINKING_TEXT = "Thinking...";

interface ThinkingTimerEntry {
    id: string;
    phase: "start" | "end";
    elapsedMs?: number;
    headings?: string[];
}

interface ThinkingTimerState {
    startedAt?: number | undefined;
    elapsedMs?: number | undefined;
    headings?: string[];
}

function elapsedSince(startedAt: number, now = performance.now()): number {
    return Math.max(0, now - startedAt);
}

function label(text: string, elapsedMs: number): string {
    return `${text} ${formatDuration(elapsedMs)}`;
}

function thinkingHidden(context: ExtensionContext | undefined): boolean {
    const ui = context?.ui as unknown as { isThinkingBlockHidden?: () => boolean } | undefined;
    return ui?.isThinkingBlockHidden?.() ?? true;
}

/** Extract current thinking summaries without exposing their bodies. */
function thinkingHeadings(message: unknown): string[] {
    if (typeof message !== "object" || message === null) return [];
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) return [];

    return content.flatMap((block) => {
        if (
            typeof block !== "object" ||
            block === null ||
            (block as { type?: unknown }).type !== "thinking" ||
            typeof (block as { thinking?: unknown }).thinking !== "string"
        ) {
            return [];
        }
        return (
            (block as { thinking: string }).thinking
                .match(/^(?:#{1,6}\s+.+|\*\*[^*\n]+\*\*)$/gm)
                ?.map((heading) =>
                    heading
                        .replace(/^\*\*|\*\*$/g, "")
                        .replace(/^#{1,6}\s+|\s+#+\s*$/g, "")
                        .trim(),
                ) ?? []
        );
    });
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
    if (
        value.headings !== undefined &&
        (!Array.isArray(value.headings) ||
            value.headings.some((heading) => typeof heading !== "string"))
    ) {
        return undefined;
    }
    return {
        id: value.id,
        phase: value.phase,
        ...(value.elapsedMs === undefined ? {} : { elapsedMs: value.elapsedMs as number }),
        ...(value.headings === undefined ? {} : { headings: value.headings as string[] }),
    };
}

export default function registerTimer(pi: ExtensionAPI, configRef: { current: PiDevConfig }): void {
    let ctx: ExtensionContext | undefined;
    let ticker: ReturnType<typeof setInterval> | undefined;
    let workingStartedAt: number | undefined;
    let lastWorkingLabel: string | undefined;
    let currentThinkingId: string | undefined;
    let entrySequence = 0;
    const thinkingTimers = new Map<string, ThinkingTimerState>();

    const enabled = (): boolean => configRef.current.timer?.enabled !== false;

    function setWorkingLabel(context: ExtensionContext, elapsedMs: number): void {
        const next = label(WORKING_TEXT, elapsedMs);
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
            ...(state.headings === undefined ? {} : { headings: state.headings }),
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
                const headings = currentState?.headings ?? [];
                const showSummaries = thinkingHidden(ctx);
                const timerLabel = label(THINKING_TEXT, elapsedMs);
                const timer = theme.italic(theme.fg("thinkingText", timerLabel));
                return [
                    truncateToWidth(` ${timer}`, width, ""),
                    ...(showSummaries
                        ? headings.map((heading, index) =>
                              truncateToWidth(
                                  ` ${theme.fg("thinkingText", `${index === headings.length - 1 ? "╰─" : "├─"} ${heading}`)}`,
                                  width,
                                  "",
                              ),
                          )
                        : []),
                ];
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
            if (data.headings) state.headings = data.headings;
            thinkingTimers.set(data.id, state);
        }
        if (enabled() && context.mode === "tui") context.ui.setHiddenThinkingLabel("");
    });

    pi.on("agent_start", (_event, context) => {
        if (!enabled() || context.mode !== "tui") return;
        ctx = context;
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

        const headings = "partial" in update ? thinkingHeadings(update.partial) : [];
        if (headings.length > 0) state.headings = headings;

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
        currentThinkingId = undefined;
        ctx = undefined;
        stopTicker();
    });

    pi.on("session_shutdown", () => {
        workingStartedAt = undefined;
        currentThinkingId = undefined;
        ctx = undefined;
        stopTicker();
    });
}
