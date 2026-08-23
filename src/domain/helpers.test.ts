import { describe, expect, it } from "vitest";

import { formatBytes, formatTokens, shortenHome } from "./format.ts";
import { commitMessageArgs, isSigningCommand } from "./git.ts";
import { isGuardedPrCommand } from "./pr.ts";
import { buildQuery, normalizeExcludes, normalizePathConstraint } from "./query.ts";
import { describeReadGate, hasExtension, shouldBypassReadGate } from "./read-gate.ts";

const CWD = "/home/dev/project";

describe("normalizePathConstraint", () => {
    it("drops no-op roots", () => {
        expect(normalizePathConstraint(".", CWD)).toBeNull();
        expect(normalizePathConstraint("**", CWD)).toBeNull();
        expect(normalizePathConstraint("", CWD)).toBe("");
    });

    it("appends a slash to bare directory prefixes", () => {
        expect(normalizePathConstraint("src", CWD)).toBe("src/");
        expect(normalizePathConstraint("src/", CWD)).toBe("src/");
    });

    it("keeps filenames and globs intact", () => {
        expect(normalizePathConstraint("main.rs", CWD)).toBe("main.rs");
        expect(normalizePathConstraint("src/**/*.ts", CWD)).toBe("src/**/*.ts");
    });

    it("collapses a trailing recursive dir glob to a prefix", () => {
        expect(normalizePathConstraint("docs/**", CWD)).toBe("docs/");
    });

    it("relativizes an absolute path inside the workspace", () => {
        expect(normalizePathConstraint("/home/dev/project/src", CWD)).toBe("src/");
    });

    it("rejects an absolute path outside the workspace", () => {
        expect(() => normalizePathConstraint("/etc", CWD)).toThrow();
    });
});

describe("normalizeExcludes", () => {
    it("splits, strips a leading !, and re-negates", () => {
        expect(normalizeExcludes("test/, *.min.js", CWD)).toEqual(["!test/", "!*.min.js"]);
        expect(normalizeExcludes(["!vendor/"], CWD)).toEqual(["!vendor/"]);
    });

    it("returns an empty list for nothing", () => {
        expect(normalizeExcludes(undefined, CWD)).toEqual([]);
    });
});

describe("buildQuery", () => {
    it("folds path, excludes, and pattern into one string", () => {
        expect(buildQuery("src", "TODO", "test/", CWD)).toBe("src/ !test/ TODO");
    });

    it("works with just a pattern", () => {
        expect(buildQuery(undefined, "needle", undefined, CWD)).toBe("needle");
    });
});

describe("formatTokens", () => {
    it("scales into k and M", () => {
        expect(formatTokens(950)).toBe("950");
        expect(formatTokens(8200)).toBe("8.2k");
        expect(formatTokens(128_000)).toBe("128k");
        expect(formatTokens(2_000_000)).toBe("2.0M");
    });

    it("guards against junk", () => {
        expect(formatTokens(Number.NaN)).toBe("?");
    });
});

describe("shortenHome", () => {
    it("replaces $HOME with ~", () => {
        const original = process.env.HOME;
        process.env.HOME = "/home/dev";
        expect(shortenHome("/home/dev/project")).toBe("~/project");
        process.env.HOME = original;
    });
});

describe("formatBytes", () => {
    it("scales into KB and MB", () => {
        expect(formatBytes(512)).toBe("512B");
        expect(formatBytes(262_144)).toBe("256KB");
        expect(formatBytes(3_000_000)).toBe("2.9MB");
    });

    it("guards against junk", () => {
        expect(formatBytes(Number.NaN)).toBe("?");
    });
});

describe("describeReadGate", () => {
    const GATE = 256 * 1024;

    it("redirects an unbounded read of a large file", () => {
        const message = describeReadGate({ path: "huge.log" }, GATE * 4, GATE);
        expect(message).toContain("huge.log");
        expect(message).toContain("grep");
    });

    it("passes a windowed read straight through", () => {
        expect(describeReadGate({ path: "huge.log", offset: 5000 }, GATE * 4, GATE)).toBeNull();
        expect(describeReadGate({ path: "huge.log", limit: 200 }, GATE * 4, GATE)).toBeNull();
    });

    it("passes a file at or under the gate", () => {
        expect(describeReadGate({ path: "small.ts" }, GATE, GATE)).toBeNull();
        expect(describeReadGate({ path: "small.ts" }, 1024, GATE)).toBeNull();
    });

    it("is disabled by a zero threshold", () => {
        expect(describeReadGate({ path: "huge.log" }, GATE * 4, 0)).toBeNull();
    });
});

