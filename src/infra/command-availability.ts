import { spawnSync } from "node:child_process";

const availability = new Map<string, boolean>();

/** True when `command` resolves on PATH. Cached for the process lifetime. */
export function commandAvailable(command: string): boolean {
    const cached = availability.get(command);
    if (cached !== undefined) return cached;
    const found = spawnSync(command, ["--version"], { stdio: "ignore" }).error === undefined;
    availability.set(command, found);
    return found;
}
