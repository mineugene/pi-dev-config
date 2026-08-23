import { expect, test } from "vitest";

import registerPrGuard from "./pr-guard.ts";

type Handler = (
    event: { toolName: string; input: { command: string } },
    ctx: { sessionManager: { getEntries(): unknown[] } },
) => Promise<{ block: boolean; reason: string } | undefined>;

function setup(): Handler {
    let handler: Handler | undefined;
    registerPrGuard({
        on: (event: string, callback: Handler) => {
            if (event === "tool_call") handler = callback;
        },
    } as unknown as Parameters<typeof registerPrGuard>[0]);
    if (!handler) throw new Error("PR guard was not registered");
    return handler;
}

const event = { toolName: "bash", input: { command: "gh pr create --fill" } };

test("allows PR writes from the to-pr skill", async () => {
    const result = await setup()(event, {
        sessionManager: {
            getEntries: () => [
                {
                    type: "message",
                    message: { role: "user", content: "<!-- pidev:to-pr-skill -->" },
                },
            ],
        },
    });

    expect(result).toBeUndefined();
});

test("allows PR writes after an earlier to-pr invocation", async () => {
    const result = await setup()(event, {
        sessionManager: {
            getEntries: () => [
                {
                    type: "message",
                    message: { role: "user", content: "<!-- pidev:to-pr-skill -->" },
                },
                { type: "message", message: { role: "user", content: "go ahead" } },
            ],
        },
    });

    expect(result).toBeUndefined();
});

test("directs other PR writes to the to-pr skill", async () => {
    const result = await setup()(event, {
        sessionManager: {
            getEntries: () => [
                { type: "message", message: { role: "user", content: "create it" } },
            ],
        },
    });

    expect(result).toEqual({
        block: true,
        reason: "Creating or editing a pull request is only allowed via /skill:to-pr; reads (list, view, diff) are fine. Ask me to run /skill:to-pr.",
    });
});

test("ignores PR words that are only arguments", async () => {
    const ctx = {
        sessionManager: {
            getEntries: () => [
                { type: "message", message: { role: "user", content: "inspect it" } },
            ],
        },
    };

    expect(
        await setup()({ toolName: "bash", input: { command: 'echo "gh pr create"' } }, ctx),
    ).toBeUndefined();
    expect(
        await setup()({ toolName: "bash", input: { command: 'rg "gh pr create" src' } }, ctx),
    ).toBeUndefined();
});

test("still blocks a PR command inside a shell -c script", async () => {
    const result = await setup()(
        { toolName: "bash", input: { command: 'bash -c "gh pr create --fill"' } },
        {
            sessionManager: {
                getEntries: () => [
                    { type: "message", message: { role: "user", content: "create it" } },
                ],
            },
        },
    );

    expect(result?.block).toBe(true);
});

test("still blocks a wrapped PR command", async () => {
    const result = await setup()(
        { toolName: "bash", input: { command: "sudo gh pr create --fill" } },
        {
            sessionManager: {
                getEntries: () => [
                    { type: "message", message: { role: "user", content: "create it" } },
                ],
            },
        },
    );

    expect(result?.block).toBe(true);
});

test("still blocks a PR command inside find -exec", async () => {
    const ctx = {
        sessionManager: {
            getEntries: () => [
                { type: "message", message: { role: "user", content: "create it" } },
            ],
        },
    };

    const plain = await setup()(
        { toolName: "bash", input: { command: "find . -exec gh pr create {} \\;" } },
        ctx,
    );
    expect(plain?.block).toBe(true);

    const nested = await setup()(
        { toolName: "bash", input: { command: "find . -exec sh -c 'gh pr create' \\;" } },
        ctx,
    );
    expect(nested?.block).toBe(true);
});
