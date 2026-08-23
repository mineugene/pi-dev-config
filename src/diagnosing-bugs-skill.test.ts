import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const skillPath = new URL("../skills/diagnosing-bugs/SKILL.md", import.meta.url);
const hitlTemplatePath = new URL(
    "../skills/diagnosing-bugs/scripts/hitl-loop.template.sh",
    import.meta.url,
);

describe("diagnosing-bugs skill", () => {
    it("provides the upstream diagnosis loop", () => {
        const skill = readFileSync(skillPath, "utf8");

        expect(skill).toContain("name: diagnosing-bugs");
        expect(skill).toContain("# Diagnosing Bugs");
        expect(skill).toContain("## Phase 1: Build a feedback loop");
        expect(skill).toContain("## Phase 6: Cleanup");
        expect(skill).toContain("scripts/hitl-loop.template.sh");
    });

    it("includes the human-in-the-loop feedback-loop template", () => {
        const template = readFileSync(hitlTemplatePath, "utf8");

        expect(template).toContain("Human-in-the-loop reproduction loop.");
        expect(template).toContain("capture ERRORED");
    });
});
