import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    dispose: vi.fn(),
    loadConfig: vi.fn<() => Record<string, unknown>>(() => ({})),
    registerPermission: vi.fn(),
}));

vi.mock("./adapters/registry.ts", () => ({
    FEATURES: [
        {
            name: "permissions",
            tier: "core",
            register: mocks.registerPermission,
        },
    ],
}));
vi.mock("./infra/config.ts", () => ({ loadConfig: mocks.loadConfig }));
vi.mock("./infra/fff.ts", () => ({ fff: { dispose: mocks.dispose } }));

import register from "./index.ts";

describe("composition lifecycle", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.loadConfig.mockReturnValue({});
    });

    it("owns FFF shutdown exactly once", () => {
        const on = vi.fn();
        register({ on } as unknown as ExtensionAPI);

        const shutdown = on.mock.calls.filter(([event]) => event === "session_shutdown");
        expect(shutdown).toHaveLength(1);
        shutdown[0]?.[1]();
        expect(mocks.dispose).toHaveBeenCalledOnce();
    });

    it("lets configuration disable the permission feature", () => {
        mocks.loadConfig.mockReturnValue({ disable: ["permissions"] });

        register({ on: vi.fn() } as unknown as ExtensionAPI);

        expect(mocks.registerPermission).not.toHaveBeenCalled();
    });
});
