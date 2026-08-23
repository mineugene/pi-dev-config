import { describe, expect, it } from "vitest";

import { FEATURES } from "./registry.ts";

describe("feature tiers", () => {
    it("keeps foreground-only prompt and planning features out of child processes", () => {
        const childFeatures = FEATURES.filter((feature) => feature.tier === "core").map(
            (feature) => feature.name,
        );

        expect(childFeatures).not.toContain("caveman");
        expect(childFeatures).not.toContain("ponytail");
        expect(childFeatures).not.toContain("todo");

        for (const name of ["caveman", "ponytail", "todo"]) {
            expect(FEATURES.find((feature) => feature.name === name)?.tier).toBe("session");
        }
    });

    it("ships child-safe web research in core", () => {
        expect(FEATURES.find((feature) => feature.name === "web")?.tier).toBe("core");
    });

    it("registers lazy discovery after optional tools and audits the final prompt", () => {
        const names = FEATURES.map((feature) => feature.name);
        expect(names.indexOf("lazyTools")).toBeGreaterThan(names.indexOf("subagents"));
        expect(FEATURES.at(-1)?.name).toBe("contextAudit");
    });
});
