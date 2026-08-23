/**
 * fff query building.
 *
 * fff takes a single query string that folds path constraints, `!exclusions`,
 * and the search pattern together. These helpers translate the friendlier tool
 * arguments (path / exclude / pattern) into that string. Adapted from fff's own
 * pi extension (packages/pi-fff/src/query.ts). Pure; no I/O.
 */

import path from "node:path";

export function normalizePathConstraint(
    pathConstraint: string,
    cwd = process.cwd(),
): string | null {
    let trimmed = pathConstraint.trim();
    if (!trimmed) return trimmed;

    if (path.isAbsolute(trimmed)) {
        const relative = path.relative(cwd, trimmed).replaceAll(path.sep, "/");
        if (relative === "") return null;
        if (relative.startsWith("../") || relative === ".." || path.isAbsolute(relative)) {
            throw new Error(`Path constraint must be relative to the workspace: ${pathConstraint}`);
        }
        trimmed = relative;
    }

    if (trimmed === "." || trimmed === "./") return null;
    // Strip a leading `./` so `./**/*.rs` and `**/*.rs` behave identically.
    if (trimmed.startsWith("./")) trimmed = trimmed.slice(2);

    // A bare `**` means "anything"; treat it as the whole cwd (no constraint).
    if (trimmed === "**" || trimmed === "**/" || trimmed === "**/*") return null;

    // Collapse a simple trailing recursive-dir glob (`dir/**`) to the directory
    // prefix constraint fff understands. Leave real file globs (`src/**/*.ts`) be.
    const recursiveDir = trimmed.match(/^(.*)\/\*\*(?:\/\*)?$/);
    if (recursiveDir) {
        const dir = recursiveDir[1];
        if (dir && !/[*?[{]/.test(dir)) return `${dir}/`;
    }

    // Already path-constraint syntax.
    if (trimmed.startsWith("/") || trimmed.endsWith("/")) return trimmed;
    // Globs are handled by fff's parser directly.
    if (/[*?[{]/.test(trimmed)) return trimmed;
    // Filename with an extension (`main.rs`) is a FilePath constraint.
    const lastSegment = trimmed.split("/").pop() ?? "";
    if (/\.[a-zA-Z][a-zA-Z0-9]{0,9}$/.test(lastSegment)) return trimmed;
    // Bare directory prefix; append `/` so fff sees a path segment.
    return `${trimmed}/`;
}

export function normalizeExcludes(
    exclude: string | string[] | undefined,
    cwd = process.cwd(),
): string[] {
    if (!exclude) return [];
    const list = Array.isArray(exclude) ? exclude : [exclude];
    const out: string[] = [];
    for (const raw of list) {
        const parts = raw
            .split(/[,\s]+/)
            .map((s) => s.trim())
            .filter(Boolean);
        for (const part of parts) {
            const stripped = part.startsWith("!") ? part.slice(1) : part;
            const normalized = normalizePathConstraint(stripped, cwd);
            if (normalized) out.push(`!${normalized}`);
        }
    }
    return out;
}

export function buildQuery(
    pathArg: string | undefined,
    pattern: string,
    exclude: string | string[] | undefined,
    cwd = process.cwd(),
): string {
    const parts: string[] = [];
    if (pathArg) {
        const constraint = normalizePathConstraint(pathArg, cwd);
        if (constraint) parts.push(constraint);
    }
    parts.push(...normalizeExcludes(exclude, cwd));
    parts.push(pattern);
    return parts.join(" ").trim();
}
