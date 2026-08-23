import { describe, expect, test } from "vitest";

import { formatGraphStatus, parseGraphFailures } from "./graphify.ts";

const failure = {
    reason: "failed",
    source: "hook",
    at: 10,
    log: "/home/user/.cache/graphify-rebuild.log",
};

describe("Graphify runtime signals", () => {
    test("validates operation-specific failures and orders newest first", () => {
        expect(
            parseGraphFailures({
                version: 1,
                failures: { update: failure, extract: { ...failure, at: 20 } },
            }),
        ).toEqual([
            { operation: "extract", ...failure, at: 20 },
            { operation: "update", ...failure },
        ]);
        expect(parseGraphFailures({ version: 1, failures: {} })).toEqual([]);
    });

    test.each([
        null,
        { version: 2, failures: {} },
        { version: 1, failures: [] },
        { version: 1, failures: { unknown: failure } },
        { version: 1, failures: { update: { ...failure, reason: "raw backend response" } } },
        { version: 1, failures: { update: { ...failure, source: "unknown" } } },
        { version: 1, failures: { update: { ...failure, at: Number.NaN } } },
    ])("rejects malformed or unsupported signals", (value) => {
        expect(parseGraphFailures(value)).toBeUndefined();
    });

    test("never projects arbitrary error messages or unsafe log paths", () => {
        const failures = parseGraphFailures({
            version: 1,
            failures: {
                update: {
                    ...failure,
                    message: "sk-sensitive-backend-response",
                    log: "https://sk-sensitive-backend-response.example/trace",
                },
            },
        });
        expect(failures?.[0]?.log).toBeUndefined();
        const text = formatGraphStatus(
            { graphExists: true, needsUpdate: true, failures: failures ?? [], signal: "valid" },
            "/repo",
        );
        expect(text).not.toContain("sk-sensitive");
        expect(text).toContain("graphify update .");
    });

    test("shows pending semantics, failures, logs and operation-specific recovery", () => {
        const text = formatGraphStatus(
            {
                graphExists: true,
                needsUpdate: true,
                failures:
                    parseGraphFailures({
                        version: 1,
                        failures: { extract: { ...failure, reason: "incomplete" } },
                    }) ?? [],
                signal: "valid",
            },
            "/repo",
        );
        expect(text).toContain("Semantic update: pending");
        expect(text).toContain("incomplete");
        expect(text).toContain(failure.log);
        expect(text).toContain("graphify extract .");
        expect(text).not.toContain("--force");
    });

    test("does not equate missing legacy signals with freshness", () => {
        const text = formatGraphStatus(
            { graphExists: false, needsUpdate: false, failures: [], signal: "legacy" },
            "/repo",
        );
        expect(text).toContain("not built");
        expect(text).toContain("not proof of freshness");
        expect(text).toContain("unavailable");
    });
});
