import { beforeEach, expect, test, vi } from "vitest";

import type { PiDevConfig } from "../infra/config.ts";
import registerCommitSign from "./commit-sign.ts";

vi.mock("node:child_process", () => ({
    execFileSync: vi.fn((_cmd: string, args: string[]) => {
        if (args.includes("commit.gpgsign")) return "true\n";
        throw new Error("exit 1");
    }),
}));

interface BlockResult {
    block: boolean;
    reason: string;
}
type Handler = (
    event: { toolName: string; input: { command: string; timeout?: number } },
    ctx: { hasUI: boolean; ui: { confirm: () => Promise<boolean>; notify: () => void } },
) => Promise<BlockResult | undefined>;

type CommitSignConfig = NonNullable<PiDevConfig["commitSign"]>;

function setup(commitSign?: CommitSignConfig): {
    handler: Handler;
    ui: ReturnType<typeof createUi>;
} {
    const handlers: Record<string, Handler> = {};
    const config: PiDevConfig = commitSign === undefined ? {} : { commitSign };
    registerCommitSign(
        {
            on: (event: string, callback: Handler) => {
                handlers[event] = callback;
            },
        } as never,
        { current: config },
    );
    const sessionStart = handlers.session_start;
    if (!sessionStart) throw new Error("session_start was not registered");
    const handler = handlers.tool_call;
    if (!handler) throw new Error("tool_call was not registered");

    const ui = createUi();
    void sessionStart({} as never, { hasUI: true, cwd: "/repo", ui } as never);
    return { handler, ui };
}

function createUi() {
    return {
        confirm: vi.fn(async () => true),
        notify: vi.fn(),
    };
}

beforeEach(() => {
    vi.clearAllMocks();
});

test("redirects a bash git commit to the commit tool in confirm mode", async () => {
    const { handler, ui } = setup();
    const result = await handler({ toolName: "bash", input: { command: "git commit -m 'x'" } }, {
        hasUI: true,
        ui,
    } as never);

    expect(result?.block).toBe(true);
    expect(result?.reason).toMatch(/commit tool/);
    expect(ui.confirm).not.toHaveBeenCalled();
});

test("redirects a bash git commit to the commit tool in warn mode", async () => {
    const { handler, ui } = setup({ mode: "warn" });
    const result = await handler({ toolName: "bash", input: { command: "git commit -m 'x'" } }, {
        hasUI: true,
        ui,
    } as never);

    expect(result?.block).toBe(true);
    expect(result?.reason).toMatch(/commit tool/);
    expect(ui.notify).not.toHaveBeenCalled();
});

test("warn mode notifies and allows other signing subcommands", async () => {
    const { handler, ui } = setup({ mode: "warn" });
    const result = await handler({ toolName: "bash", input: { command: "git rebase main" } }, {
        hasUI: true,
        ui,
    } as never);

    expect(result).toBeUndefined();
    expect(ui.notify).toHaveBeenCalledOnce();
});

test("confirm mode asks before other signing subcommands", async () => {
    const { handler, ui } = setup();
    const ctx = { hasUI: true, ui } as never;

    await expect(
        handler({ toolName: "bash", input: { command: "git rebase main" } }, ctx),
    ).resolves.toBeUndefined();
    expect(ui.confirm).toHaveBeenCalledOnce();

    ui.confirm.mockResolvedValue(false);
    await expect(
        handler({ toolName: "bash", input: { command: "git rebase main" } }, ctx),
    ).resolves.toEqual({ block: true, reason: "Commit cancelled before signing." });
});

test("block mode refuses all signing subcommands", async () => {
    const { handler } = setup({ mode: "block" });
    const result = await handler({ toolName: "bash", input: { command: "git rebase main" } }, {
        hasUI: true,
        ui: createUi(),
    } as never);

    expect(result?.block).toBe(true);
    expect(result?.reason).toMatch(/pidev commitSign.mode = block/);
});

test("blocks a too-short timeout before the commit-tool redirect", async () => {
    const { handler } = setup();
    const result = await handler(
        { toolName: "bash", input: { command: "git commit -m 'x'", timeout: 10 } },
        { hasUI: true, ui: createUi() } as never,
    );

    expect(result?.block).toBe(true);
    expect(result?.reason).toMatch(/timeout/);
});

test("allows non-signing commands", async () => {
    const { handler, ui } = setup();
    const result = await handler({ toolName: "bash", input: { command: "git status" } }, {
        hasUI: true,
        ui,
    } as never);

    expect(result).toBeUndefined();
    expect(ui.confirm).not.toHaveBeenCalled();
});

test("blocks confirm-mode signing in a headless session", async () => {
    const { handler, ui } = setup();
    const result = await handler({ toolName: "bash", input: { command: "git rebase main" } }, {
        hasUI: false,
        ui,
    } as never);

    expect(result?.block).toBe(true);
    expect(result?.reason).toMatch(/unavailable in this mode/);
});
