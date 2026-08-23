import { describe, expect, test, vi } from "vitest";

import { TrackerClient } from "./client.ts";

describe("tracker client recovery", () => {
    test("starts the disposable daemon after a connection failure and retries", async () => {
        const send = vi
            .fn()
            .mockRejectedValueOnce(new Error("connect ENOENT"))
            .mockResolvedValueOnce({ ok: true, records: [] });
        const start = vi.fn(async () => true);
        const client = new TrackerClient({ socketPath: "/tmp/tracker.sock", send, start });

        expect(await client.snapshot()).toEqual([]);
        expect(start).toHaveBeenCalledOnce();
        expect(send).toHaveBeenCalledTimes(2);
    });

    test("fails quietly when the tracker cannot start", async () => {
        const client = new TrackerClient({
            socketPath: "/tmp/tracker.sock",
            send: vi.fn(async () => {
                throw new Error("offline");
            }),
            start: vi.fn(async () => false),
        });
        expect(await client.snapshot()).toBeUndefined();
    });
});
