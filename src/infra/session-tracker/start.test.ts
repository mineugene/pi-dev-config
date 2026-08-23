import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import type { TrackerPaths } from "./paths.ts";
import { ensureTrackerDaemon } from "./start.ts";
import { sendTrackerRequest } from "./transport.ts";

let directory: string | undefined;
afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
});

describe("lazy tracker daemon startup", () => {
    test("starts once and accepts requests from a standalone Node process", async () => {
        directory = await mkdtemp(join(tmpdir(), "pidev-tracker-start-"));
        const paths: TrackerPaths = {
            directory,
            socket: join(directory, "session-tracker.sock"),
            status: join(directory, "session-tracker.status"),
            lock: join(directory, "session-tracker.lock"),
            log: join(directory, "session-tracker.log"),
        };
        const starts = await Promise.all([ensureTrackerDaemon(paths), ensureTrackerDaemon(paths)]);
        expect(starts).toEqual([true, true]);
        // A fresh daemon may recover live pane hints from tmux; only the response contract is stable.
        const snapshot = await sendTrackerRequest(paths.socket, { type: "snapshot" });
        expect(snapshot.ok).toBe(true);
        if (snapshot.ok) expect(Array.isArray(snapshot.records)).toBe(true);
        await sendTrackerRequest(paths.socket, { type: "shutdown" });
        for (let attempt = 0; attempt < 20; attempt += 1) {
            try {
                await access(paths.socket);
                await new Promise((resolve) => setTimeout(resolve, 10));
            } catch {
                return;
            }
        }
        throw new Error("Tracker socket remained after shutdown");
    });
});
