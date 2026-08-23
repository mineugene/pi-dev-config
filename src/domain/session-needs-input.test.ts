import { describe, expect, test } from "vitest";

import { needsUserInput } from "./session-needs-input.ts";

describe("needs-input detection", () => {
    test("recognizes work blocked on a required answer or choice", () => {
        expect(needsUserInput("I need the API endpoint before I can continue.")).toBe(true);
        expect(needsUserInput("Please choose one: PostgreSQL or SQLite.")).toBe(true);
        expect(needsUserInput("Which deployment target should I use?")).toBe(true);
    });

    test("leaves routine summaries and optional offers idle", () => {
        expect(needsUserInput("Implemented the tracker. All checks pass.")).toBe(false);
        expect(needsUserInput("Want me to commit this?")).toBe(false);
        expect(needsUserInput("Let me know if you want more detail.")).toBe(false);
        expect(needsUserInput(undefined)).toBe(false);
    });
});
