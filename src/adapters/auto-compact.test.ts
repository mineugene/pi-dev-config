import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { PiDevConfig } from "../infra/config.ts";
import registerAutoCompact from "./auto-compact.ts";
import registerTodo from "./todo.ts";

type Handler = (event: unknown, ctx: unknown) => unknown;

interface Entry {
    type: string;
    message?: { role: string };
}

function assistant(): Entry {
    return { type: "message", message: { role: "assistant" } };
}

function setup(config: PiDevConfig = {}) {
    const handlers = new Map<string, Handler>();
    const compact = vi.fn();
    const notify = vi.fn();
    const pi = {
        on(eventName: string, handler: Handler) {
            handlers.set(eventName, handler);
        },
    } as unknown as ExtensionAPI;
    registerAutoCompact(pi, { current: config });

    const settle = (
        usage: { tokens: number | null; contextWindow: number } | undefined,
        entries: Entry[] = [],
    ) => {
        const ctx = {
            getContextUsage: () =>
                usage && { ...usage, percent: usage.tokens && usage.tokens / usage.contextWindow },
            sessionManager: { getBranch: () => entries },
            compact,
            ui: { notify },
        } as unknown as ExtensionContext;
        return handlers.get("agent_settled")?.({}, ctx);
    };

    /** Simulate ctx.compact()'s onError firing for the most recent compact() call. */
    const fail = (aborted: boolean) => {
        const options = compact.mock.calls.at(-1)?.[0] as
            | { onError?: (error: Error) => void }
            | undefined;
        const error = new Error(aborted ? "Compaction cancelled" : "context window exceeded");
        options?.onError?.(error);
    };

    return { compact, fail, handlers, notify, settle };
}

/** Drive the real todo tool so the shared plan state matches production. */
async function setTodos(items: { content: string; status: string }[]) {
    let tool: { execute: (...args: unknown[]) => Promise<unknown> } | undefined;
    const pi = {
        registerTool(definition: unknown) {
            tool = definition as typeof tool;
        },
        registerCommand() {},
        on() {},
        appendEntry() {},
        events: { emit() {} },
    };
    registerTodo(pi as unknown as ExtensionAPI);
    await tool?.execute("id", { items }, undefined, undefined, {
        hasUI: false,
        sessionManager: { getEntries: () => [] },
        ui: { setWidget() {} },
    });
}

describe("auto-compact", () => {
    beforeEach(async () => {
        await setTodos([]);
    });

    test("compacts at a task boundary once the soft band is reached", async () => {
        const { compact, settle } = setup();
        await settle({ tokens: 140_000, contextWindow: 200_000 });
        expect(compact).toHaveBeenCalledTimes(1);
    });

    test("holds in the soft band while the plan is unfinished", async () => {
        await setTodos([{ content: "ship it", status: "in_progress" }]);
        const { compact, settle } = setup();
        await settle({ tokens: 140_000, contextWindow: 200_000 });
        expect(compact).not.toHaveBeenCalled();
    });

    test("compacts mid-plan once the hard band is reached", async () => {
        await setTodos([{ content: "ship it", status: "in_progress" }]);
        const { compact, settle } = setup();
        await settle({ tokens: 175_000, contextWindow: 200_000 });
        expect(compact).toHaveBeenCalledTimes(1);
    });

    test("stays quiet on a small context and on unknown usage", async () => {
        const { compact, settle } = setup();
        await settle({ tokens: 20_000, contextWindow: 200_000 });
        await settle({ tokens: null, contextWindow: 200_000 });
        await settle(undefined);
        expect(compact).not.toHaveBeenCalled();
    });

    test("respects the cooldown after a recent compaction", async () => {
        const { compact, settle } = setup();
        await settle({ tokens: 190_000, contextWindow: 200_000 }, [
            { type: "compaction" },
            assistant(),
        ]);
        expect(compact).not.toHaveBeenCalled();

        await settle({ tokens: 190_000, contextWindow: 200_000 }, [
            { type: "compaction" },
            assistant(),
            assistant(),
        ]);
        expect(compact).toHaveBeenCalledTimes(1);
    });

    test("does not stack a second compaction while one is in flight", async () => {
        const { compact, settle } = setup();
        await settle({ tokens: 190_000, contextWindow: 200_000 });
        await settle({ tokens: 190_000, contextWindow: 200_000 });
        expect(compact).toHaveBeenCalledTimes(1);

        // Completing the first run re-arms the trigger.
        compact.mock.calls[0]?.[0].onComplete();
        await settle({ tokens: 190_000, contextWindow: 200_000 });
        expect(compact).toHaveBeenCalledTimes(2);
    });

    test("can be disabled through config", async () => {
        const { compact, settle } = setup({ autoCompact: { enabled: false } });
        await settle({ tokens: 190_000, contextWindow: 200_000 });
        expect(compact).not.toHaveBeenCalled();
    });

    test("stops retrying after a failed compaction and warns once", async () => {
        const { compact, fail, notify, settle } = setup();
        await settle({ tokens: 190_000, contextWindow: 200_000 });
        expect(compact).toHaveBeenCalledTimes(1);

        fail(false);
        await settle({ tokens: 190_000, contextWindow: 200_000 });
        expect(compact).toHaveBeenCalledTimes(1);
        expect(notify).toHaveBeenCalledTimes(1);
    });

    test("keeps compacting after an aborted compaction", async () => {
        const { compact, fail, notify, settle } = setup();
        await settle({ tokens: 190_000, contextWindow: 200_000 });
        fail(true);
        await settle({ tokens: 190_000, contextWindow: 200_000 });
        expect(compact).toHaveBeenCalledTimes(2);
        expect(notify).not.toHaveBeenCalled();
    });
});
