import { chmodSync, lstatSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

function safeSessionId(sessionId: string): string {
    const safe = sessionId.replace(/[^a-zA-Z0-9_-]/gu, "_").slice(0, 80);
    return safe || "session";
}

export function createSessionTempDirectory(sessionId: string): string {
    const directory = mkdtempSync(join(tmpdir(), `pi-${safeSessionId(sessionId)}-`));
    try {
        chmodSync(directory, 0o700);
        return realpathSync(directory);
    } catch (error) {
        rmSync(directory, { recursive: true, force: true });
        throw error;
    }
}

export function removeSessionTempDirectory(directory: string | undefined): void {
    if (directory === undefined) return;
    try {
        rmSync(directory, { recursive: true, force: true });
    } catch {
        // Cleanup is best-effort during session transitions and shutdown.
    }
}

/** Check canonical containment, rejecting paths that traverse any symlink outside the root. */
export function isInsideSessionTempDirectory(path: string, directory: string): boolean {
    const target = resolve(path);
    let candidate = target;

    while (true) {
        try {
            lstatSync(candidate);
            const canonical = realpathSync(candidate);
            const fromDirectory = relative(directory, canonical);
            return (
                fromDirectory === "" ||
                (!isAbsolute(fromDirectory) &&
                    fromDirectory !== ".." &&
                    !fromDirectory.startsWith("../") &&
                    !fromDirectory.startsWith("..\\"))
            );
        } catch (error) {
            if (
                typeof error !== "object" ||
                error === null ||
                !("code" in error) ||
                error.code !== "ENOENT"
            ) {
                return false;
            }
        }

        const parent = dirname(candidate);
        if (parent === candidate) return false;
        candidate = parent;
    }
}
