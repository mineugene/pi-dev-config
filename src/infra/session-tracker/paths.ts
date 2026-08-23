import { chmod, lstat, mkdir } from "node:fs/promises";

export interface TrackerPaths {
    directory: string;
    socket: string;
    status: string;
    lock: string;
    log: string;
}

export function trackerPaths(uid = process.getuid?.()): TrackerPaths {
    if (uid === undefined) throw new Error("The session tracker requires a Unix user ID.");
    const directory = process.env.PIDEV_SESSION_TRACKER_DIR ?? `/tmp/pi-dev-config-${uid}`;
    return {
        directory,
        socket: `${directory}/session-tracker.sock`,
        status: `${directory}/session-tracker.status`,
        lock: `${directory}/session-tracker.lock`,
        log: `${directory}/session-tracker.log`,
    };
}

export async function ensureTrackerDirectory(paths = trackerPaths()): Promise<void> {
    await mkdir(paths.directory, { recursive: true, mode: 0o700 });
    const stat = await lstat(paths.directory);
    const uid = process.getuid?.();
    if (!stat.isDirectory() || stat.isSymbolicLink() || (uid !== undefined && stat.uid !== uid)) {
        throw new Error(`Unsafe tracker directory: ${paths.directory}`);
    }
    await chmod(paths.directory, 0o700);
}
