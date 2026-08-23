const PI_DOCS_BLOCK =
    /\n*Pi documentation \([^\n]*\):\n[\s\S]*?\n- Always read pi \.md files completely and follow links to related docs \(e\.g\., tui\.md for TUI API details\)\n*/;

/** Remove the known upstream Pi-help block; unknown prompt shapes fail open. */
export function stripPiDocumentation(systemPrompt: string): string {
    return systemPrompt.replace(PI_DOCS_BLOCK, (match, offset: number) => {
        const hasTextBefore = offset > 0;
        const hasTextAfter = offset + match.length < systemPrompt.length;
        return hasTextBefore && hasTextAfter ? "\n\n" : "";
    });
}

/** True for an explicit request about Pi itself, not ordinary coding work. */
export function isPiHelpPrompt(prompt: string): boolean {
    const normalized = prompt.toLowerCase();
    return (
        normalized.startsWith("pi help request:") ||
        (/\bpi\b/.test(normalized) &&
            /\b(?:help|docs?|documentation|sdk|extensions?|themes?|skills?|tui|keybindings?|providers?|models?|packages?)\b/.test(
                normalized,
            ))
    );
}
