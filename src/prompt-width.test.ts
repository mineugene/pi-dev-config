import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Prose an agent reads stays inside this width. */
const MAX_WIDTH = 80;

/** A fence open or close: optional indent, then a run of three or more backticks or tildes. */
const FENCE = /^([ \t]*)(`{3,}|~{3,})(.*)$/;

function markdownFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return markdownFiles(path);
        return entry.name.endsWith(".md") ? [path] : [];
    });
}

/**
 * Returns lines over MAX_WIDTH. Frontmatter, fenced code, and table rows are
 * skipped: a YAML description, a shell command, and a table cell cannot be
 * wrapped without changing meaning. A fence opens on ` or ~ (three or more,
 * any indent) and closes on the same character at the same or greater length.
 */
function overlongLines(markdown: string): string[] {
    const overlong: string[] = [];
    const lines = markdown.split(/\r?\n/);
    let inFrontmatter = lines[0] === "---";
    let fence: { char: string; length: number } | null = null;
    lines.forEach((text, index) => {
        if (inFrontmatter) {
            if (index > 0 && text === "---") inFrontmatter = false;
            return;
        }
        const match = text.match(FENCE);
        const run = match?.[2];
        if (fence) {
            const closes =
                run !== undefined &&
                run.charAt(0) === fence.char &&
                run.length >= fence.length &&
                (match?.[3] ?? "").trim() === "";
            if (closes) fence = null;
            return;
        }
        if (run !== undefined) {
            fence = { char: run.charAt(0), length: run.length };
            return;
        }
        if (!/^\s*\|/.test(text) && text.length > MAX_WIDTH) {
            overlong.push(`line ${index + 1} (${text.length}): ${text}`);
        }
    });
    return overlong;
}

describe("overlong line detection", () => {
    const long = "x".repeat(MAX_WIDTH + 10);

    it("skips frontmatter, including CRLF delimiters", () => {
        expect(overlongLines(`---\ndescription: ${long}\n---\nok\n`)).toEqual([]);
        expect(overlongLines(`---\r\ndescription: ${long}\r\n---\r\nok\r\n`)).toEqual([]);
    });

    it("skips fenced code for both fence characters and any indent", () => {
        expect(overlongLines(`text\n\n\`\`\`sh\n${long}\n\`\`\`\n`)).toEqual([]);
        expect(overlongLines(`text\n\n~~~\n${long}\n~~~\n`)).toEqual([]);
        expect(overlongLines(`  \`\`\`sh\n  ${long}\n  \`\`\`\n`)).toEqual([]);
    });

    it("skips table rows", () => {
        expect(overlongLines(`| a | ${"y".repeat(MAX_WIDTH)} |`)).toEqual([]);
    });

    it("flags prose over the width", () => {
        expect(overlongLines(`ok\n${"z".repeat(MAX_WIDTH + 1)}`)).toHaveLength(1);
    });
});

describe("agent markdown width", () => {
    for (const root of ["../prompts", "../skills"]) {
        const dir = fileURLToPath(new URL(root, import.meta.url));
        for (const file of markdownFiles(dir)) {
            it(`${relative(join(dir, ".."), file)} stays within ${MAX_WIDTH} columns`, () => {
                expect(overlongLines(readFileSync(file, "utf8"))).toEqual([]);
            });
        }
    }
});
