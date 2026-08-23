import { describe, expect, test, vi } from "vitest";

import registerPonytail from "./ponytail.ts";

type TestContext = {
    sessionManager: { getBranch: () => unknown[] };
    ui: { notify: ReturnType<typeof vi.fn>; setStatus: ReturnType<typeof vi.fn> };
};
type Handler = (event: Record<string, unknown>, ctx: TestContext) => Promise<unknown> | unknown;
type CommandHandler = (args: string, ctx: TestContext) => Promise<void> | void;

function setup(entries: unknown[] = []) {
    const handlers = new Map<string, Handler>();
    const commands = new Map<string, CommandHandler>();
    const appendEntry = vi.fn();
    const ui = { notify: vi.fn(), setStatus: vi.fn() };
    const ctx: TestContext = { sessionManager: { getBranch: () => entries }, ui };
    registerPonytail({
        appendEntry,
        on(name: string, handler: Handler) {
            handlers.set(name, handler);
        },
        registerCommand(name: string, command: { handler: CommandHandler }) {
            commands.set(name, command.handler);
        },
    } as unknown as Parameters<typeof registerPonytail>[0]);
    const emit = async (name: string, event: Record<string, unknown> = {}) =>
        handlers.get(name)?.(event, ctx);
    const prompt = async (systemPrompt = "base") =>
        ((await emit("before_agent_start", { systemPrompt })) as { systemPrompt: string })
            .systemPrompt;
    return { appendEntry, commands, ctx, emit, prompt, ui };
}

const entry = (mode: unknown) => ({ type: "custom", customType: "ponytail-mode", data: { mode } });

describe("Ponytail runtime state", () => {
    test("starts full and replaces owned prompt blocks on every turn", async () => {
        const harness = setup();
        await harness.emit("session_start");
        const first = await harness.prompt();
        const second = await harness.prompt(first);
        expect(first).toContain("PONYTAIL MODE ACTIVE: full");
        expect(second.match(/<pi-dev-config-ponytail>/g) ?? []).toHaveLength(1);
    });

    test("commands mutate and persist authoritative state", async () => {
        const harness = setup();
        await harness.emit("session_start");
        expect(harness.ui.setStatus).toHaveBeenLastCalledWith("ponytail", "  mode: FULL");

        await harness.commands.get("ponytail")?.("ultra", harness.ctx);
        expect(harness.appendEntry).toHaveBeenCalledWith("ponytail-mode", { mode: "ultra" });
        expect(harness.ui.setStatus).toHaveBeenLastCalledWith("ponytail", "  mode: ULTRA");
        expect(await harness.prompt()).toContain("PONYTAIL MODE ACTIVE: ultra");

        await harness.commands.get("ponytail")?.("ultra", harness.ctx);
        expect(harness.appendEntry).toHaveBeenCalledTimes(1);

        await harness.commands.get("ponytail")?.("off", harness.ctx);
        expect(harness.ui.setStatus).toHaveBeenLastCalledWith("ponytail", undefined);
        expect(await harness.prompt()).toBe("base");
        await harness.commands.get("ponytail")?.("", harness.ctx);
        expect(harness.ui.notify).toHaveBeenLastCalledWith("Ponytail: off", "info");
    });

    test("exact user deactivation changes state before the next prompt", async () => {
        const harness = setup();
        await harness.emit("session_start");
        await harness.emit("input", { source: "extension", text: "stop ponytail" });
        expect(await harness.prompt()).toContain("PONYTAIL MODE ACTIVE: full");
        expect(harness.appendEntry).not.toHaveBeenCalled();

        await harness.emit("input", { source: "interactive", text: "Stop Ponytail." });
        expect(harness.appendEntry).toHaveBeenCalledWith("ponytail-mode", { mode: "off" });
        expect(await harness.prompt()).toBe("base");

        await harness.commands.get("ponytail")?.("full", harness.ctx);
        await harness.emit("input", { source: "interactive", text: "how do I stop ponytail?" });
        expect(await harness.prompt()).toContain("PONYTAIL MODE ACTIVE: full");
    });

    test("restores the newest valid entry when the latest payload is malformed", async () => {
        const harness = setup([
            entry("full"),
            { type: "custom", customType: "other", data: { mode: "off" } },
            entry("ultra"),
            entry("invalid"),
        ]);
        await harness.emit("session_start");
        expect(await harness.prompt()).toContain("PONYTAIL MODE ACTIVE: ultra");
    });

    test("a fork restores only its own branch history", async () => {
        const harness = setup([entry("full"), entry("ultra")]);
        await harness.emit("session_start");
        expect(await harness.prompt()).toContain("PONYTAIL MODE ACTIVE: ultra");
    });

    test("tree navigation restores mode from the selected branch", async () => {
        const entries = [entry("full"), entry("ultra")];
        const harness = setup(entries);
        await harness.emit("session_start");
        entries.pop();
        await harness.emit("session_tree");
        expect(await harness.prompt()).toContain("PONYTAIL MODE ACTIVE: full");
    });

    test("skill invocation does not change runtime mode", async () => {
        const harness = setup([entry("off")]);
        await harness.emit("session_start");
        await harness.emit("input", { source: "interactive", text: "$skill:ponytail" });
        expect(harness.appendEntry).not.toHaveBeenCalled();
        expect(await harness.prompt()).toBe("base");
    });
});
