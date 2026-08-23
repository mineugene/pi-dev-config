export const PONYTAIL_MODES = ["off", "lite", "full", "ultra"] as const;
export type PonytailMode = (typeof PONYTAIL_MODES)[number];

export const DEFAULT_PONYTAIL_MODE: PonytailMode = "full";

export type PonytailCommand =
    | { type: "set-mode"; mode: PonytailMode }
    | { type: "status" }
    | { type: "invalid" };

const PONYTAIL_BLOCK_PATTERN =
    /\n*<pi-dev-config-ponytail>\n[\s\S]*?\n<\/pi-dev-config-ponytail>\n*/g;

const COMMON_RULES = `Do the least work that meets the request. Ship the least code that is correct.

1. Before editing, read the relevant code and trace its callers.
2. Reuse existing code before writing a helper or an abstraction.
3. Use the standard library first, then a native platform feature, then an installed dependency.
4. Add a dependency only when the requested scope requires it.
5. Do not remove validation, error handling, security, accessibility, or explicitly requested scope.
6. For non-trivial logic, leave one runnable check.

This governs implementation choices, not response style.`;

const MODE_RULES: Record<Exclude<PonytailMode, "off">, string> = {
    lite: "Build what was asked. Name one lazier alternative; the user chooses.",
    full: "Ask whether the code is needed. Do not add speculative work, boilerplate, or an unrequested abstraction. Delete before adding. Stop at the first working solution.",
    ultra: "Enforce YAGNI. Delete before adding. Ship the least code that meets the requirement. Challenge every unproven requirement.",
};

export function isPonytailMode(value: unknown): value is PonytailMode {
    return typeof value === "string" && PONYTAIL_MODES.includes(value as PonytailMode);
}

export function parsePonytailCommand(input: string): PonytailCommand {
    const argument = input.trim().toLowerCase();
    if (!argument || argument === "status") return { type: "status" };
    return isPonytailMode(argument) ? { type: "set-mode", mode: argument } : { type: "invalid" };
}

export function isPonytailDeactivationPhrase(input: string): boolean {
    const normalized = input
        .trim()
        .toLowerCase()
        .replace(/[.!?]+$/, "")
        .trim();
    return normalized === "stop ponytail" || normalized === "normal mode";
}

/** The final item is the newest valid persisted state. */
export function resolvePonytailMode(
    persistedModes: readonly PonytailMode[],
    fallback: PonytailMode,
): PonytailMode {
    return persistedModes.at(-1) ?? fallback;
}

export function ponytailInstructions(mode: Exclude<PonytailMode, "off">): string {
    return `PONYTAIL MODE ACTIVE: ${mode}\n\n${COMMON_RULES}\n\n${MODE_RULES[mode]}`;
}

/** Remove all Ponytail-owned blocks, then append the one matching the active mode. */
export function applyPonytailPromptBlock(systemPrompt: string, mode: PonytailMode): string {
    const cleaned = systemPrompt
        .replace(PONYTAIL_BLOCK_PATTERN, (match, offset: number) => {
            const hasTextBefore = offset > 0;
            const hasTextAfter = offset + match.length < systemPrompt.length;
            return hasTextBefore && hasTextAfter ? "\n\n" : "";
        })
        .trimEnd();
    if (mode === "off") return cleaned;
    const block = `<pi-dev-config-ponytail>\n${ponytailInstructions(mode)}\n</pi-dev-config-ponytail>`;
    return cleaned ? `${cleaned}\n\n${block}` : block;
}
