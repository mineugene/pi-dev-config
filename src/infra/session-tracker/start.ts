import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { open, rm, stat, truncate } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { ensureTrackerDirectory, type TrackerPaths, trackerPaths } from "./paths.ts";
import { sendTrackerRequest } from "./transport.ts";

const START_WAIT_MS = 2_000;
const STALE_LOCK_MS = 5_000;
const MAX_LOG_BYTES = 64 * 1024;

const delay = (milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function isReady(paths: TrackerPaths): Promise<boolean> {
    try {
        return (await sendTrackerRequest(paths.socket, { type: "snapshot" }, 250)).ok;
    } catch {
        return false;
    }
}

async function waitUntilReady(paths: TrackerPaths): Promise<boolean> {
    const deadline = Date.now() + START_WAIT_MS;
    while (Date.now() < deadline) {
        if (await isReady(paths)) return true;
        await delay(50);
    }
    return false;
}

async function trimLog(path: string): Promise<void> {
    try {
        if ((await stat(path)).size > MAX_LOG_BYTES) await truncate(path, 0);
    } catch {
        // The first daemon start has no log yet.
    }
}

async function staleLock(path: string): Promise<boolean> {
    try {
        return Date.now() - (await stat(path)).mtimeMs > STALE_LOCK_MS;
    } catch {
        return false;
    }
}

export async function ensureTrackerDaemon(paths = trackerPaths()): Promise<boolean> {
    try {
        await ensureTrackerDirectory(paths);
        if (await isReady(paths)) return true;

        let lock: Awaited<ReturnType<typeof open>> | undefined;
        try {
            lock = await open(paths.lock, "wx", 0o600);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") return false;
            if (await waitUntilReady(paths)) return true;
            if (!(await staleLock(paths.lock))) return false;
            await rm(paths.lock, { force: true });
            try {
                lock = await open(paths.lock, "wx", 0o600);
            } catch {
                return false;
            }
        }

        try {
            if (await isReady(paths)) return true;
            await trimLog(paths.log);
            const logFd = openSync(paths.log, "a", 0o600);
            try {
                const entry = fileURLToPath(new URL("./daemon-entry.ts", import.meta.url));
                const child = spawn(
                    process.execPath,
                    ["--disable-warning=ExperimentalWarning", entry],
                    {
                        detached: true,
                        env: { ...process.env, PIDEV_SESSION_TRACKER_DIR: paths.directory },
                        stdio: ["ignore", logFd, logFd],
                    },
                );
                child.unref();
            } finally {
                closeSync(logFd);
            }
            return await waitUntilReady(paths);
        } finally {
            await lock.close();
            await rm(paths.lock, { force: true });
        }
    } catch {
        return false;
    }
}
