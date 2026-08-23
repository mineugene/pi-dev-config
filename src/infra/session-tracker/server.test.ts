import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { AgentPaneRecord } from "../../domain/session-tracker.ts";
import { sendTrackerRequest } from "./client.ts";
import { startTrackerServer, type TrackerServer } from "./server.ts";

const record: AgentPaneRecord = {
    paneId: "%1",
    runtimeId: "run-a",
    sessionId: "session-a",
    cwd: "/repo",
    state: "working",
    seq: 1,
    heartbeatAt: Date.now(),
};

let dir: string | undefined;
let server: TrackerServer | undefined;
afterEach(async () => {
    await server?.close();
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
    server = undefined;
});

describe("tracker Unix socket", () => {
    test("serves reports and snapshots and writes status atomically", async () => {
        dir = await mkdtemp(join(tmpdir(), "pidev-tracker-test-"));
        const socketPath = join(dir, "tracker.sock");
        const statusPath = join(dir, "tracker.status");
        const paneIds = new Set(["%1"]);
        server = await startTrackerServer({
            socketPath,
            statusPath,
            tmux: {
                clearPaneMetadata: vi.fn(async () => true),
                focusPane: vi.fn(async () => true),
                listPaneIds: vi.fn(async () => paneIds),
                readAllPaneMetadata: vi.fn(async () => []),
                setPaneMetadata: vi.fn(async () => {}),
            },
        });

        expect(await sendTrackerRequest(socketPath, { type: "report", record })).toEqual({
            ok: true,
        });
        expect(await sendTrackerRequest(socketPath, { type: "snapshot" })).toEqual({
            ok: true,
            records: [record],
        });
        expect(await readFile(statusPath, "utf8")).toBe("π total 1 · !0 · ?0 · ▶1\n");
    });
});
