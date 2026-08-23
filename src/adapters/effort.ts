import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { EFFORT_LEVELS, parseEffortLevel } from "../domain/effort.ts";

const SHORTCUT = "alt+e";
const LEVEL_DESCRIPTIONS: Record<ThinkingLevel, string> = {
    off: "No reasoning",
    minimal: "Very brief reasoning",
    low: "Light reasoning",
    medium: "Moderate reasoning",
    high: "Deep reasoning",
    xhigh: "Extra-high reasoning",
    max: "Maximum reasoning",
};

function availableLevels(ctx: ExtensionContext): ThinkingLevel[] {
    return ctx.model ? getSupportedThinkingLevels(ctx.model) : [];
}

function setEffort(pi: ExtensionAPI, ctx: ExtensionContext, level: ThinkingLevel): void {
    pi.setThinkingLevel(level);
    ctx.ui.notify(`Effort level: ${pi.getThinkingLevel()}`, "info");
}

async function selectEffort(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
    if (!ctx.model) {
        ctx.ui.notify("No model selected.", "error");
        return;
    }

    const levels = availableLevels(ctx);
    const selected = await ctx.ui.select(
        `Effort level (current: ${pi.getThinkingLevel()})`,
        levels,
    );
    const level = selected ? parseEffortLevel(selected) : undefined;
    if (level) setEffort(pi, ctx, level);
}

export default function registerEffort(pi: ExtensionAPI): void {
    pi.registerCommand("effort", {
        description: "Select or set the model effort level",
        getArgumentCompletions: (prefix) => {
            const normalized = prefix.trim().toLowerCase();
            const items = EFFORT_LEVELS.filter((level) => level.startsWith(normalized)).map(
                (level) => ({
                    value: level,
                    label: level,
                    description: LEVEL_DESCRIPTIONS[level],
                }),
            );
            return items.length > 0 ? items : null;
        },
        handler: async (args, ctx) => {
            if (!args.trim()) {
                await selectEffort(pi, ctx);
                return;
            }

            const level = parseEffortLevel(args);
            if (!level) {
                ctx.ui.notify(`Usage: /effort [${EFFORT_LEVELS.join("|")}]`, "error");
                return;
            }
            if (!ctx.model) {
                ctx.ui.notify("No model selected.", "error");
                return;
            }

            const supported = availableLevels(ctx);
            if (!supported.includes(level)) {
                ctx.ui.notify(
                    `${level} effort is not supported by ${ctx.model.id}. Supported: ${supported.join(", ")}`,
                    "error",
                );
                return;
            }
            setEffort(pi, ctx, level);
        },
    });

    pi.registerShortcut(SHORTCUT, {
        description: "Select effort level",
        handler: async (ctx) => selectEffort(pi, ctx),
    });
}
