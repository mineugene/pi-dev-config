import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("create-pr skill", () => {
    it("is manual and carries the PR guard sentinel", () => {
        const skill = read("../skills/create-pr/SKILL.md");
        const guard = read("./adapters/pr-guard.ts");

        expect(skill).toContain("name: create-pr");
        expect(skill).toContain("disable-model-invocation: true");
        expect(skill).toContain("pidev:create-pr-skill");
        expect(guard).toContain('PR_SENTINEL = "pidev:create-pr-skill"');
        expect(guard).toContain("via /skill:create-pr");
        expect(existsSync(new URL("../prompts/create-pr.md", import.meta.url))).toBe(false);
    });

    it("loads only the selected forge guide", () => {
        const skill = read("../skills/create-pr/SKILL.md");

        expect(skill).toContain("read only its guide");
        expect(skill).toContain("providers/github.md");
        expect(skill).toContain("providers/azure.md");
        expect(skill).toContain("providers/tea.md");
    });

    it("tells Azure DevOps to pass the body as one description list", () => {
        const azure = read("../skills/create-pr/providers/azure.md");

        expect(azure).toContain("Repeating the flag keeps only");
        expect(azure).toContain("az repos pr show --id <id> --query description");
    });
});
