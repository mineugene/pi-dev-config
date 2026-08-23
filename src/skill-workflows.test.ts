import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) =>
    readFileSync(new URL(`../skills/${path}`, import.meta.url), "utf8").replace(/\s+/g, " ");

const skill = (name: string) => source(`${name}/SKILL.md`);

describe("delegated skill workflows", () => {
    it.each([
        "code-review/SKILL.md",
        "implement-spec/SKILL.md",
        "codebase-design/DESIGN-IT-TWICE.md",
        "grilling/SKILL.md",
        "improve-codebase-architecture/SKILL.md",
    ])("starts fresh subagents in %s", (path) => {
        expect(source(path)).toContain("inherit_context: false");
        expect(source(path)).toContain("no `resume`");
    });

    it("waits for parallel reviewers and runs implementers in the background", () => {
        expect(skill("code-review")).toContain("run_in_background: false");
        expect(skill("implement-spec")).toContain("run_in_background: true");
    });

    it("keeps read-only Explore from needing write access", () => {
        expect(skill("implement-spec")).toContain("read-only Explore return findings");
        expect(skill("implement-spec")).toContain("write the notes from the parent");
    });

    it("uses merged work for dependencies and reviews before tracker closure", () => {
        expect(skill("implement-spec")).toContain(
            "implemented and merged into the integration branch",
        );
        expect(skill("implement-spec")).toContain("When every issue is implemented");
        expect(skill("implement-spec")).toContain("one fresh implementer subagent");
        expect(skill("implement-spec")).toContain("closing references");
    });
});

describe("planning skill workflows", () => {
    it("records test modules, behaviours, and existing examples", () => {
        expect(skill("to-spec")).toContain("modules under test");
        expect(skill("to-spec")).toContain("comparable existing tests");
        expect(skill("to-spec")).toContain("Test external behaviour, not implementation details");
    });

    it("makes expand-contract dependencies explicit", () => {
        expect(skill("to-tickets")).toContain("Retain the old form during migration");
        expect(skill("to-tickets")).toContain("Each migration batch is blocked by expand");
        expect(skill("to-tickets")).toContain("contract is blocked by every migration batch");
        expect(skill("to-tickets")).toContain("only after no caller remains");
    });

    it("defers interface proposals and loads the domain-modelling owner", () => {
        expect(skill("improve-codebase-architecture")).toContain("without proposing interfaces");
        expect(skill("improve-codebase-architecture")).toContain("../domain-modeling/SKILL.md");
    });

    it("cleans up temporary wizards and makes retained scripts discoverable", () => {
        expect(skill("wizard")).toContain("Delete an ephemeral wizard when its job is complete");
        expect(skill("wizard")).toContain("link it from the README");
    });
});
