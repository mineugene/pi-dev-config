/** Pure extraction, relevance selection, and conservative token bounding for web pages. */

export interface ExtractedWebContent {
    title?: string;
    markdown: string;
}

export interface SelectedWebContent {
    content: string;
    truncated: boolean;
    estimatedTokens: number;
}

interface Section {
    text: string;
    score: number;
}

const BLOCK_TAGS = new Set(["p", "div", "section", "article", "main", "blockquote"]);

function decodeHtml(text: string): string {
    return text
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'");
}

function cleanText(text: string): string {
    return decodeHtml(text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")).trim();
}

function htmlToMarkdown(html: string): string {
    let text = html
        .replace(/<(script|style|nav|footer|aside|form)[\s\S]*?<\/\1>/gi, "")
        .replace(/<(article|main)\b[^>]*>/gi, "")
        .replace(/<\/(article|main)>/gi, "")
        .replace(
            /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi,
            (_all, level: string, body: string) =>
                `\n\n${"#".repeat(Number(level))} ${cleanText(body)}\n\n`,
        )
        .replace(
            /<pre\b[^>]*>\s*<code\b([^>]*)>([\s\S]*?)<\/code>\s*<\/pre>/gi,
            (_all, attrs: string, body: string) => {
                const language = /language-([\w+-]+)/i.exec(attrs)?.[1] ?? "";
                return `\n\n\`\`\`${language}\n${decodeHtml(body).trim()}\n\`\`\`\n\n`;
            },
        )
        .replace(
            /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
            (_all, href: string, body: string) => {
                const label = cleanText(body);
                return label ? `[${label}](${href})` : "";
            },
        )
        .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_all, body: string) => `\n- ${cleanText(body)}`)
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(?:p|div|section|blockquote|ul|ol)>/gi, "\n\n");
    for (const tag of BLOCK_TAGS) text = text.replace(new RegExp(`<${tag}\\b[^>]*>`, "gi"), "");
    return cleanMarkdown(decodeHtml(text.replace(/<[^>]*>/g, "")));
}

function cleanMarkdown(text: string): string {
    return text
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

/** Extract useful static HTML without executing untrusted page code. */
export function extractWebContent(source: string, contentType = "text/html"): ExtractedWebContent {
    if (!/html|xhtml/i.test(contentType)) return { markdown: cleanMarkdown(source) };
    const title =
        cleanText(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(source)?.[1] ?? "") || undefined;
    const main = /<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(source)?.[0] ?? source;
    return { ...(title ? { title } : {}), markdown: htmlToMarkdown(main) };
}

/** Conservative, deterministic estimate. The final character cap makes this a hard local bound. */
export function estimateWebTokens(text: string): number {
    return Math.ceil(text.length / 3);
}

function sections(markdown: string, query?: string): Section[] {
    const parts = markdown.split(/(?=^#{1,6}\s+)/m).filter((part) => part.trim());
    const terms = (query?.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []).filter(
        (term, index, all) => all.indexOf(term) === index,
    );
    return parts.map((text) => {
        const lower = text.toLocaleLowerCase();
        const score = terms.reduce((total, term) => total + (lower.includes(term) ? 1 : 0), 0);
        return { text: text.trim(), score };
    });
}

function cutToBudget(text: string, maxTokens: number): string {
    const maxChars = maxTokens * 3;
    if (text.length <= maxChars) return text;
    const prefix = text.slice(0, maxChars);
    return (
        prefix.lastIndexOf("\n\n") > maxChars / 2
            ? prefix.slice(0, prefix.lastIndexOf("\n\n"))
            : prefix.slice(0, prefix.lastIndexOf(" "))
    ).trim();
}

/** Select relevant heading sections then bound output before it reaches the model. */
export function selectWebContent(
    markdown: string,
    query: string | undefined,
    maxTokens: number,
): SelectedWebContent {
    const all = sections(markdown, query);
    const matches = all.filter((section) => section.score > 0);
    // Keep the document title as parent context for focused sections.
    const chosen =
        query && matches.length
            ? all.filter((section, index) => index === 0 || section.score > 0)
            : all;
    const content = cutToBudget(chosen.map((section) => section.text).join("\n\n"), maxTokens);
    return {
        content,
        truncated: content.length < markdown.trim().length,
        estimatedTokens: estimateWebTokens(content),
    };
}
