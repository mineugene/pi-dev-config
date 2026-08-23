import { describe, expect, test, vi } from "vitest";

import type { AgentPaneRecord } from "../../domain/session-tracker.ts";
import { SessionTrackerService } from "./service.ts";

const record = (overrides: Partial<AgentPaneRecord> = {}): AgentPaneRecord => ({
    paneId: "%1",
    runtimeId: "run-a",
    cwd: "/repo",
    state: "idle",
    seq: 1,
    heartbeatAt: 100,
    ...overrides,
});

function setup() {
    const paneIds = new Set(["%1", "%2", "%3", "%4"]);
    const tmux = {
        clearPaneMetadata: vi.fn(async () => true),
        focusPane: vi.fn(async (paneId: string) => paneIds.has(paneId)),
        listPaneIds: vi.fn(async () => paneIds),
        readAllPaneMetadata: vi.fn(
            async () =>
                [] as Array<{
                    paneId: string;
                    metadata: {
                        runtimeId: string;
                        cwd: string;
                        state: "idle" | "working" | "needs-input" | "needs-permission";
                    };
                }>,
        ),
        setPaneMetadata: vi.fn(async () => {}),
    };
    const writeStatus = vi.fn(async () => {});
    let now = 100;
    const service = new SessionTrackerService(tmux, { now: () => now, writeStatus });
    return { paneIds, service, setNow: (value: number) => (now = value), tmux, writeStatus };
}

describe("session tracker service", () => {
    test("reports, snapshots, and runtime-safe releases", async () => {
        const { service, tmux } = setup();
        expect(await service.handle({ type: "report", record: record() })).toMatchObject({
            ok: true,
        });
        expect(await service.handle({ type: "snapshot" })).toEqual({
            ok: true,
            records: [record()],
        });

        await service.handle({ type: "release", paneId: "%1", runtimeId: "old" });
        expect((await service.handle({ type: "snapshot" })).records).toHaveLength(1);
        expect(tmux.clearPaneMetadata).not.toHaveBeenCalled();

        await service.handle({ type: "release", paneId: "%1", runtimeId: "run-a" });
        expect((await service.handle({ type: "snapshot" })).records).toEqual([]);
        expect(tmux.clearPaneMetadata).toHaveBeenCalledWith("%1", "run-a");
    });

    test("handles heartbeats, direct focus, and shutdown", async () => {
        const { service, tmux } = setup();
        await service.handle({ type: "heartbeat", record: record() });
        expect(await service.handle({ type: "focus-pane", paneId: "%1" })).toEqual({
            ok: true,
            paneId: "%1",
        });
        expect(tmux.focusPane).toHaveBeenCalledWith("%1", undefined);
        expect(await service.handle({ type: "shutdown" })).toEqual({ ok: true, shutdown: true });
    });

    test("focuses the next live pane in attention order", async () => {
        const { paneIds, service, tmux } = setup();
        for (const next of [
            record({ paneId: "%4", state: "idle" }),
            record({ paneId: "%3", state: "working" }),
            record({ paneId: "%2", state: "needs-input" }),
            record({ paneId: "%1", state: "needs-permission" }),
        ]) {
            await service.handle({ type: "report", record: next });
        }
        paneIds.delete("%1");
        expect(await service.handle({ type: "focus-next", currentPaneId: "%4" })).toEqual({
            ok: true,
            paneId: "%2",
        });
        expect(tmux.focusPane).toHaveBeenCalledWith("%2", undefined);
    });

    test("seeds restart hints but expires them without a live heartbeat", async () => {
        const { service, setNow, tmux } = setup();
        tmux.readAllPaneMetadata.mockResolvedValue([
            {
                paneId: "%1",
                metadata: { runtimeId: "run-a", cwd: "/repo", state: "working" },
            },
        ]);
        await service.seedFromTmux();
        expect((await service.handle({ type: "snapshot" })).records).toHaveLength(1);

        setNow(10_000);
        await service.handle({
            type: "heartbeat",
            record: record({ seq: 1, heartbeatAt: 10_000, state: "idle" }),
        });
        setNow(39_999);
        expect((await service.handle({ type: "snapshot" })).records).toHaveLength(1);

        setNow(40_001);
        expect((await service.handle({ type: "snapshot" })).records).toEqual([]);
        expect(tmux.clearPaneMetadata).toHaveBeenCalledWith("%1", "run-a");
    });
});
