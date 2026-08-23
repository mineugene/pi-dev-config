/**
 * Plan to-do list.
 *
 * pi ships no built-in plan mode, so this adds a `todo` tool the model calls
 * while working a multi-step task. Each call replaces the whole list (like
 * Claude Code's todo write), and the list renders as a persistent widget above
 * the editor while a plan is active. A completed list stays visible through the
 * response, then clears when the next user message starts. `/todos` prints the
 * current list. State is persisted as a custom session entry and restored on reload.
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Box, truncateToWidth } from "@earendil-works/pi-tui";
import { type Static, Type } from "typebox";

const WIDGET_ID = "pidev-todo";
const ENTRY_TYPE = "pidev-todo";
const COMPLETED_ICON = "\uf14a"; // nf-fa-square_check
const IN_PROGRESS_ICON = "\uf146"; // nf-fa-square_minus
const PENDING_ICON = "\uf0c8"; // nf-fa-square

const itemSchema = Type.Object({
    content: Type.String({ description: "Short imperative description of the step." }),
    status: Type.Union(
        [Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("completed")],
        {
            description: "Step status.",
        },
    ),
});
const todoSchema = Type.Object({
    items: Type.Array(itemSchema, {
        description: "The full to-do list. Replaces any previous list.",
    }),
});

type TodoItem = Static<typeof itemSchema>;
type TodoInput = Static<typeof todoSchema>;

// Single source of truth for the active list; the widget reads it at render time.
let items: TodoItem[] = [];

function icon(status: TodoItem["status"], theme: Theme): string {
    if (status === "completed") return theme.fg("success", COMPLETED_ICON);
    if (status === "in_progress") return theme.fg("accent", IN_PROGRESS_ICON);
    return theme.fg("dim", PENDING_ICON);
}

function renderLines(theme: Theme): string[] {
    if (items.length === 0) return [];
    const done = items.filter((item) => item.status === "completed").length;
    const header = theme.fg("dim", `To-dos (${done}/${items.length})`);
    const lines = items.map((item) => {
        const body = item.status === "completed" ? theme.fg("dim", item.content) : item.content;
        return `${icon(item.status, theme)}  ${body}`;
    });
    return [header, ...lines];
}

/** Re-attach (or clear) the widget so it reflects the current list. */
function refreshWidget(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;
    if (items.length === 0) {
        ctx.ui.setWidget(WIDGET_ID, undefined);
        return;
    }
    ctx.ui.setWidget(WIDGET_ID, (_tui, theme) => {
        const content = {
            render: (width: number) =>
                renderLines(theme).map((line) => truncateToWidth(line, width)),
            invalidate: () => {},
        };
        const box = new Box(1, 0);
        box.addChild(content);
        return box;
    });
}

function summary(): string {
    if (items.length === 0) return "To-do list cleared.";
    return items.map((item) => `- [${item.status}] ${item.content}`).join("\n");
}

/** Restore the last persisted list from the session on start/reload. */
function restore(ctx: ExtensionContext): void {
    items = [];
    for (const entry of ctx.sessionManager.getEntries()) {
        if (entry.type === "custom" && entry.customType === ENTRY_TYPE) {
            const data = entry.data as { items?: TodoItem[] } | undefined;
            if (data?.items) items = data.items;
        }
    }
}

export default function registerTodo(pi: ExtensionAPI): void {
    pi.registerTool({
        name: "todo",
        label: "todo",
        description:
            "Track a multi-step plan as a to-do list shown above the prompt. Pass the full list every call; it replaces the previous one. Mark exactly one item in_progress while you work it, and completed as soon as it is done.",
        parameters: todoSchema,
        async execute(_toolCallId, params: TodoInput, _signal, _onUpdate, ctx) {
            const wasComplete =
                items.length > 0 && items.every((item) => item.status === "completed");
            items = params.items;
            pi.appendEntry(ENTRY_TYPE, { items });
            refreshWidget(ctx);
            pi.events.emit("pidev:todo_widget_updated", {});
            const done = items.filter((item) => item.status === "completed").length;
            if (!wasComplete && items.length > 0 && done === items.length) {
                pi.events.emit("pidev:task_complete", { source: "todo" });
            }
            return {
                content: [
                    { type: "text", text: `Updated to-do list (${done}/${items.length} done).` },
                ],
                details: {},
            };
        },
    });

    pi.registerCommand("todos", {
        description: "Show the current plan to-do list",
        handler: async (_args, ctx) => {
            ctx.ui.notify(summary(), "info");
        },
    });

    pi.on("session_start", async (_event, ctx) => {
        restore(ctx);
        refreshWidget(ctx);
        pi.events.emit("pidev:todo_widget_updated", {});
    });

    pi.on("message_start", async (event, ctx) => {
        if (
            event.message.role !== "user" ||
            items.length === 0 ||
            items.some((item) => item.status !== "completed")
        ) {
            return;
        }
        items = [];
        pi.appendEntry(ENTRY_TYPE, { items });
        refreshWidget(ctx);
        pi.events.emit("pidev:todo_widget_updated", {});
    });

    pi.on("session_shutdown", async () => {
        items = [];
    });
}
