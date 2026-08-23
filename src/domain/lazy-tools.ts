/** Keep activated tools for the rest of the session in stable insertion order. */
export function addDeferredTools(
    activeTools: readonly string[],
    namesToAdd: readonly string[],
): string[] {
    return [...new Set([...activeTools, ...namesToAdd])];
}

export interface DeferredTool {
    readonly name: string;
    readonly description: string;
    readonly keywords: readonly string[];
}

/** Return deferred tool names ranked by deterministic term matches. */
export function searchDeferredTools(query: string, tools: readonly DeferredTool[]): string[] {
    const terms = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    const ranked = tools.map((tool) => {
        const haystack =
            `${tool.name} ${tool.description} ${tool.keywords.join(" ")}`.toLowerCase();
        return { tool, score: terms.filter((term) => haystack.includes(term)).length };
    });
    const bestScore = Math.max(0, ...ranked.map(({ score }) => score));
    return ranked
        .filter(({ score }) => score > 0 && score === bestScore)
        .sort((a, b) => a.tool.name.localeCompare(b.tool.name))
        .map(({ tool }) => tool.name);
}
