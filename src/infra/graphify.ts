import { existsSync } from "node:fs";
import { join } from "node:path";

export function graphExists(cwd = process.cwd()): boolean {
    return existsSync(join(cwd, "graphify-out", "graph.json"));
}
