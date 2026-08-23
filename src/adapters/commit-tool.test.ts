import { beforeEach, expect, test, vi } from "vitest";

const { runInteractiveProcess, runCapturedProcess, repoSignsCommits } = vi.hoisted(() => ({
    runInteractiveProcess: vi.fn(),
    runCapturedProcess: vi.fn(),
    repoSignsCommits: vi.fn(),
}));

vi.mock("../infra/interactive-terminal.ts", () => ({
    runInteractiveProcess,
    runCapturedProcess,
}));
vi.mock("../infra/git.ts", () => ({ repoSignsCommits }));

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

function register(): CommitTool {
    let tool: CommitTool | undefined;
    registerCommit({
        registerTool: (definition: unknown) => (tool = definition as CommitTool),
    } as unknown as Parameters<typeof registerCommit>[0]);
    if (!tool) throw new Error("commit tool was not registered");
    return tool;
}

beforeEach(() => {
    vi.clearAllMocks();
});

test("commit advertises strict-prefer constrained sampling", () => {
    let definition: { constrainedSampling?: unknown } | undefined;
    registerCommit({
        registerTool: (registered: unknown) =>
            (definition = registered as { constrainedSampling?: unknown }),
    } as unknown as Parameters<typeof registerCommit>[0]);

    expect(definition?.constrainedSampling).toEqual({
        type: "json_schema",
        strict: "prefer",
    });
});

test("signed repo hands the terminal to git with conventional arguments", async () => {
    const tool = register();
    const controller = new AbortController();
    const ctx = { cwd: "/worktree" };
    repoSignsCommits.mockReturnValue(true);
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
    expect(runCapturedProcess).not.toHaveBeenCalled();
});

test("unsigned repo runs captured without touching the terminal", async () => {
    const tool = register();
    const ctx = { cwd: "/worktree" };
    repoSignsCommits.mockReturnValue(false);
    runCapturedProcess.mockResolvedValue({ code: 0, signal: null, stdout: "", stderr: "" });

    await expect(
        tool.execute("commit-2", { subject: "chore: tidy" }, undefined, undefined, ctx),
    ).resolves.toMatchObject({ content: [{ type: "text", text: "Commit created." }] });
    expect(runCapturedProcess).toHaveBeenCalledWith("git", ["commit", "-m", "chore: tidy"], {
        cwd: "/worktree",
        env: process.env,
        signal: undefined,
    });
    expect(runInteractiveProcess).not.toHaveBeenCalled();
});

test("commit reports a failed captured result with git stderr", async () => {
    const tool = register();
    repoSignsCommits.mockReturnValue(false);
    runCapturedProcess.mockResolvedValue({
        code: 1,
        signal: null,
        stdout: "",
        stderr: "nothing to commit\n",
    });

    await expect(
        tool.execute("commit-3", { subject: "fix(core): report failure" }, undefined, undefined, {
            cwd: "/worktree",
        }),
    ).rejects.toThrow("git commit exited with code 1: nothing to commit");
});
