import { chmod, mkdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname } from "node:path";

import type { Tmux } from "../tmux.ts";
import { parseTrackerRequest } from "./protocol.ts";
import { SessionTrackerService, type TrackerTmux } from "./service.ts";
import { writeStatusProjection } from "./status.ts";

const MAX_REQUEST_BYTES = 64 * 1024;
const DEFAULT_PRUNE_MS = 10_000;

interface TrackerServerOptions {
    socketPath: string;
    statusPath: string;
    tmux: TrackerTmux | Tmux;
    pruneMs?: number;
}

export interface TrackerServer {
    close(): Promise<void>;
}

export async function startTrackerServer(options: TrackerServerOptions): Promise<TrackerServer> {
    await mkdir(dirname(options.socketPath), { recursive: true, mode: 0o700 });
    await rm(options.socketPath, { force: true });

    const service = new SessionTrackerService(options.tmux, {
        writeStatus: (status) => writeStatusProjection(options.statusPath, status),
    });
    await service.seedFromTmux();

    let closed = false;
    let pruneTimer: ReturnType<typeof setInterval> | undefined;
    let resolveClosed: (() => void) | undefined;
    const closedPromise = new Promise<void>((resolve) => {
        resolveClosed = resolve;
    });
    const server = createServer((socket) => {
        socket.setEncoding("utf8");
        let buffer = "";
        let handled = false;
        socket.on("data", (chunk: string) => {
            if (handled) return;
            buffer += chunk;
            if (buffer.length > MAX_REQUEST_BYTES) {
                handled = true;
                socket.end(`${JSON.stringify({ ok: false, error: "Request is too large." })}\n`);
                return;
            }
            const newline = buffer.indexOf("\n");
            if (newline < 0) return;
            handled = true;
            socket.pause();
            void (async () => {
                let parsed: unknown;
                try {
                    parsed = JSON.parse(buffer.slice(0, newline));
                } catch {
                    socket.end(`${JSON.stringify({ ok: false, error: "Invalid request." })}\n`);
                    return;
                }
                const request = parseTrackerRequest(parsed);
                if (!request) {
                    socket.end(`${JSON.stringify({ ok: false, error: "Invalid request." })}\n`);
                    return;
                }
                try {
                    const response = await service.handle(request);
                    socket.end(`${JSON.stringify(response)}\n`);
                    if (response.shutdown) setImmediate(() => void close());
                } catch (error) {
                    const message =
                        error instanceof Error ? error.message : "Tracker request failed.";
                    socket.end(`${JSON.stringify({ ok: false, error: message })}\n`);
                }
            })();
        });
    });

    const close = async (): Promise<void> => {
        if (closed) return closedPromise;
        closed = true;
        if (pruneTimer) clearInterval(pruneTimer);
        server.close(() => resolveClosed?.());
        await closedPromise;
        await Promise.all([
            rm(options.socketPath, { force: true }),
            rm(options.statusPath, { force: true }),
        ]);
    };

    await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => reject(error);
        server.once("error", onError);
        server.listen(options.socketPath, () => {
            server.off("error", onError);
            resolve();
        });
    });
    await chmod(options.socketPath, 0o600);

    pruneTimer = setInterval(() => void service.prune(true), options.pruneMs ?? DEFAULT_PRUNE_MS);
    pruneTimer.unref();

    return { close };
}
