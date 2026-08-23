import { describe, expect, test } from "vitest";

import {
    type AgentPaneRecord,
    applyReport,
    formatSessionSummary,
    isAgentPaneRecord,
    pruneRecords,
    sortByAttention,
} from "./session-tracker.ts";

const record = (overrides: Partial<AgentPaneRecord> = {}): AgentPaneRecord => ({
    paneId: "%1",
    runtimeId: "run-a",
    cwd: "/repo",
    state: "idle",
    seq: 1,
    heartbeatAt: 100,
    ...overrides,
});

describe("session tracker records", () => {
    test("validates records crossing the daemon boundary", () => {
        expect(isAgentPaneRecord(record())).toBe(true);
        expect(isAgentPaneRecord(record({ paneId: "%1;kill-server" }))).toBe(false);
        expect(isAgentPaneRecord({ ...record(), title: { unsafe: true } })).toBe(false);
    });

    test("keeps only the newest report from a pane runtime", () => {
        const initial = new Map([["%1", record({ seq: 2, state: "working" })]]);
        expect(applyReport(initial, record({ seq: 1, state: "idle" })).get("%1")?.state).toBe(
            "working",
        );
        expect(
            applyReport(initial, record({ seq: 3, state: "needs-input" })).get("%1")?.state,
        ).toBe("needs-input");
        expect(
            applyReport(initial, record({ runtimeId: "run-b", seq: 1 })).get("%1")?.runtimeId,
        ).toBe("run-b");
    });

    test("sorts attention before active and idle panes", () => {
        const records = sortByAttention([
            record({ paneId: "%4", state: "idle" }),
            record({ paneId: "%9", cwd: "/a/web", state: "working" }),
            record({ paneId: "%2", state: "needs-input" }),
            record({ paneId: "%1", state: "needs-permission" }),
            record({ paneId: "%8", cwd: "/z/api", state: "working" }),
        ]);
        expect(records.map(({ paneId }) => paneId)).toEqual(["%1", "%2", "%8", "%9", "%4"]);
    });

    test("prunes stale and dead panes", () => {
        const records = [record({ paneId: "%1", heartbeatAt: 100 }), record({ paneId: "%2" })];
        expect(pruneRecords(records, 131, 30, new Set(["%1"]))).toEqual([]);
    });

    test("formats a compact status projection", () => {
        expect(
            formatSessionSummary([
                record({ state: "needs-permission" }),
                record({ paneId: "%2", state: "needs-input" }),
                record({ paneId: "%3", state: "working" }),
                record({ paneId: "%4", state: "idle" }),
            ]),
        ).toBe("π total 4 · !1 · ?1 · ▶1");
    });
});
