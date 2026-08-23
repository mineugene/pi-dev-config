import { describe, expect, it } from "vitest";
import { truncateHead, truncateTail } from "./text.ts";

describe("bounded text", () => {
    it("leaves text within the limit unchanged", () => {
        expect(truncateHead("short", 10, "...")).toBe("short");
        expect(truncateTail("short", 10, "...")).toBe("short");
    });

    it("preserves the start or end and includes the marker", () => {
        expect(truncateHead("abcdefghij", 7, "...")).toBe("abcd...");
        expect(truncateTail("abcdefghij", 7, "...")).toBe("...ghij");
    });

    it("never exceeds small or zero limits", () => {
        expect(truncateHead("abcdef", 2, "marker")).toBe("ma");
        expect(truncateTail("abcdef", 2, "marker")).toBe("ma");
        expect(truncateHead("abcdef", 0, "marker")).toBe("");
    });
});
