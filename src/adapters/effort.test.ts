import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { describe, expect, test, vi } from "vitest";
import registerEffort from "./effort.ts";

interface ContextStub {
    model?: {
        id: string;
        reasoning: boolean;
        thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>;
    };
    ui: {
        select(title: string, options: string[]): Promise<string | undefined>;
        notify(message: string, level: "info" | "error"): void;
    };
}

interface CommandStub {
    getArgumentCompletions(
        prefix: string,
    ): Array<{ value: string; label: string; description: string }> | null;
    handler(args: string, ctx: ContextStub): Promise<void>;
}

interface ShortcutStub {
    handler(ctx: ContextStub): Promise<void>;
}

function setup() {
    let command: CommandStub | undefined;
    let shortcut: ShortcutStub | undefined;
    let shortcutKey: string | undefined;
    let current: ThinkingLevel = "medium";

    const setThinkingLevel = vi.fn((level: ThinkingLevel) => {
        current = level;
    });
    const getThinkingLevel = vi.fn(() => current);
    const pi = {
        registerCommand(name: string, definition: unknown) {
            if (name === "effort") command = definition as CommandStub;
        },
        registerShortcut(key: string, definition: unknown) {
            shortcutKey = key;
            shortcut = definition as ShortcutStub;
        },
        setThinkingLevel,
        getThinkingLevel,
    };

    registerEffort(pi as unknown as Parameters<typeof registerEffort>[0]);
    if (!command || !shortcut) throw new Error("effort controls were not registered");
    return { command, shortcut, shortcutKey, setThinkingLevel, getThinkingLevel };
}

function context(
    selection?: string,
    model: ContextStub["model"] = { id: "reasoner", reasoning: true },
) {
    const select = vi.fn(async () => selection);
    const notify = vi.fn();
    return {
        ctx: { model, ui: { select, notify } } satisfies ContextStub,
        select,
        notify,
    };
}

describe("effort command", () => {
    test("sets a supported direct level", async () => {
        const { command, setThinkingLevel } = setup();
        const { ctx, notify, select } = context(undefined, {
            id: "reasoner",
            reasoning: true,
            thinkingLevelMap: { xhigh: "xhigh", max: "max" },
        });

        await command.handler(" MAX ", ctx);

        expect(setThinkingLevel).toHaveBeenCalledWith("max");
        expect(notify).toHaveBeenCalledWith("Effort level: max", "info");
        expect(select).not.toHaveBeenCalled();
    });

    test("opens a selector with levels supported by the current model", async () => {
        const { command, setThinkingLevel } = setup();
        const { ctx, select } = context("low");

        await command.handler("", ctx);

        expect(select).toHaveBeenCalledWith("Effort level (current: medium)", [
            "off",
            "minimal",
            "low",
            "medium",
            "high",
        ]);
        expect(setThinkingLevel).toHaveBeenCalledWith("low");
    });

    test("rejects unsupported and invalid direct levels", async () => {
        const { command, setThinkingLevel } = setup();
        const unsupported = context();

        await command.handler("max", unsupported.ctx);
        await command.handler("ultra", unsupported.ctx);

        expect(setThinkingLevel).not.toHaveBeenCalled();
        expect(unsupported.notify).toHaveBeenNthCalledWith(
            1,
            "max effort is not supported by reasoner. Supported: off, minimal, low, medium, high",
            "error",
        );
        expect(unsupported.notify).toHaveBeenNthCalledWith(
            2,
            "Usage: /effort [off|minimal|low|medium|high|xhigh|max]",
            "error",
        );
    });

    test("offers direct-form completions", () => {
        const { command } = setup();

        expect(command.getArgumentCompletions("xh")).toEqual([
            { value: "xhigh", label: "xhigh", description: "Extra-high reasoning" },
        ]);
        expect(command.getArgumentCompletions("unknown")).toBeNull();
    });
});

describe("effort shortcut", () => {
    test("binds Alt+E to the selector", async () => {
        const { shortcut, shortcutKey, setThinkingLevel } = setup();
        const { ctx } = context("high");

        await shortcut.handler(ctx);

        expect(shortcutKey).toBe("alt+e");
        expect(setThinkingLevel).toHaveBeenCalledWith("high");
    });
});
