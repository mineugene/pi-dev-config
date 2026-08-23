import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, test, vi } from "vitest";
import registerFileMention, { endsAfterUnquotedMention, extractAtPrefix } from "./file-mention.ts";

describe("extractAtPrefix", () => {
    test("keeps spaces inside an open quoted mention", () => {
        expect(extractAtPrefix('read @"dir with')).toBe('@"dir with');
    });

    test("ends an unquoted mention at whitespace", () => {
        expect(extractAtPrefix("read @src/file.ts ")).toBeNull();
    });
});

describe("endsAfterUnquotedMention", () => {
    test("recognises whitespace after an unquoted mention", () => {
        expect(endsAfterUnquotedMention("read @src/file.ts ")).toBe(true);
        expect(endsAfterUnquotedMention("read @ ")).toBe(true);
    });

    test("does not terminate an open quoted mention", () => {
        expect(endsAfterUnquotedMention('read @"dir with ')).toBe(false);
    });

    test("does not treat a normal trailing space as an at mention", () => {
        expect(endsAfterUnquotedMention("read source ")).toBe(false);
    });
});

test("file mentions do not own shared FFF shutdown", () => {
    const on = vi.fn();
    registerFileMention({ on } as unknown as ExtensionAPI);

    expect(on).toHaveBeenCalledOnce();
    const [event, handler] = on.mock.calls[0] ?? [];
    expect(event).toBe("session_start");
    expect(typeof handler).toBe("function");
});
