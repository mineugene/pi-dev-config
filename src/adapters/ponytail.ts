import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
    applyPonytailPromptBlock,
    DEFAULT_PONYTAIL_MODE,
    isPonytailDeactivationPhrase,
    isPonytailMode,
    PONYTAIL_MODES,
    type PonytailMode,
    parsePonytailCommand,
    resolvePonytailMode,
} from "../domain/ponytail.ts";

const ENTRY_TYPE = "ponytail-mode";
const COMMAND_ARGUMENTS = [...PONYTAIL_MODES, "status"] as const;
const PONYTAIL_ICON = "\ued63";

function persistedMode(data: unknown): PonytailMode | undefined {
    if (typeof data !== "object" || data === null || !("mode" in data)) return undefined;
    return isPonytailMode(data.mode) ? data.mode : undefined;
}

function restoreMode(ctx: ExtensionContext): PonytailMode {
    const modes: PonytailMode[] = [];
    for (const entry of ctx.sessionManager.getBranch()) {
        if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE) continue;
        const mode = persistedMode(entry.data);
        if (mode) modes.push(mode);
    }
    return resolvePonytailMode(modes, DEFAULT_PONYTAIL_MODE);
}

function label(mode: PonytailMode): string {
    return `Ponytail: ${mode}`;
}

export default function registerPonytail(pi: ExtensionAPI): void {
    let currentMode: PonytailMode = DEFAULT_PONYTAIL_MODE;

    const refreshStatus = (ctx: ExtensionContext): void => {
        ctx.ui.setStatus(
            "ponytail",
            currentMode === "off"
                ? undefined
                : `${PONYTAIL_ICON}  mode: ${currentMode.toUpperCase()}`,
        );
    };
    const setMode = (mode: PonytailMode, ctx: ExtensionContext, persist: boolean): void => {
        const changed = mode !== currentMode;
        currentMode = mode;
        if (persist && changed) pi.appendEntry(ENTRY_TYPE, { mode });
        refreshStatus(ctx);
    };

    pi.on("session_start", (_event, ctx) => {
        setMode(restoreMode(ctx), ctx, false);
    });

    pi.on("session_tree", (_event, ctx) => {
        setMode(restoreMode(ctx), ctx, false);
    });

    pi.on("input", (event, ctx) => {
        if (event.source === "extension" || !isPonytailDeactivationPhrase(event.text)) return;
        setMode("off", ctx, true);
    });

    pi.on("before_agent_start", (event) => ({
        systemPrompt: applyPonytailPromptBlock(event.systemPrompt, currentMode),
    }));

    pi.registerCommand("ponytail", {
        description: `Show or set Ponytail mode: ${PONYTAIL_MODES.join(", ")}`,
        getArgumentCompletions: (prefix) => {
            const input = prefix.trim().toLowerCase();
            const matches = COMMAND_ARGUMENTS.filter((option) => option.startsWith(input));
            return matches.length > 0 ? matches.map((value) => ({ value, label: value })) : null;
        },
        handler: async (args, ctx) => {
            const command = parsePonytailCommand(args);
            if (command.type === "invalid") {
                ctx.ui.notify(`Usage: /ponytail [${COMMAND_ARGUMENTS.join("|")}]`, "error");
                return;
            }
            if (command.type === "status") {
                ctx.ui.notify(label(currentMode), "info");
                return;
            }
            setMode(command.mode, ctx, true);
            ctx.ui.notify(label(currentMode), "info");
        },
    });
}
