import { describe, expect, it, vi } from "vitest";
import registerWorkingIndicator from "./working-indicator.ts";

type Handler = (event: unknown, ctx: unknown) => void;

function setup() {
    const handlers = new Map<string, Handler>();
    const pi = {
        on(eventName: string, handler: Handler) {
            handlers.set(eventName, handler);
        },
    };
    const setWorkingIndicator = vi.fn();

    registerWorkingIndicator(pi as Parameters<typeof registerWorkingIndicator>[0]);

    return {
        setWorkingIndicator,
        start: () => handlers.get("session_start")?.({}, { ui: { setWorkingIndicator } }),
    };
}

describe("registerWorkingIndicator", () => {
    it("sets the custom animation when a session starts", () => {
        const harness = setup();

        harness.start();

        expect(harness.setWorkingIndicator).toHaveBeenCalledWith({
            frames: ["·", "✢", "✳", "✶", "✻", "✽"],
            intervalMs: 150,
        });
    });
});
