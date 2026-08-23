import { createConnection } from "node:net";

import type { TrackerRequest, TrackerResponse } from "./protocol.ts";

const MAX_RESPONSE_BYTES = 1024 * 1024;

export function sendTrackerRequest(
    socketPath: string,
    request: TrackerRequest,
    timeoutMs = 1_000,
): Promise<TrackerResponse> {
    return new Promise((resolve, reject) => {
        const socket = createConnection(socketPath);
        let settled = false;
        let data = "";
        const finish = (error?: Error, response?: TrackerResponse) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            socket.destroy();
            if (error) reject(error);
            else if (response) resolve(response);
            else reject(new Error("Tracker closed without a response."));
        };
        const timer = setTimeout(() => finish(new Error("Tracker request timed out.")), timeoutMs);
        timer.unref();
        socket.setEncoding("utf8");
        socket.once("connect", () => socket.write(`${JSON.stringify(request)}\n`));
        socket.on("data", (chunk: string) => {
            data += chunk;
            if (data.length > MAX_RESPONSE_BYTES) {
                finish(new Error("Tracker response is too large."));
                return;
            }
            const newline = data.indexOf("\n");
            if (newline < 0) return;
            try {
                const parsed = JSON.parse(data.slice(0, newline)) as TrackerResponse;
                if (
                    typeof parsed !== "object" ||
                    parsed === null ||
                    typeof parsed.ok !== "boolean"
                ) {
                    throw new Error("Invalid tracker response.");
                }
                finish(undefined, parsed);
            } catch (error) {
                finish(error instanceof Error ? error : new Error("Invalid tracker response."));
            }
        });
        socket.once("end", () => finish());
        socket.once("error", (error) => finish(error));
    });
}
