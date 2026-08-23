export interface ContextAuditInput {
    readonly systemPrompt: string;
    readonly systemPromptSource: string;
    readonly contextFiles: readonly { path: string; content: string }[];
    readonly injectedFeatureBlocks: readonly string[];
    readonly skills: readonly { name: string }[];
    readonly advertisedSkillPromptChars: number;
    readonly activeTools: readonly string[];
    readonly activeToolSchemaChars: number;
    readonly deferredToolCount: number;
    readonly messages: { user: number; assistant: number; toolResults: number };
    readonly contextTokens: number | null;
    readonly compactionCount: number;
    readonly model: string;
    readonly thinkingLevel: string;
}

/** Conservative display-only estimate. It is never presented as exact tokenization. */
export function estimateTokens(text: string): number {
    return estimateTokensFromCharacters(text.length);
}

function estimateTokensFromCharacters(characters: number): number {
    return Math.ceil(characters / 4);
}

export function formatContextAudit(input: ContextAuditInput): string {
    const contextTokens = input.contextFiles.reduce(
        (sum, file) => sum + estimateTokens(file.content),
        0,
    );
    const skillTokens = estimateTokensFromCharacters(input.advertisedSkillPromptChars);
    return [
        "System prompt",
        `  source              ${input.systemPromptSource}`,
        `  estimate (chars/4)  ${estimateTokens(input.systemPrompt)}`,
        "  base/system instructions included in total",
        `  AGENTS/context files    ${input.contextFiles.length} (${contextTokens} estimate)`,
        `  injected feature blocks ${input.injectedFeatureBlocks.length}${input.injectedFeatureBlocks.length ? ` (${input.injectedFeatureBlocks.join(", ")})` : ""}`,
        `  advertised skills       ${input.skills.length} (${skillTokens} estimate)`,
        "Tools",
        `  active tool count       ${input.activeTools.length}`,
        `  active tools            ${input.activeTools.join(", ") || "none"}`,
        `  active schemas          ${estimateTokensFromCharacters(input.activeToolSchemaChars)} estimate`,
        `  deferred/inactive count ${input.deferredToolCount}`,
        "Conversation",
        `  user messages           ${input.messages.user}`,
        `  assistant messages      ${input.messages.assistant}`,
        `  tool results            ${input.messages.toolResults}`,
        `  current context         ${input.contextTokens ?? "unavailable"}${input.contextTokens === null ? "" : " estimate"}`,
        "Session",
        `  compaction count        ${input.compactionCount}`,
        `  model                   ${input.model}`,
        `  thinking level          ${input.thinkingLevel}`,
    ].join("\n");
}
