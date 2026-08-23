import { expect, test, vi } from "vitest";

const { runInteractiveProcess } = vi.hoisted(() => ({ runInteractiveProcess: vi.fn() }));

vi.mock("../infra/interactive-terminal.ts", () => ({ runInteractiveProcess }));

import registerCommit from "./commit-tool.ts";

type CommitTool = {
    execute(
        toolCallId: string,
        params: { subject: string; body?: string },
        signal: AbortSignal | undefined,
        onUpdate: undefined,
        ctx: { cwd: string },
    ): Promise<unknown>;
};

test("commit delegates terminal execution with conventional Git arguments", async () => {
    let tool: CommitTool | undefined;
    registerCommit({
        registerTool: (definition: unknown) => (tool = definition as CommitTool),
    } as unknown as Parameters<typeof registerCommit>[0]);
    if (!tool) throw new Error("commit tool was not registered");
    const controller = new AbortController();
    const ctx = { cwd: "/worktree" };
    runInteractiveProcess.mockResolvedValue({ code: 0, signal: null });

    await expect(
        tool.execute(
            "commit-1",
            { subject: "feat(core): add runner", body: "Tested." },
            controller.signal,
            undefined,
            ctx,
        ),
    ).resolves.toMatchObject({ content: [{ type: "text", text: "Commit created." }] });
    expect(runInteractiveProcess).toHaveBeenCalledWith(
        ctx,
        "git",
        ["commit", "-m", "feat(core): add runner", "-m", "Tested."],
        { cwd: "/worktree", env: process.env, signal: controller.signal },
    );
});

test("commit reports a failed interactive Git result", async () => {
    let tool: CommitTool | undefined;
    registerCommit({
        registerTool: (definition: unknown) => (tool = definition as CommitTool),
    } as unknown as Parameters<typeof registerCommit>[0]);
    if (!tool) throw new Error("commit tool was not registered");
    runInteractiveProcess.mockResolvedValue({ code: 1, signal: null });

    await expect(
        tool.execute("commit-1", { subject: "fix(core): report failure" }, undefined, undefined, {
            cwd: "/worktree",
        }),
    ).rejects.toThrow("git commit exited with code 1");
});
