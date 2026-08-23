import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import registerPromptSlim from "./prompt-slim.ts";

const DOCS = `base\n\nPi documentation (read only when asked):
- Main documentation: /pi/README.md
- Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)`;

function setup(enabled = true) {
    let before: ((event: { prompt: string; systemPrompt: string }) => unknown) | undefined;
    let command: ((args: string) => Promise<void>) | undefined;
    const sendUserMessage = vi.fn();
    const pi = {
        on: (event: string, handler: typeof before) => {
            if (event === "before_agent_start") before = handler;
        },
        registerCommand: (_name: string, options: { handler: typeof command }) => {
            command = options.handler;
        },
        sendUserMessage,
    } as unknown as ExtensionAPI;
    registerPromptSlim(pi, { current: { promptSlim: { enabled } } });
    return { beforeAgentStart: () => before, command: () => command, sendUserMessage };
}

describe("Pi prompt slimming adapter", () => {
    it("omits Pi documentation on ordinary turns and restores it for Pi help", () => {
        const { beforeAgentStart } = setup();
        const handler = beforeAgentStart();

        expect(handler?.({ prompt: "fix tests", systemPrompt: DOCS })).toEqual({
            systemPrompt: "base",
        });
        expect(
            handler?.({ prompt: "how do Pi extensions work?", systemPrompt: DOCS }),
        ).toBeUndefined();
    });

    it("routes /pi questions through a model turn with documentation available", async () => {
        const { command, sendUserMessage } = setup();

        await command()?.("How do themes work?");

        expect(sendUserMessage).toHaveBeenCalledWith("Pi help request: How do themes work?");
    });

    it("can be disabled without removing /pi", () => {
        const { beforeAgentStart, command } = setup(false);

        expect(beforeAgentStart()?.({ prompt: "fix tests", systemPrompt: DOCS })).toBeUndefined();
        expect(command()).toBeTypeOf("function");
    });
});
