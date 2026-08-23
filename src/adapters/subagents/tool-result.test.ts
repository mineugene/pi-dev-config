import { describe, expect, it } from "vitest";
import { textResult } from "./tool-result.ts";

describe("textResult", () => {
    it("caps subagent output returned to the model", () => {
        const result = textResult("x".repeat(60_000));
        const content = result.content[0];

        expect(content?.text).toHaveLength(50_000);
        expect(content?.text).toContain("[Agent output truncated.");
    });
});
