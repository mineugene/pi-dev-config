import { execFileSync } from "node:child_process";

/** Effective value of a single git config key in `cwd`, or null when unset. */
export function gitConfig(cwd: string, key: string): string | null {
    try {
        return execFileSync("git", ["config", "--get", key], {
            cwd,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        }).trim();
    } catch {
        // Exit 1 (key unset) or not a git repo.
        return null;
    }
}

/** True when the repo is configured to sign commits by default. */
export function repoSignsCommits(cwd: string): boolean {
    return gitConfig(cwd, "commit.gpgsign") === "true";
}
