import { describe, expect, test, vi } from "vitest";
import registerTodo from "./todo.ts";

type TodoStatus = "pending" | "in_progress" | "completed";

interface TodoItem {
    content: string;
    status: TodoStatus;
}

interface ContextStub {
    hasUI: boolean;
    sessionManager: {
        getEntries(): unknown[];
    };
    ui: {
        setWidget(id: string, widget: unknown): void;
    };
}

type Handler = (event: { message?: { role: string } }, ctx: ContextStub) => Promise<void> | void;

interface TodoToolStub {
    execute(
        toolCallId: string,
        params: { items: TodoItem[] },
        signal: undefined,
        onUpdate: undefined,
        ctx: ContextStub,
    ): Promise<unknown>;
}

function setup() {
    let tool: TodoToolStub | undefined;
    const handlers = new Map<string, Handler>();
    const appendEntry = vi.fn();
    const emit = vi.fn();
    const setWidget = vi.fn();
    const ctx = {
        hasUI: true,
        sessionManager: { getEntries: () => [] },
        ui: { setWidget },
    } satisfies ContextStub;
    const pi = {
        registerTool(definition: unknown) {
            tool = definition as TodoToolStub;
        },
        registerCommand() {},
        on(eventName: string, handler: Handler) {
            handlers.set(eventName, handler);
        },
        appendEntry,
        events: { emit },
    };

    registerTodo(pi as unknown as Parameters<typeof registerTodo>[0]);
    if (!tool) throw new Error("todo tool was not registered");

    return { appendEntry, ctx, emit, handlers, setWidget, tool };
}

async function start(harness: ReturnType<typeof setup>): Promise<void> {
    await harness.handlers.get("session_start")?.({}, harness.ctx);
}

describe("todo widget lifecycle", () => {
    test("clears a completed list when the next user message starts", async () => {
        const harness = setup();
        await start(harness);

        await harness.tool.execute(
            "todo-1",
            { items: [{ content: "Finish", status: "completed" }] },
            undefined,
            undefined,
            harness.ctx,
        );
        expect(harness.setWidget.mock.calls.at(-1)?.[1]).toBeTypeOf("function");
        expect(harness.emit).toHaveBeenCalledWith("pidev:task_complete", { source: "todo" });

        await harness.handlers.get("message_start")?.(
            { message: { role: "assistant" } },
            harness.ctx,
        );
        expect(harness.appendEntry).toHaveBeenCalledTimes(1);

        await harness.handlers.get("message_start")?.({ message: { role: "user" } }, harness.ctx);
        expect(harness.appendEntry).toHaveBeenNthCalledWith(2, "pidev-todo", { items: [] });
        expect(harness.setWidget.mock.calls.at(-1)?.[1]).toBeUndefined();

        await harness.tool.execute(
            "todo-2",
            { items: [{ content: "Start again", status: "in_progress" }] },
            undefined,
            undefined,
            harness.ctx,
        );
        expect(harness.setWidget.mock.calls.at(-1)?.[1]).toBeTypeOf("function");
    });

    test("keeps an unfinished list across user messages", async () => {
        const harness = setup();
        await start(harness);

        await harness.tool.execute(
            "todo-1",
            { items: [{ content: "Keep working", status: "in_progress" }] },
            undefined,
            undefined,
            harness.ctx,
        );
        await harness.handlers.get("message_start")?.({ message: { role: "user" } }, harness.ctx);

        expect(harness.appendEntry).toHaveBeenCalledTimes(1);
        expect(harness.setWidget.mock.calls.at(-1)?.[1]).toBeTypeOf("function");
    });
});
