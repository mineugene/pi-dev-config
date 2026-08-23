import { mkdtemp, readFile, rm } from "node:fs/promises";
import { connect } from "node:net";
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

const delay = (milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function fakeTmux() {
    return {
        clearPaneMetadata: vi.fn(async () => true),
        focusPane: vi.fn(async () => true),
        listPaneIds: vi.fn(async () => new Set(["%1", "%2"])),
        readAllPaneMetadata: vi.fn(async () => []),
        setPaneMetadata: vi.fn(async () => {}),
    };
}

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
        server = await startTrackerServer({
            socketPath,
            statusPath,
            tmux: fakeTmux(),
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

    test("keeps serving after a client disconnects before reading its response", async () => {
        dir = await mkdtemp(join(tmpdir(), "pidev-tracker-test-"));
        const socketPath = join(dir, "tracker.sock");
        const statusPath = join(dir, "tracker.status");
        server = await startTrackerServer({
            socketPath,
            statusPath,
            tmux: fakeTmux(),
        });

        // Pausing keeps the response unread in the kernel queue, so destroying the
        // client resets the connection and errors the daemon's socket.
        const gone = connect(socketPath);
        gone.pause();
        gone.write(`${JSON.stringify({ type: "snapshot" })}\n`);
        await delay(100);
        gone.destroy();
        await delay(150);

        expect(await sendTrackerRequest(socketPath, { type: "snapshot" })).toEqual({
            ok: true,
            records: [],
        });
    });

    test("a superseded daemon stops writing the status projection", async () => {
        dir = await mkdtemp(join(tmpdir(), "pidev-tracker-test-"));
        const socketPath = join(dir, "tracker.sock");
        const statusPath = join(dir, "tracker.status");
        const first = await startTrackerServer({
            socketPath,
            statusPath,
            tmux: fakeTmux(),
            pruneMs: 40,
        });
        await sendTrackerRequest(socketPath, { type: "report", record });

        const second = await startTrackerServer({
            socketPath,
            statusPath,
            tmux: fakeTmux(),
            pruneMs: 40,
        });
        server = second;
        const replacement = { ...record, paneId: "%2", runtimeId: "run-b" };
        await sendTrackerRequest(socketPath, { type: "report", record });
        await sendTrackerRequest(socketPath, { type: "report", record: replacement });

        await delay(300);
        expect(await readFile(statusPath, "utf8")).toBe("π total 2 · !0 · ?0 · ▶2\n");

        await first.close();
        expect(await sendTrackerRequest(socketPath, { type: "snapshot" })).toEqual({
            ok: true,
            records: [record, replacement],
        });
    });
});
