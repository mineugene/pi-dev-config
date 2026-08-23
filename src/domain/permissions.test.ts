import { describe, expect, it } from "vitest";

import {
    authorize,
    authorizeWithSessionGrants,
    defaultDecisionForEffect,
    mostRestrictive,
    mostRestrictiveMode,
    type PermissionOperation,
    resolvePermissionPolicy,
} from "./permissions.ts";

describe("mostRestrictive", () => {
    it.each([
        [["allow", "allow"], "allow"],
        [["allow", "ask"], "ask"],
        [["ask", "allow"], "ask"],
        [["allow", "deny"], "deny"],
        [["ask", "deny"], "deny"],
        [["deny", "allow"], "deny"],
    ] as const)("combines %j as %s", (decisions, expected) => {
        expect(mostRestrictive(...decisions)).toBe(expected);
    });
});

describe("mostRestrictiveMode", () => {
    it.each([
        [["bypass", "auto"], "auto"],
        [["auto", "guarded"], "guarded"],
        [["guarded", "bypass"], "guarded"],
    ] as const)("combines %j as %s", (modes, expected) => {
        expect(mostRestrictiveMode(...modes)).toBe(expected);
    });
});

describe("resolvePermissionPolicy", () => {
    it("uses auto as the default development profile", () => {
        expect(resolvePermissionPolicy(undefined)).toEqual({ mode: "auto" });
    });
});

describe("defaultDecisionForEffect", () => {
    it.each([
        ["guarded", "read", "allow"],
        ["guarded", "write", "ask"],
        ["guarded", "privileged", "deny"],
        ["auto", "write", "allow"],
        ["auto", "delete", "ask"],
        ["auto", "network", "allow"],
        ["bypass", "delete", "allow"],
        ["bypass", "credential", "deny"],
    ] as const)("uses %s mode for %s as %s", (mode, effect, expected) => {
        expect(defaultDecisionForEffect(mode, effect)).toBe(expected);
    });
});

describe("authorize", () => {
    it("takes the most restrictive decision across operation effects", () => {
        const operation: PermissionOperation = {
            tool: "bash",
            effects: new Set(["process", "network", "write"]),
        };

        expect(authorize(operation, { mode: "auto" })).toBe("ask");
    });

    it("asks for an unknown Bash operation in auto mode", () => {
        expect(
            authorize(
                { tool: "bash", effects: new Set(["process"]), unknown: true },
                { mode: "auto" },
            ),
        ).toBe("ask");
    });

    it("classifies unknown Bash as ask in every mode", () => {
        expect(
            authorize(
                { tool: "bash", effects: new Set(["process"]), unknown: true },
                { mode: "bypass" },
            ),
        ).toBe("ask");
    });

    it("gates external paths for both reads and writes", () => {
        const read = { tool: "read", effects: new Set(["read", "external-path"] as const) };
        const write = {
            tool: "write",
            effects: new Set(["write", "external-path"] as const),
        };

        expect(authorize(read, { mode: "guarded" })).toBe("ask");
        expect(authorize(read, { mode: "auto" })).toBe("ask");
        expect(authorize(write, { mode: "auto" })).toBe("ask");
        expect(authorize(read, { mode: "bypass" })).toBe("allow");
    });

    it.each(["credential", "privileged"] as const)(
        "hard-denies %s access in bypass mode",
        (effect) => {
            expect(
                authorize({ tool: "bash", effects: new Set([effect]) }, { mode: "bypass" }),
            ).toBe("deny");
        },
    );

    it("honours an explicit denial in bypass mode", () => {
        expect(
            authorize(
                { tool: "write", effects: new Set(["write"]) },
                { mode: "bypass", effects: { write: "deny" } },
            ),
        ).toBe("deny");
    });
});

describe("authorizeWithSessionGrants", () => {
    const operation: PermissionOperation = {
        tool: "write",
        effects: new Set(["write"]),
        resource: "/repo/src/file.ts",
    };
    const matchingGrant = {
        decision: "allow" as const,
        matcher: {
            tool: "write",
            effects: new Set(["write"] as const),
            resource: "/repo/src/file.ts",
        },
    };

    it("allows a matching session grant after policy asks", () => {
        expect(authorizeWithSessionGrants(operation, { mode: "guarded" }, [matchingGrant])).toBe(
            "allow",
        );
    });

    it("keeps grants scoped to their matched resource", () => {
        const other = { ...operation, resource: "/repo/src/other.ts" };

        expect(authorizeWithSessionGrants(other, { mode: "guarded" }, [matchingGrant])).toBe("ask");
    });

    it("lets a directory grant cover later reads in the same directory", () => {
        const grant = {
            decision: "allow" as const,
            matcher: {
                effects: new Set(["read", "external-path"] as const),
                directory: "/other/src",
            },
        };
        const read = (resource: string): PermissionOperation => ({
            tool: "read",
            effects: new Set(["read", "external-path"] as const),
            resource,
        });

        expect(authorizeWithSessionGrants(read("/other/src/a.ts"), { mode: "auto" }, [grant])).toBe(
            "allow",
        );
        expect(
            authorizeWithSessionGrants(read("/other/src/lib/b.ts"), { mode: "auto" }, [grant]),
        ).toBe("allow");
        expect(authorizeWithSessionGrants(read("/other/c.ts"), { mode: "auto" }, [grant])).toBe(
            "ask",
        );
    });

    it("does not let a directory grant cover writes in that directory", () => {
        const grant = {
            decision: "allow" as const,
            matcher: {
                effects: new Set(["read", "external-path"] as const),
                directory: "/other/src",
            },
        };
        const write: PermissionOperation = {
            tool: "write",
            effects: new Set(["write", "external-path"] as const),
            resource: "/other/src/a.ts",
        };

        expect(authorizeWithSessionGrants(write, { mode: "auto" }, [grant])).toBe("ask");
    });

    it("does not let a grant override an explicit denial", () => {
        expect(
            authorizeWithSessionGrants(operation, { mode: "auto", effects: { write: "deny" } }, [
                matchingGrant,
            ]),
        ).toBe("deny");
    });

    it("lets a grant resolve an ask from a restrictive guard", () => {
        expect(
            authorizeWithSessionGrants(operation, { mode: "auto" }, [matchingGrant], ["ask"]),
        ).toBe("allow");
    });

    it("resolves unknown and guard asks in bypass mode", () => {
        const unknown = {
            tool: "bash",
            effects: new Set(["process"] as const),
            unknown: true,
        };

        expect(authorizeWithSessionGrants(unknown, { mode: "bypass" }, [])).toBe("allow");
        expect(authorizeWithSessionGrants(operation, { mode: "bypass" }, [], ["ask"])).toBe(
            "allow",
        );
    });

    it("does not let a grant override a hard denial", () => {
        const privileged = { ...operation, effects: new Set(["privileged"] as const) };
        const broadGrant = { decision: "allow" as const, matcher: { tool: "write" } };

        expect(authorizeWithSessionGrants(privileged, { mode: "bypass" }, [broadGrant])).toBe(
            "deny",
        );
        expect(
            authorizeWithSessionGrants(operation, { mode: "bypass" }, [matchingGrant], ["deny"]),
        ).toBe("deny");
    });
});
