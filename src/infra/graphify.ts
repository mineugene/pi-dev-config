import { closeSync, existsSync, fstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";

import { type GraphStatus, parseGraphFailures } from "../domain/graphify.ts";

export function graphExists(cwd = process.cwd()): boolean {
    return existsSync(join(cwd, "graphify-out", "graph.json"));
}

export function graphNeedsUpdate(cwd: string): boolean {
    return existsSync(join(cwd, "graphify-out", "needs_update"));
}

export function readGraphStatus(cwd: string): GraphStatus {
    const status: GraphStatus = {
        graphExists: graphExists(cwd),
        needsUpdate: graphNeedsUpdate(cwd),
        failures: [],
        signal: "legacy",
    };
    try {
        const descriptor = openSync(join(cwd, "graphify-out", ".graphify_status.json"), "r");
        try {
            if (!fstatSync(descriptor).isFile()) throw new Error("Invalid signal file");
            const buffer = Buffer.alloc(65537);
            const length = readSync(descriptor, buffer, 0, buffer.length, 0);
            if (length > 65536) throw new Error("Oversized signal");
            const failures = parseGraphFailures(JSON.parse(buffer.toString("utf8", 0, length)));
            if (!failures) throw new Error("Unsupported signal");
            status.failures = failures;
            status.signal = "valid";
        } finally {
            closeSync(descriptor);
        }
    } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
            status.signal = "unreadable";
    }
    return status;
}
