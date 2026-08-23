import { describe, expect, it, vi } from "vitest";
import registerWorkingIndicator from "./working-indicator.ts";

describe("registerWorkingIndicator", () => {
    it("sets the custom animation when a session starts", () => {
        let handler: ((event: unknown, ctx: unknown) => void) | undefined;
        const pi = {
            on(eventName: string, nextHandler: typeof handler) {
                if (eventName === "session_start") handler = nextHandler;
            },
        };
        const setWorkingIndicator = vi.fn();

        registerWorkingIndicator(pi as Parameters<typeof registerWorkingIndicator>[0]);
        handler?.({}, { ui: { setWorkingIndicator } });

        expect(setWorkingIndicator).toHaveBeenCalledWith({
            frames: ["⠀⠶⠀", "⠰⣿⠆", "⢾⣉⡷", "⣏⠀⣹", "⡁⠀⢈"],
            intervalMs: 180,
        });
    });
});
