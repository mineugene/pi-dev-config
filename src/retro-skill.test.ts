import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const path = new URL("../skills/retro/SKILL.md", import.meta.url);
const source = () => readFileSync(path, "utf8").replace(/\s+/g, " ");

describe("retro skill", () => {
    it("loads the writing reference and defaults to the current session", () => {
        expect(source()).toContain("../writing-for-agents/SKILL.md");
        expect(source()).toContain("default to the current session");
    });

    it("reviews skill failures against primary session evidence", () => {
        expect(source()).toContain("primary sources");
        expect(source()).toContain("**Skills and prompts**");
        expect(source()).toContain("trigger");
        expect(source()).toContain("observed failures from hypotheses");
    });

    it("prefers existing automated guardrails to more instructions", () => {
        expect(source()).toContain("check command");
        expect(source()).toContain("pre-commit");
        expect(source()).toContain("CI");
        expect(source()).toContain("deterministic check");
        expect(source()).toContain("judgement calls");
    });

    it("ranks findings without applying fixes", () => {
        expect(source()).toContain("order of severity");
        expect(source()).toContain("Do not edit files or apply fixes");
        expect(source()).toContain("user's approval");
        expect(source()).toContain("Redact secrets");
    });
});
