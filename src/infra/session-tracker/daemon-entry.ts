import { createTmux } from "../tmux.ts";
import { ensureTrackerDirectory, trackerPaths } from "./paths.ts";
import { startTrackerServer } from "./server.ts";
import { sendTrackerRequest } from "./transport.ts";

const paths = trackerPaths();
await ensureTrackerDirectory(paths);

try {
    if ((await sendTrackerRequest(paths.socket, { type: "snapshot" }, 250)).ok) {
        process.exit(0);
    }
} catch {
    // Missing or stale socket. This process becomes the daemon.
}

const server = await startTrackerServer({
    socketPath: paths.socket,
    statusPath: paths.status,
    tmux: createTmux(),
});

let shuttingDown = false;
const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await server.close();
    process.exit(0);
};

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
