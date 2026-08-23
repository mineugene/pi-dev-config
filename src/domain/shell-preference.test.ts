import { describe, expect, it } from "vitest";

import { formatShellPreference, rewriteBashSnippet } from "./shell-preference.ts";

describe("shell preference", () => {
    it("returns undefined when neither replacement is installed", () => {
        expect(formatShellPreference({ rg: false, fd: false })).toBeUndefined();
    });

    it("names only the installed replacements", () => {
        expect(formatShellPreference({ rg: true, fd: false })).toContain("`rg` instead of `grep`");
        expect(formatShellPreference({ rg: true, fd: false })).not.toContain("`fd`");
        expect(formatShellPreference({ rg: false, fd: true })).toContain("`fd` instead of `find`");
        expect(formatShellPreference({ rg: true, fd: true })).toContain(
            "`rg` instead of `grep` and `fd` instead of `find`",
        );
    });

    it("rewrites only the installed tools in the snippet", () => {
        const snippet = "Execute bash commands (ls, grep, find, etc.)";
        expect(rewriteBashSnippet(snippet, { rg: true, fd: false })).toBe(
            "Execute bash commands (ls, rg, find, etc.)",
        );
        expect(rewriteBashSnippet(snippet, { rg: true, fd: true })).toBe(
            "Execute bash commands (ls, rg, fd, etc.)",
        );
        expect(rewriteBashSnippet(snippet, { rg: false, fd: false })).toBe(snippet);
    });
});
