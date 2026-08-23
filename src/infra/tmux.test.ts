import { describe, expect, test, vi } from "vitest";

import { createTmux, type TmuxExec } from "./tmux.ts";

function fakeExec(outputs: Record<string, string> = {}) {
    const calls: string[][] = [];
    const exec: TmuxExec = vi.fn(async (args) => {
        calls.push([...args]);
        return outputs[args.join(" ")] ?? "";
    });
    return { calls, exec };
}

describe("tmux pane metadata", () => {
    test("writes owned options with argument-safe calls", async () => {
        const { calls, exec } = fakeExec();
        const tmux = createTmux(exec);
        await tmux.setPaneMetadata("%7", {
            runtimeId: "run; still-data",
            sessionId: "session one",
            cwd: "/tmp/a b",
            state: "working",
            title: "api; tests",
        });
        expect(calls).toContainEqual([
            "set-option",
            "-p",
            "-t",
            "%7",
            "@pidev_title",
            "api; tests",
        ]);
        expect(calls.every((args) => args[0] === "set-option")).toBe(true);
    });

    test("reads metadata and clears it only for the matching runtime", async () => {
        const { calls, exec } = fakeExec({
            "show-options -pqv -t %7 @pidev_agent": "1\n",
            "show-options -pqv -t %7 @pidev_runtime": "run-a\n",
            "show-options -pqv -t %7 @pidev_state": "needs-input\n",
            "show-options -pqv -t %7 @pidev_cwd": "/repo\n",
        });
        const tmux = createTmux(exec);
        expect(await tmux.readPaneMetadata("%7")).toMatchObject({
            runtimeId: "run-a",
            state: "needs-input",
            cwd: "/repo",
        });

        await tmux.clearPaneMetadata("%7", "old-run");
        expect(calls.some((args) => args.includes("-u"))).toBe(false);

        await tmux.clearPaneMetadata("%7", "run-a");
        expect(calls).toContainEqual(["set-option", "-pu", "-t", "%7", "@pidev_runtime"]);
    });

    test("verifies the pane before focusing with an optional client", async () => {
        const { calls, exec } = fakeExec({ "list-panes -a -F #{pane_id}": "%2\n%7\n" });
        const tmux = createTmux(exec);
        expect(await tmux.focusPane("%7", "client-1")).toBe(true);
        expect(calls.at(-1)).toEqual(["switch-client", "-c", "client-1", "-t", "%7"]);
        expect(await tmux.focusPane("%9")).toBe(false);
    });
});
