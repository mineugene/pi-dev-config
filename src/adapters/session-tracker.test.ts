import type {
    ExtensionAPI,
    ExtensionCommandContext,
    ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { AgentPaneRecord } from "../domain/session-tracker.ts";
import registerSessionTracker from "./session-tracker.ts";

type Handler = (event: unknown, ctx?: ExtensionContext) => Promise<unknown> | unknown;
type CommandHandler = (args: string, ctx: ExtensionCommandContext) => Promise<void> | void;

function setup(classifyNeedsInput?: (text: string | undefined) => Promise<boolean>, paneId = "%1") {
    const handlers = new Map<string, Handler>();
    const eventHandlers = new Map<string, Handler>();
    const commands = new Map<string, CommandHandler>();
    const report = vi.fn(async () => true);
    const heartbeat = vi.fn(async () => true);
    const snapshot = vi.fn(async () => [] as AgentPaneRecord[]);
    const release = vi.fn(async () => true);
    const focusPane = vi.fn(async () => ({ ok: true }));
    const focusNext = vi.fn(async () => ({ ok: true, paneId: "%2" }));
    const setStatus = vi.fn();
    const ctx = {
        cwd: "/repo",
        mode: "tui",
        hasUI: true,
        isIdle: () => true,
        sessionManager: { getSessionId: () => "session-a" },
        ui: { notify: vi.fn(), select: vi.fn(), setStatus },
    };
    const pi = {
        getSessionName: () => undefined,
        on: (name: string, handler: Handler) => handlers.set(name, handler),
        events: {
            on: (name: string, handler: Handler) => {
                eventHandlers.set(name, handler);
                return vi.fn();
            },
        },
        registerCommand: (name: string, command: { handler: CommandHandler }) =>
            commands.set(name, command.handler),
        registerShortcut: vi.fn(),
    };
    registerSessionTracker(pi as unknown as ExtensionAPI, {
        ...(classifyNeedsInput ? { classifyNeedsInput } : {}),
        client: { focusNext, focusPane, heartbeat, release, report, snapshot },
        paneId,
        runtimeId: () => "run-a",
        tmux: {
            clearPaneMetadata: vi.fn(async () => true),
            currentClient: vi.fn(async () => "client-a"),
            setPaneMetadata: vi.fn(async () => {}),
        },
    });
    const emit = async (name: string, event: unknown = {}) =>
        handlers.get(name)?.(event, ctx as unknown as ExtensionContext);
    const emitBus = async (name: string, event: unknown = {}) => eventHandlers.get(name)?.(event);
    return {
        commands,
        ctx,
        emit,
        emitBus,
        focusNext,
        focusPane,
        heartbeat,
        release,
        report,
        setStatus,
        snapshot,
    };
}

const reportedStates = (report: ReturnType<typeof vi.fn>) =>
    report.mock.calls.map(([record]) => record.state);

afterEach(() => {
    vi.useRealTimers();
});

describe("Pi session tracker adapter", () => {
    test("disables itself when no tmux pane can be tracked", async () => {
        const harness = setup(undefined, "");
        expect(harness.commands).toEqual(new Map());
        await harness.emit("session_start");
        expect(harness.report).not.toHaveBeenCalled();
    });

    test("skips non-interactive and non-tmux processes", async () => {
        const harness = setup();
        harness.ctx.mode = "print";
        await harness.emit("session_start");
        expect(harness.report).not.toHaveBeenCalled();
    });

    test("does not redraw status when the tracked-session summary is unchanged", async () => {
        vi.useFakeTimers();
        const harness = setup();

        await harness.emit("session_start");
        await vi.advanceTimersByTimeAsync(3_000);

        expect(harness.setStatus).toHaveBeenCalledTimes(1);
        await harness.emit("session_shutdown");
    });

    test("reports lifecycle and real human permission waits", async () => {
        const harness = setup();
        await harness.emit("session_start");
        await harness.emit("agent_start");
        await harness.emitBus("pidev:bash_gate", { requiresHuman: true });
        await harness.emitBus("pidev:bash_gate_resolved", { requiresHuman: true });
        await harness.emit("agent_end", {
            messages: [
                {
                    role: "assistant",
                    content: [{ type: "text", text: "Which target should I use?" }],
                },
            ],
        });
        await harness.emit("agent_settled");
        expect(reportedStates(harness.report)).toEqual([
            "idle",
            "working",
            "needs-permission",
            "working",
            "needs-input",
        ]);

        await harness.emit("session_shutdown");
        expect(harness.release).toHaveBeenCalledWith("%1", "run-a");
    });

    test("uses the configured narrow classifier when deterministic signals are absent", async () => {
        const classify = vi.fn(async () => true);
        const harness = setup(classify);
        await harness.emit("session_start");
        await harness.emit("agent_start");
        await harness.emit("agent_end", {
            messages: [
                {
                    role: "assistant",
                    content: [{ type: "text", text: "Could you clarify the deployment region?" }],
                },
            ],
        });
        await harness.emit("agent_settled");
        expect(classify).toHaveBeenCalledWith(
            "Could you clarify the deployment region?",
            harness.ctx,
        );
        expect(reportedStates(harness.report)).toEqual(["idle", "working", "needs-input"]);
    });

    test("stays working until overlapping background agents finish", async () => {
        const harness = setup();
        await harness.emit("session_start");
        await harness.emitBus("subagents:started", { id: "a" });
        await harness.emitBus("subagents:started", { id: "b" });
        await harness.emitBus("subagents:completed", { id: "a" });
        await harness.emitBus("subagents:failed", { id: "b" });
        expect(reportedStates(harness.report)).toEqual(["idle", "working", "idle"]);
    });

    test("shows a picker and delegates verified focus to the daemon", async () => {
        const harness = setup();
        const target: AgentPaneRecord = {
            paneId: "%2",
            runtimeId: "run-b",
            cwd: "/work/backend",
            state: "needs-input",
            seq: 1,
            heartbeatAt: 1,
            title: "API tests",
        };
        harness.snapshot.mockResolvedValue([target]);
        harness.ctx.ui.select.mockResolvedValue("needs-input · API tests · %2");
        await harness.emit("session_start");
        await harness.commands.get("pi-sessions")?.(
            "",
            harness.ctx as unknown as ExtensionCommandContext,
        );
        expect(harness.focusPane).toHaveBeenCalledWith("%2", "client-a");

        await harness.commands.get("next-session")?.(
            "",
            harness.ctx as unknown as ExtensionCommandContext,
        );
        expect(harness.focusNext).toHaveBeenCalledWith("%1", "client-a");
    });
});
