import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const skill = (name: string) =>
    readFileSync(new URL(`../skills/${name}/SKILL.md`, import.meta.url), "utf8");

const trackerWorkflow = readFileSync(
    new URL("../skills/tracker-workflow.md", import.meta.url),
    "utf8",
);

describe("feature intake skills", () => {
    it("interviews underspecified feature requests before offering later phases", () => {
        const source = skill("grill-with-docs");

        expect(source).toContain("user asks to build or implement something");
        expect(source).toContain("Do not implement while the interview is active");
        expect(source).toContain("Load `to-spec`");
        expect(source).toContain("load `to-tickets`");
    });

    it("keeps specification and issue publication behind confirmation", () => {
        expect(skill("to-spec")).toContain("wait for confirmation before publishing");
        expect(skill("to-tickets")).toContain("get confirmation before publishing");
    });

    it("supports the configured home and work issue trackers", () => {
        expect(trackerWorkflow).toContain("`az boards work-item create --detect true`");
        expect(trackerWorkflow).toContain("`gh issue create`");
        expect(trackerWorkflow).toContain("`tea issues create --help`");
        expect(trackerWorkflow).toContain("specifications are\n`Feature` work items");
        expect(trackerWorkflow).toContain("implementation slices are `User Story` work items");
    });
});
