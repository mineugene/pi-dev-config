import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    dispose: vi.fn(),
    loadConfig: vi.fn(() => ({})),
}));

vi.mock("./adapters/registry.ts", () => ({ FEATURES: [] }));
vi.mock("./infra/config.ts", () => ({ loadConfig: mocks.loadConfig }));
vi.mock("./infra/fff.ts", () => ({ fff: { dispose: mocks.dispose } }));

import register from "./index.ts";

describe("composition lifecycle", () => {
    it("owns FFF shutdown exactly once", () => {
        const on = vi.fn();
        register({ on } as unknown as ExtensionAPI);

        const shutdown = on.mock.calls.filter(([event]) => event === "session_shutdown");
        expect(shutdown).toHaveLength(1);
        shutdown[0]?.[1]();
        expect(mocks.dispose).toHaveBeenCalledOnce();
    });
});
