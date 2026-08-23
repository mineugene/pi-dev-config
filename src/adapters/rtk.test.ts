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
    test("keeps the rewrite inline when it fits the terminal width", () => {
        expect(formatRewriteNotice("git status", "rtk git status", 80)).toBe(
            "RTK rewrite: git status becomes rtk git status",
        );
    });

    test("moves the rewrite to its own line when inline does not fit", () => {
        const original = "x".repeat(60);
        expect(formatRewriteNotice(original, "rtk rg needle", 80)).toBe(
            `RTK rewrite: ${original}\nbecomes rtk rg needle`,
        );
    });

    test("truncates each line to the terminal width", () => {
        expect(formatRewriteNotice("x".repeat(200), "y".repeat(200), 80)).toBe(
            `RTK rewrite: ${"x".repeat(65)}…\nbecomes ${"y".repeat(56)}…`,
        );
    });

    test("falls back to a minimum width for very narrow terminals", () => {
        const notice = formatRewriteNotice("git status", "rtk git status", 10);
        expect(notice).toBe("RTK rewrite: git status becomes rtk git status");
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
