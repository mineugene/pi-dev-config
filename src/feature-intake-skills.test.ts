import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Collapse whitespace so prose assertions survive rewrapping. */
const read = (path: URL) => readFileSync(path, "utf8").replace(/\s+/g, " ");

const skill = (name: string) => read(new URL(`../skills/${name}/SKILL.md`, import.meta.url));

const provider = (name: string) => read(new URL(`../skills/providers/${name}.md`, import.meta.url));

const shared = (name: string) => read(new URL(`../skills/${name}.md`, import.meta.url));

describe("feature intake skills", () => {
    it("interviews underspecified feature requests before offering later phases", () => {
        const source = skill("grill-with-docs");

        expect(source).toContain("user asks to build or implement something");
        expect(source).toContain("Do not implement while the interview is active");
        expect(source).toContain("Load `to-spec`");
        expect(source).toContain("load `to-tickets`");
    });

    it("keeps specification and issue publication behind the tracker gate", () => {
        expect(shared("tracker-workflow")).toContain("wait for user confirmation");
        expect(skill("to-spec")).toContain("tracker-workflow.md");
        expect(skill("to-tickets")).toContain("tracker-workflow.md");
    });

    it("supports the configured home and work issue trackers", () => {
        expect(provider("azure")).toContain("`az boards work-item create --detect true`");
        expect(provider("azure")).toContain("specifications are `Feature` work items");
        expect(provider("azure")).toContain("implementation slices are `User Story` work items");
        expect(provider("github")).toContain("`gh issue create`");
        expect(provider("tea")).toContain("`tea issues create --help`");
    });
});
