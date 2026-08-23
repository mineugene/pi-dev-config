import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("to-pr skill", () => {
    it("is manual and carries the PR guard sentinel", () => {
        const skill = read("../skills/to-pr/SKILL.md");
        const guard = read("./adapters/pr-guard.ts");

        expect(skill).toContain("name: to-pr");
        expect(skill).toContain("disable-model-invocation: true");
        expect(skill).toContain("pidev:to-pr-skill");
        expect(guard).toContain('PR_SENTINEL = "pidev:to-pr-skill"');
        expect(guard).toContain("via /skill:to-pr");
        expect(existsSync(new URL("../prompts/to-pr.md", import.meta.url))).toBe(false);
    });

    it("creates the pull request without a review gate", () => {
        const skill = read("../skills/to-pr/SKILL.md");

        expect(skill).not.toContain("## Review output");
        expect(skill).not.toContain("Wait for user confirmation");
        expect(skill).toContain("## Output");
    });

    it("keeps the PR body shape in the to-pr skill", () => {
        const skill = read("../skills/to-pr/SKILL.md");

        expect(skill).toContain("## Summary");
        expect(skill).toContain("## Changes");
        expect(skill).toContain("## Testing");
        expect(skill).toContain("## Validation");
    });

    it("loads only the selected forge guide", () => {
        const skill = read("../skills/to-pr/SKILL.md");

        expect(skill).toContain("read only its guide");
        expect(skill).toContain("providers/github.md");
        expect(skill).toContain("providers/azure.md");
        expect(skill).toContain("providers/tea.md");
    });

    it("tells Azure DevOps to pass the body as one description list", () => {
        const azure = read("../skills/to-pr/providers/azure.md");

        expect(azure).toContain("Pass the flag exactly once");
        expect(azure).toContain("az repos pr show --id <id> --query description");
    });
});
