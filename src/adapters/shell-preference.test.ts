import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import registerShellPreference from "./shell-preference.ts";

const { commandAvailable } = vi.hoisted(() => ({
    commandAvailable: vi.fn<(command: string) => boolean>(),
}));
vi.mock("../infra/command-availability.ts", () => ({ commandAvailable }));

interface PromptOptions {
    toolSnippets: Record<string, string>;
    promptGuidelines: string[];
}

function beforeAgentStart(): (event: { systemPromptOptions: PromptOptions }) => void {
    let handler: ((event: { systemPromptOptions: PromptOptions }) => void) | undefined;
    registerShellPreference({
        on: (event: string, callback: typeof handler) => {
            if (event === "before_agent_start") handler = callback;
        },
    } as unknown as ExtensionAPI);
    if (!handler) throw new Error("before_agent_start handler was not registered");
    return handler;
}

describe("shell preference prompt", () => {
    it("rewrites the Bash snippet and adds a guideline when both tools exist", () => {
        commandAvailable.mockReturnValue(true);
        const options: PromptOptions = {
            toolSnippets: { bash: "Execute bash commands (ls, grep, find, etc.)" },
            promptGuidelines: [],
        };

        beforeAgentStart()({ systemPromptOptions: options });

        expect(options.toolSnippets.bash).toBe("Execute bash commands (ls, rg, fd, etc.)");
        expect(options.promptGuidelines).toHaveLength(1);
        expect(options.promptGuidelines[0]).toContain("`rg` instead of `grep`");
    });

    it("leaves the prompt untouched when neither tool exists", () => {
        commandAvailable.mockReturnValue(false);
        const options: PromptOptions = {
            toolSnippets: { bash: "Execute bash commands (ls, grep, find, etc.)" },
            promptGuidelines: [],
        };

        beforeAgentStart()({ systemPromptOptions: options });

        expect(options.toolSnippets.bash).toBe("Execute bash commands (ls, grep, find, etc.)");
        expect(options.promptGuidelines).toEqual([]);
    });
});
