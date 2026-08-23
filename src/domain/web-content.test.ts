import { describe, expect, it } from "vitest";

import { extractWebContent, selectWebContent } from "./web-content.ts";

describe("web content extraction", () => {
    it("removes page chrome and preserves technical Markdown", () => {
        const content = extractWebContent(
            `<!doctype html><html><head><title>Guide</title><style>.x{}</style></head><body><nav>Navigation links</nav><article><h1>Guide</h1><p>Useful <a href="https://example.com">link</a>.</p><h2>Install</h2><ul><li>Install it</li></ul><pre><code class="language-ts">const x = 1;\n</code></pre></article><footer>Footer</footer><script>alert(1)</script></body></html>`,
        );

        expect(content.title).toBe("Guide");
        expect(content.markdown).toContain("# Guide");
        expect(content.markdown).toContain("[link](https://example.com)");
        expect(content.markdown).toContain("- Install it");
        expect(content.markdown).toContain("```ts\nconst x = 1;");
        expect(content.markdown).not.toContain("Navigation links");
        expect(content.markdown).not.toContain("Footer");
    });

    it("keeps query-relevant sections in document order within a hard budget", () => {
        const markdown = `# Framework Guide\n\n## Installation\nInstall packages.\n\n## Authentication\nOAuth authentication uses API keys and tokens.\n\n## Styling\nChoose colours.\n\n## Deployment\nDeploy the app.`;
        const result = selectWebContent(markdown, "OAuth authentication API keys", 30);

        expect(result.content).toContain("## Authentication");
        expect(result.content).not.toContain("## Styling");
        expect(result.estimatedTokens).toBeLessThanOrEqual(30);
        expect(result.truncated).toBe(true);
    });

    it("never exceeds its estimated-token budget", () => {
        const result = selectWebContent("word ".repeat(20_000), undefined, 500);
        expect(result.estimatedTokens).toBeLessThanOrEqual(500);
        expect(result.truncated).toBe(true);
    });
});