describe("shouldBypassReadGate", () => {
    it("bypasses images and configured extensions", () => {
        expect(shouldBypassReadGate("preview.PNG", [])).toBe(true);
        expect(shouldBypassReadGate("archive.zip", ["zip"])).toBe(true);
        expect(shouldBypassReadGate("large.log", [])).toBe(false);
    });
});

describe("hasExtension", () => {
    it("matches regardless of leading dot, asterisk, or case", () => {
        expect(hasExtension("data/dump.PDF", ["pdf"])).toBe(true);
        expect(hasExtension("a/b.zip", [".zip"])).toBe(true);
        expect(hasExtension("mod.wasm", ["*.wasm"])).toBe(true);
    });

    it("does not match a different or partial extension", () => {
        expect(hasExtension("notes.md", ["pdf", "zip"])).toBe(false);
        expect(hasExtension("archive.zipx", ["zip"])).toBe(false);
        expect(hasExtension("plain", ["pdf"])).toBe(false);
    });

    it("matches a compound extension as a unit", () => {
        expect(hasExtension("dist/app.tar.gz", ["tar.gz"])).toBe(true);
        expect(hasExtension("dist/app.tar.gz", ["gz"])).toBe(true);
        expect(hasExtension("notes.gz", ["tar.gz"])).toBe(false);
    });

    it("ignores blank entries", () => {
        expect(hasExtension("x.pdf", ["", "  "])).toBe(false);
    });
});

describe("isSigningCommand", () => {
    it("flags commit-creating git subcommands", () => {
        expect(isSigningCommand("git commit -m 'x'")).toBe(true);
        expect(isSigningCommand("git merge feature")).toBe(true);
        expect(isSigningCommand("git cherry-pick abc123")).toBe(true);
        expect(isSigningCommand("git revert HEAD")).toBe(true);
    });

    it("respects a no-sign opt-out", () => {
        expect(isSigningCommand("git commit --no-gpg-sign -m 'x'")).toBe(false);
        expect(isSigningCommand("git commit --no-sign -m 'x'")).toBe(false);
    });

    it("ignores read-only git and non-git commands", () => {
        expect(isSigningCommand("git status")).toBe(false);
        expect(isSigningCommand("git log --oneline")).toBe(false);
        expect(isSigningCommand("ls -la")).toBe(false);
    });

    it("sees through global flags and command chains", () => {
        expect(isSigningCommand("git -C /repo commit -m 'x'")).toBe(true);
        expect(isSigningCommand("git add -A && git commit -m 'x'")).toBe(true);
    });

    it("signs tags only with -s/--sign", () => {
        expect(isSigningCommand("git tag -s v1")).toBe(true);
        expect(isSigningCommand("git tag v1")).toBe(false);
    });
});

describe("commitMessageArgs", () => {
    it("adds a body only when it is non-empty", () => {
        expect(commitMessageArgs("feat: x")).toEqual(["-m", "feat: x"]);
        expect(commitMessageArgs("feat: x", "why it matters")).toEqual([
            "-m",
            "feat: x",
            "-m",
            "why it matters",
        ]);
        expect(commitMessageArgs("feat: x", "   ")).toEqual(["-m", "feat: x"]);
    });
});

describe("isGuardedPrCommand", () => {
    it("guards PR create/edit/merge across gh, az, and tea", () => {
        expect(isGuardedPrCommand("gh pr create --title x")).toBe(true);
        expect(isGuardedPrCommand("gh pr edit 12 --add-label x")).toBe(true);
        expect(isGuardedPrCommand("gh pr merge 12")).toBe(true);
        expect(isGuardedPrCommand("az repos pr create --title x")).toBe(true);
        expect(isGuardedPrCommand("az repos pr update --id 3")).toBe(true);
        expect(isGuardedPrCommand("tea pull create --title x")).toBe(true);
    });

    it("allows read-only PR commands", () => {
        expect(isGuardedPrCommand("gh pr list")).toBe(false);
        expect(isGuardedPrCommand("gh pr view 12")).toBe(false);
        expect(isGuardedPrCommand("gh pr diff")).toBe(false);
        expect(isGuardedPrCommand("az repos pr show --id 3")).toBe(false);
        expect(isGuardedPrCommand("tea pull list")).toBe(false);
    });

    it("ignores non-PR commands", () => {
        expect(isGuardedPrCommand("gh repo view")).toBe(false);
        expect(isGuardedPrCommand("git commit -m x")).toBe(false);
        expect(isGuardedPrCommand("ls -la")).toBe(false);
    });

    it("treats an unknown PR verb as a mutation (fail closed)", () => {
        expect(isGuardedPrCommand("gh pr frobnicate")).toBe(true);
    });

    it("catches a PR command anywhere in a chain", () => {
        expect(isGuardedPrCommand("git push -u origin HEAD && gh pr create --fill")).toBe(true);
    });
});
