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

test("allows PR writes from the create-pr skill", async () => {
    const result = await setup()(event, {
        sessionManager: {
            getEntries: () => [
                {
                    type: "message",
                    message: { role: "user", content: "<!-- pidev:create-pr-skill -->" },
                },
            ],
        },
    });

    expect(result).toBeUndefined();
});

test("directs other PR writes to the create-pr skill", async () => {
    const result = await setup()(event, {
        sessionManager: {
            getEntries: () => [
                { type: "message", message: { role: "user", content: "create it" } },
            ],
        },
    });

    expect(result).toEqual({
        block: true,
        reason: "Creating or editing a pull request is only allowed via /skill:create-pr; reads (list, view, diff) are fine. Ask me to run /skill:create-pr.",
    });
});
