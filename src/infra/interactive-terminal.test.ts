import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

import { runInteractiveProcess } from "./interactive-terminal.ts";

interface TuiStub {
    stop(): void;
    start(): void;
    requestRender(force?: boolean): void;
}

function createTuiContext(mode: "tui" | "print" = "tui") {
    const tui: TuiStub = {
        stop: vi.fn(),
        start: vi.fn(),
        requestRender: vi.fn(),
    };
    const ui = {
        custom: async <T>(
            factory: (
                tui: TuiStub,
                theme: undefined,
                keybindings: undefined,
                done: (result: T) => void,
            ) => Promise<unknown>,
        ) => {
            return await new Promise<T>((resolve, reject) => {
                void factory(tui, undefined, undefined, resolve).catch(reject);
            });
        },
    };
    return { ctx: { mode, ui }, tui };
}

const temporaryDirectories: string[] = [];
const stdio = [process.stdin, process.stdout, process.stderr] as const;
const originalTtyDescriptors = stdio.map((stream) =>
    Object.getOwnPropertyDescriptor(stream, "isTTY"),
);

function setStdioTty(value: boolean): void {
    for (const stream of stdio) {
        Object.defineProperty(stream, "isTTY", { configurable: true, value });
    }
}

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
    stdio.forEach((stream, index) => {
        const descriptor = originalTtyDescriptors[index];
        if (descriptor) Object.defineProperty(stream, "isTTY", descriptor);
        else Reflect.deleteProperty(stream, "isTTY");
    });
});

describe("runInteractiveProcess", () => {
    test("returns a successful child result and restores the TUI", async () => {
        const { ctx, tui } = createTuiContext();

        await expect(
            runInteractiveProcess(ctx as never, process.execPath, ["-e", "process.exit(0)"]),
        ).resolves.toEqual({
            code: 0,
            signal: null,
        });
        expect(tui.stop).toHaveBeenCalledOnce();
        expect(tui.start).toHaveBeenCalledOnce();
        expect(tui.requestRender).toHaveBeenCalledWith(true);
    });

    test("returns a non-zero child result", async () => {
        const { ctx } = createTuiContext();

        await expect(
            runInteractiveProcess(ctx as never, process.execPath, ["-e", "process.exit(23)"]),
        ).resolves.toEqual({
            code: 23,
            signal: null,
        });
    });

    test("restores the TUI when spawning fails", async () => {
        const { ctx, tui } = createTuiContext();

        await expect(
            runInteractiveProcess(ctx as never, "missing-interactive-command", []),
        ).rejects.toThrow("missing-interactive-command");
        expect(tui.start).toHaveBeenCalledOnce();
        expect(tui.requestRender).toHaveBeenCalledWith(true);
    });

    test("does not spawn an already aborted process", async () => {
        const controller = new AbortController();
        controller.abort();
        const { ctx, tui } = createTuiContext();

        await expect(
            runInteractiveProcess(ctx as never, process.execPath, ["-e", "process.exit(0)"], {
                signal: controller.signal,
            }),
        ).rejects.toThrow("Operation aborted");
        expect(tui.stop).not.toHaveBeenCalled();
    });

    test("terminates a running child on abort and restores the TUI", async () => {
        const controller = new AbortController();
        const { ctx, tui } = createTuiContext();
        const result = runInteractiveProcess(
            ctx as never,
            process.execPath,
            ["-e", "setTimeout(() => {}, 10_000)"],
            {
                signal: controller.signal,
            },
        );
        setTimeout(() => controller.abort(), 50);

        await expect(result).resolves.toEqual({ code: null, signal: "SIGTERM" });
        expect(tui.start).toHaveBeenCalledOnce();
        expect(tui.requestRender).toHaveBeenCalledWith(true);
    });

    test("passes requested cwd and environment to the child", async () => {
        const directory = mkdtempSync(join(tmpdir(), "interactive-terminal-"));
        temporaryDirectories.push(directory);
        const { ctx } = createTuiContext();
        const script = `process.exit(process.cwd() === ${JSON.stringify(directory)} && process.env.RUNNER_MARK === "yes" ? 0 : 1)`;

        await expect(
            runInteractiveProcess(ctx as never, process.execPath, ["-e", script], {
                cwd: directory,
                env: { RUNNER_MARK: "yes" },
            }),
        ).resolves.toEqual({ code: 0, signal: null });
    });

    test("rejects headless runs without an interactive terminal", async () => {
        setStdioTty(false);
        const { ctx } = createTuiContext("print");

        await expect(
            runInteractiveProcess(ctx as never, process.execPath, ["-e", "process.exit(0)"]),
        ).rejects.toThrow("interactive terminal");
    });
});
