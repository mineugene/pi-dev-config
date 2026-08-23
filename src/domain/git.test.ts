import { describe, expect, test } from "vitest";

import { isCommitCommand, isSigningCommand } from "./git.ts";

describe("isSigningCommand", () => {
    test.each([
        ["git commit -m 'x'", true],
        ["git -C ../repo commit -m x", true],
        ["git -c commit.gpgsign=true commit", true],
        ["git merge feature", true],
        ["git rebase main", true],
        ["git cherry-pick abc123", true],
        ["git revert abc123", true],
        ["git tag -s v1.0.0", true],
        ["git tag --sign v1.0.0", true],
        ["git tag v1.0.0", false],
        ["git commit --no-gpg-sign -m x", false],
        ["git commit --no-sign -m x", false],
        ["git status", false],
        ["git config user.signingkey abc", false],
        // Known over-match: the heuristic reads the command string, so a literal
        // 'git commit' inside echo text counts. Over-matching only costs a redirect.
        ["echo git commit", true],
        ["GIT_COMMIT=1 git status", false], // token 'GIT_COMMIT=1' must not match 'git'
    ])("%s -> %s", (command, expected) => {
        expect(isSigningCommand(command)).toBe(expected);
    });

    test("checks segments of a compound command independently", () => {
        expect(isSigningCommand("git add -A && git commit -m x")).toBe(true);
        expect(isSigningCommand("git commit --no-gpg-sign; git status")).toBe(false);
        expect(isSigningCommand("git status || git tag -s v1")).toBe(true);
        expect(isSigningCommand("git add -A\ngit status")).toBe(false);
    });
});

describe("isCommitCommand", () => {
    test.each([
        ["git commit -m x", true],
        ["git -C ../repo commit -m x", true],
        ["git commit --no-gpg-sign -m x", false],
        ["git rebase main", false],
        ["git status", false],
    ])("%s -> %s", (command, expected) => {
        expect(isCommitCommand(command)).toBe(expected);
    });

    test("any plain commit segment in a compound command wins", () => {
        expect(isCommitCommand("git commit --no-gpg-sign; git commit -m x")).toBe(true);
        expect(isCommitCommand("git add -A && git commit --no-gpg-sign")).toBe(false);
    });
});
