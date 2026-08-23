import { Text } from "@earendil-works/pi-tui";
import { describe, expect, test } from "vitest";

import {
    correctRtkRewrite,
    createRtkNoHookWarningDataFilter,
    formatRewriteNotice,
    shouldSkipRtkRewrite,
    stripRtkNoHookWarning,
} from "./rtk.ts";

const noHookWarning =
    "[rtk] /!\\ No hook installed — run `rtk init -g` for automatic token savings";

describe("RTK command rewriting", () => {
    test("leaves unsupported find predicates and actions to native find", () => {
        const command = "find /tmp -path '*/.git' -prune -o -iname '*tmux*' -print";
        expect(shouldSkipRtkRewrite(command, `rtk ${command}`)).toBe(true);
        expect(shouldSkipRtkRewrite("find . -not -name x", "rtk find . -not -name x")).toBe(true);
        expect(
            shouldSkipRtkRewrite("find . -exec echo {} \\;", "rtk find . -exec echo {} \\;"),
        ).toBe(true);
    });

    test("keeps supported find and non-find rewrites", () => {
        expect(shouldSkipRtkRewrite("find . -name '*.ts'", "rtk find . -name '*.ts'")).toBe(false);
        expect(shouldSkipRtkRewrite("git status", "rtk git status")).toBe(false);
    });

    test.each([
        ["biome check src/", "rtk lint check src/", "rtk lint biome check src/"],
        ["npx biome check src/", "rtk lint check src/", "rtk lint biome check src/"],
        ["pnpm biome check src/", "rtk lint check src/", "rtk lint biome check src/"],
        ["pnpm exec biome check src/", "rtk lint check src/", "rtk lint biome check src/"],
        ["npm run biome -- check src/", "rtk lint -- check src/", "rtk lint biome -- check src/"],
    ])("repairs RTK 0.49 Biome rewrites for %s", (command, rewritten, expected) => {
        expect(correctRtkRewrite(command, rewritten)).toBe(expected);
    });

    test("leaves fixed Biome and unrelated lint rewrites unchanged", () => {
        expect(correctRtkRewrite("npx biome check .", "rtk lint biome check .")).toBe(
            "rtk lint biome check .",
        );
        expect(correctRtkRewrite("npx eslint .", "rtk lint .")).toBe("rtk lint .");
    });
});

describe("RTK rewrite notices", () => {
    test("keeps the whole rewrite inline when it fits the terminal width", () => {
        expect(formatRewriteNotice("git status", "rtk git status", 80)).toBe(
            "RTK rewrite: git status -> rtk git status",
        );
    });

    test("shows the full command and rewrite, without masking or ellipses", () => {
        expect(
            formatRewriteNotice(
                "git status --porcelain && cat package.json",
                "rtk git status --porcelain && rtk read package.json",
                120,
            ),
        ).toBe(
            "RTK rewrite: git status --porcelain && cat package.json -> rtk git status --porcelain && rtk read package.json",
        );
    });

    test("moves the rewrite to its own line when inline does not fit", () => {
        const original = "x".repeat(60);
        expect(formatRewriteNotice(original, "rtk rg needle", 80)).toBe(
            `RTK rewrite: ${original}\n-> rtk rg needle`,
        );
    });

    test("wraps long commands with a backslash and a hanging indent", () => {
        expect(
            formatRewriteNotice(
                "git status --porcelain && cat package.json",
                "rtk git status --porcelain && rtk read package.json",
                40,
            ),
        ).toBe(
            [
                "RTK rewrite: git status --porcelain \\",
                "    && cat package.json",
                "-> rtk git status --porcelain && \\",
                "    rtk read package.json",
            ].join("\n"),
        );
    });

    test("breaks only at whitespace outside quotes", () => {
        const original = `printf '%s' "one two three four five six"`;
        const rewritten = original.replace("printf", "rtk printf");
        expect(formatRewriteNotice(original, rewritten, 45)).toBe(
            [
                "RTK rewrite: printf '%s' \\",
                '    "one two three four five six"',
                "-> rtk printf '%s' \\",
                '    "one two three four five six"',
            ].join("\n"),
        );
    });

    test("hard-splits a token that cannot fit on a line", () => {
        expect(formatRewriteNotice("x".repeat(200), "y".repeat(200), 80)).toBe(
            [
                `RTK rewrite: ${"x".repeat(62)} \\`,
                `    ${"x".repeat(71)} \\`,
                `    ${"x".repeat(67)}`,
                `-> ${"y".repeat(72)} \\`,
                `    ${"y".repeat(71)} \\`,
                `    ${"y".repeat(57)}`,
            ].join("\n"),
        );
    });

    test("reserves a column for pi's always-on fullscreen scrollbar", () => {
        const original = "x".repeat(40);
        const rewritten = "y".repeat(21);
        // Inline form is 78 chars: fits columns - 2 but overflows columns - 3.
        expect(formatRewriteNotice(original, rewritten, 80)).toBe(
            `RTK rewrite: ${original}\n-> ${rewritten}`,
        );
    });

    test("fits pi's fullscreen render width without re-wrapping", () => {
        const columns = 158;
        const notice = formatRewriteNotice("x".repeat(300), "y".repeat(300), columns);
        // pi renders the transcript one column narrower for an always-on scrollbar.
        const rendered = new Text(notice, 1, 0).render(columns - 1);
        expect(rendered).toHaveLength(notice.split("\n").length);
    });

    test("falls back to an unwrapped inline notice for very narrow terminals", () => {
        const notice = formatRewriteNotice("git status", "rtk git status", 10);
        expect(notice).toBe("RTK rewrite: git status -> rtk git status");
    });
});

describe("RTK output filtering", () => {
    test("strips no-hook warning from tool output", () => {
        expect(stripRtkNoHookWarning(`stdout\n${noHookWarning}\nstderr\n`)).toBe(
            "stdout\nstderr\n",
        );
    });

    test("strips no-hook warning from streamed bash output", () => {
        const chunks: string[] = [];
        const onData = createRtkNoHookWarningDataFilter((data) => chunks.push(data.toString()));

        onData(Buffer.from(`${noHookWarning.slice(0, 12)}`));
        onData(Buffer.from(`${noHookWarning.slice(12)}\nkept\n`));

        expect(chunks.join("")).toBe("kept\n");
    });
});
