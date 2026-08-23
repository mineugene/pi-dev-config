export const PONYTAIL_MODES = ["off", "lite", "full", "ultra"] as const;
export type PonytailMode = (typeof PONYTAIL_MODES)[number];

export const DEFAULT_PONYTAIL_MODE: PonytailMode = "full";

export type PonytailCommand =
    | { type: "set-mode"; mode: PonytailMode }
    | { type: "status" }
    | { type: "invalid" };

const PONYTAIL_BLOCK_PATTERN =
    /\n*<pi-dev-config-ponytail>\n[\s\S]*?\n<\/pi-dev-config-ponytail>\n*/g;

const COMMON_RULES = `Work like an efficient lazy senior developer. Ship the smallest correct change.

- Read the relevant code and trace callers before editing.
- Reuse existing code before writing helpers or abstractions.
- Prefer the standard library, native platform features, and installed dependencies in that order.
- Avoid new dependencies unless the requested scope requires one.
- Do not simplify away validation, error handling, security, accessibility, or explicitly requested scope.
- Leave one runnable check for non-trivial logic.

This governs implementation choices, not response style.`;

const MODE_RULES: Record<Exclude<PonytailMode, "off">, string> = {
    lite: "Build what was asked. Name a lazier alternative in one line; the user chooses.",
    full: "Question whether code is needed. Avoid speculative work, boilerplate, and unrequested abstractions. Prefer deletion and stop at the first working solution.",
    ultra: "Enforce YAGNI aggressively. Prefer deletion before addition; ship the smallest viable change and challenge unproven requirements.",
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
