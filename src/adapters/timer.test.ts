import type {
    CustomEntry,
    EntryRenderOptions,
    ExtensionAPI,
    ExtensionContext,
    EntryRenderer as PiEntryRenderer,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PiDevConfig } from "../infra/config.ts";
import registerTimer from "./timer.ts";

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;
type TimerEntryRenderer = PiEntryRenderer<unknown>;

function setup(config: PiDevConfig = {}) {
    const handlers = new Map<string, Handler[]>();
    const entries: Array<{ type: "custom"; customType: string; data: unknown }> = [];
    let entryRenderer: TimerEntryRenderer | undefined;
    const pi = {
        on(name: string, handler: Handler) {
            const registered = handlers.get(name) ?? [];
            registered.push(handler);
            handlers.set(name, registered);
        },
        appendEntry(customType: string, data: unknown) {
            entries.push({ type: "custom", customType, data });
        },
        registerEntryRenderer(_customType: string, renderer: TimerEntryRenderer) {
            entryRenderer = renderer;
        },
    };
    const setWorkingMessage = vi.fn();
    const setHiddenThinkingLabel = vi.fn();
    let isThinkingBlockHidden = true;
    const ctx = {
        mode: "tui",
        sessionManager: { getBranch: () => entries },
        ui: {
            setWorkingMessage,
            setHiddenThinkingLabel,
            isThinkingBlockHidden: () => isThinkingBlockHidden,
        },
    };

    registerTimer(pi as unknown as ExtensionAPI, { current: config });

    async function emit(name: string, event: unknown = {}): Promise<void> {
        for (const handler of handlers.get(name) ?? []) {
            await handler(event, ctx as unknown as ExtensionContext);
        }
    }

    function entryComponent(index: number): ReturnType<TimerEntryRenderer> {
        if (!entryRenderer) throw new Error("Entry renderer was not registered");
        const entry = entries[index];
        if (!entry) throw new Error(`No timer entry at index ${index}`);
        return entryRenderer(
            entry as unknown as CustomEntry<unknown>,
            {} as EntryRenderOptions,
            {
                fg: (_colour: string, text: string) => text,
                italic: (text: string) => text,
            } as unknown as Parameters<TimerEntryRenderer>[2],
        );
    }

    function renderEntry(index: number): string[] {
        return entryComponent(index)?.render(80) ?? [];
    }

    return {
        emit,
        entries,
        entryComponent,
        renderEntry,
        setHiddenThinkingLabel,
        setThinkingBlockHidden: (hidden: boolean) => {
            isThinkingBlockHidden = hidden;
        },
        setWorkingMessage,
    };
}

async function startFirstTurn(timer: ReturnType<typeof setup>): Promise<void> {
    await timer.emit("session_start");
    await timer.emit("agent_start");
    await timer.emit("turn_start", { timestamp: 1_000, turnIndex: 0 });
}

