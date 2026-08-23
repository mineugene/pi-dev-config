import { spawn } from "node:child_process";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface InteractiveProcessOptions {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal | undefined;
}

export interface InteractiveProcessResult {
    code: number | null;
    signal: NodeJS.Signals | null;
}

function hasInteractiveTerminal(): boolean {
    return (
        process.stdin.isTTY === true &&
        process.stdout.isTTY === true &&
        process.stderr.isTTY === true
    );
}

function runChild(
    command: string,
    args: readonly string[],
    options: InteractiveProcessOptions,
): Promise<InteractiveProcessResult> {
    if (options.signal?.aborted) return Promise.reject(new Error("Operation aborted"));

    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: options.env,
            stdio: "inherit",
        });
        let settled = false;

        const finish = (callback: () => void): void => {
            if (settled) return;
            settled = true;
            options.signal?.removeEventListener("abort", abort);
            callback();
        };
        const abort = (): void => {
            try {
                child.kill("SIGTERM");
            } catch {
                // The child may already have exited between the abort and signal delivery.
            }
        };

        child.once("error", (error) => finish(() => reject(error)));
        child.once("close", (code, signal) => finish(() => resolve({ code, signal })));
        options.signal?.addEventListener("abort", abort, { once: true });
        if (options.signal?.aborted) abort();
    });
}

/**
 * Runs a terminal-bound process without proxying its input or output.
 *
 * In TUI mode Pi is suspended while the child inherits the controlling terminal.
 * Other modes require all standard streams to be TTYs.
 */
export async function runInteractiveProcess(
    ctx: ExtensionContext,
    command: string,
    args: readonly string[],
    options: InteractiveProcessOptions = {},
): Promise<InteractiveProcessResult> {
    if (options.signal?.aborted) throw new Error("Operation aborted");

    if (ctx.mode !== "tui") {
        if (!hasInteractiveTerminal()) {
            throw new Error("Cannot run an interactive process without an interactive terminal");
        }
        return await runChild(command, args, options);
    }

    return await ctx.ui.custom(async (tui, _theme, _keybindings, done) => {
        let stopped = false;
        try {
            tui.stop();
            stopped = true;
            if (process.stdout.isTTY) process.stdout.write("\x1b[2J\x1b[H");
            done(await runChild(command, args, options));
        } finally {
            if (stopped) {
                tui.start();
                tui.requestRender(true);
            }
        }
        return { render: () => [], invalidate: () => {} };
    });
}
