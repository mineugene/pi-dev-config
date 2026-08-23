import { statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export interface SearchScope {
    root: string;
    path: string | undefined;
}

function isDirectory(candidate: string): boolean {
    try {
        return statSync(candidate).isDirectory();
    } catch {
        return false;
    }
}

function isWithin(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return (
        relative === "" ||
        (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
    );
}

/** Pick the fff index root and its relative constraint for a tool path. */
export function resolveSearchScope(
    pathArg: string | undefined,
    cwd: string,
    home = homedir(),
): SearchScope {
    const workspace = path.resolve(cwd);
    if (!pathArg) return { root: workspace, path: undefined };

    const trimmed = pathArg.trim();
    const expanded =
        trimmed === "~" || trimmed.startsWith("~/") || trimmed.startsWith("~\\")
            ? home + trimmed.slice(1)
            : trimmed;
    const pointsOutside =
        path.isAbsolute(expanded) ||
        expanded === ".." ||
        expanded.startsWith("../") ||
        expanded.startsWith("..\\");
    if (!pointsOutside) return { root: workspace, path: pathArg };

    const absolute = path.resolve(workspace, expanded);
    if (isWithin(workspace, absolute)) {
        const relative = path.relative(workspace, absolute).replaceAll(path.sep, "/");
        return { root: workspace, path: relative || undefined };
    }

    let root = absolute;
    const remainder: string[] = [];
    while (!isDirectory(root)) {
        const parent = path.dirname(root);
        if (parent === root) break;
        remainder.unshift(path.basename(root));
        root = parent;
    }

    return {
        root,
        path: remainder.length > 0 ? remainder.join("/") : undefined,
    };
}