describe("elapsed timer", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("shows and finalises the working timer", async () => {
        const timer = setup();

        await timer.emit("session_start");
        await timer.emit("agent_start");
        expect(timer.setWorkingMessage).toHaveBeenLastCalledWith("Working... 0ms");

        await vi.advanceTimersByTimeAsync(862);
        await timer.emit("agent_end");
        expect(timer.setWorkingMessage).toHaveBeenLastCalledWith("Working... 862ms");

        await timer.emit("agent_settled");
        expect(vi.getTimerCount()).toBe(0);
    });

    it("renders one durable thinking timer card", async () => {
        const timer = setup();
        await startFirstTurn(timer);

        await timer.emit("message_update", {
            assistantMessageEvent: { type: "thinking_start", contentIndex: 0 },
        });
        await vi.advanceTimersByTimeAsync(800);
        expect(timer.renderEntry(0)).toEqual([" Thinking... 800ms"]);

        await vi.advanceTimersByTimeAsync(62);
        await timer.emit("message_update", {
            assistantMessageEvent: { type: "text_start", contentIndex: 1 },
        });
        expect(timer.renderEntry(0)).toEqual([" Thinking... 862ms"]);
        expect(timer.entryComponent(1)).toBeUndefined();
    });

    it("shows linked plain-text summaries and restores them", async () => {
        const timer = setup();
        await startFirstTurn(timer);

        const partial = {
            content: [
                {
                    type: "thinking",
                    thinking: "**Inspect the code**\n\nDetails\n\n## Add the display",
                },
            ],
        };
        await timer.emit("message_update", {
            assistantMessageEvent: { type: "thinking_start", contentIndex: 0, partial },
        });
        await vi.advanceTimersByTimeAsync(800);
        expect(timer.renderEntry(0)).toEqual([
            " Thinking... 800ms",
            " ├─ Inspect the code",
            " ╰─ Add the display",
        ]);

        timer.setThinkingBlockHidden(false);
        expect(timer.renderEntry(0)).toEqual([" Thinking... 800ms"]);
        timer.setThinkingBlockHidden(true);

        await timer.emit("message_update", {
            assistantMessageEvent: { type: "text_start", contentIndex: 1, partial },
        });
        await timer.emit("session_start");
        expect(timer.renderEntry(0)).toEqual([
            " Thinking... 800ms",
            " ├─ Inspect the code",
            " ╰─ Add the display",
        ]);
    });

    it("does not restart when the provider refreshes the same thinking block", async () => {
        const timer = setup();
        await startFirstTurn(timer);

        await timer.emit("message_update", {
            assistantMessageEvent: { type: "thinking_start", contentIndex: 0 },
        });
        await vi.advanceTimersByTimeAsync(10_000);
        await timer.emit("message_update", {
            assistantMessageEvent: { type: "thinking_end", contentIndex: 0, content: "partial" },
        });
        await timer.emit("message_update", {
            assistantMessageEvent: { type: "thinking_start", contentIndex: 0 },
        });
        await vi.advanceTimersByTimeAsync(1_000);
        await timer.emit("message_update", {
            assistantMessageEvent: { type: "text_start", contentIndex: 1 },
        });

        expect(timer.renderEntry(0)).toEqual([" Thinking... 11s"]);
    });

    it("freezes the old timer while the next turn updates", async () => {
        const timer = setup();
        await startFirstTurn(timer);

        await timer.emit("message_update", {
            assistantMessageEvent: { type: "thinking_start", contentIndex: 0 },
        });
        await vi.advanceTimersByTimeAsync(862);
        await timer.emit("message_update", {
            assistantMessageEvent: { type: "text_start", contentIndex: 1 },
        });
        await timer.emit("turn_end");

        await timer.emit("turn_start", { timestamp: 2_000, turnIndex: 1 });
        await timer.emit("message_update", {
            assistantMessageEvent: { type: "thinking_start", contentIndex: 0 },
        });
        await vi.advanceTimersByTimeAsync(500);

        expect(timer.renderEntry(0)).toEqual([" Thinking... 862ms"]);
        expect(timer.renderEntry(2)).toEqual([" Thinking... 500ms"]);
    });

    it("restores frozen thinking timer cards", async () => {
        const timer = setup();
        await startFirstTurn(timer);

        await timer.emit("message_update", {
            assistantMessageEvent: { type: "thinking_start", contentIndex: 0 },
        });
        await vi.advanceTimersByTimeAsync(1_500);
        await timer.emit("message_end", { message: { role: "assistant" } });
        expect(timer.renderEntry(0)).toEqual([" Thinking... 1s"]);

        await timer.emit("session_start");
        expect(timer.renderEntry(0)).toEqual([" Thinking... 1s"]);
    });

    it("is on by default and can be disabled", async () => {
        const timer = setup({ timer: { enabled: false } });

        await timer.emit("session_start");
        await timer.emit("agent_start");
        await timer.emit("turn_start", { timestamp: 1_000, turnIndex: 0 });
        await vi.advanceTimersByTimeAsync(1_000);

        expect(timer.setWorkingMessage).not.toHaveBeenCalled();
        expect(timer.setHiddenThinkingLabel).not.toHaveBeenCalled();
        expect(timer.entries).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("cleans up its ticker on session shutdown", async () => {
        const timer = setup();

        await timer.emit("session_start");
        await timer.emit("agent_start");
        expect(vi.getTimerCount()).toBe(1);

        await timer.emit("session_shutdown");
        expect(vi.getTimerCount()).toBe(0);
    });
});
