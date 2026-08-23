import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { graphNeedsUpdate, readGraphStatus } from "./graphify.ts";

describe("Graphify local status", () => {
    test("reads legacy, valid and malformed runtime signals without exposing raw errors", () => {
        const cwd = fs.mkdtempSync(join(tmpdir(), "pidev-graph-status-"));
        try {
            expect(readGraphStatus(cwd).signal).toBe("legacy");
            fs.mkdirSync(join(cwd, "graphify-out"));
            const signal = join(cwd, "graphify-out", ".graphify_status.json");
            fs.writeFileSync(
                signal,
                JSON.stringify({
                    version: 1,
                    failures: {
                        extract: {
                            reason: "failed",
                            source: "cli",
                            at: 1,
                            message: "sk-sensitive",
                        },
                    },
                }),
            );
            expect(readGraphStatus(cwd).failures).toEqual([
                { operation: "extract", reason: "failed", source: "cli", at: 1 },
            ]);
            fs.writeFileSync(signal, "sk-sensitive");
            expect(readGraphStatus(cwd)).toMatchObject({ signal: "unreadable", failures: [] });
            fs.writeFileSync(signal, " ".repeat(65537));
            expect(readGraphStatus(cwd).signal).toBe("unreadable");
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });

    test("reads pending semantics on demand without changing the marker", () => {
        const cwd = fs.mkdtempSync(join(tmpdir(), "pidev-graph-marker-"));
        try {
            expect(graphNeedsUpdate(cwd)).toBe(false);
            fs.mkdirSync(join(cwd, "graphify-out"));
            const marker = join(cwd, "graphify-out", "needs_update");
            fs.writeFileSync(marker, "1");
            expect(readGraphStatus(cwd).needsUpdate).toBe(true);
            expect(fs.readFileSync(marker, "utf8")).toBe("1");
            fs.rmSync(marker);
            expect(readGraphStatus(cwd).needsUpdate).toBe(false);
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });
});
