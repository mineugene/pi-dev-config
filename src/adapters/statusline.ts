/**
 * Status line footer.
 *
 * Replaces pi's footer with one line that packs the things worth glancing at:
 *
 *    profile   provider/model · thinking ·   route  <ctx>/<limit> (NN%) · ↑in ↓out ↺cache $cost         branch   /project 
 *
 * Adjoining segments share one Powerline transition wedge, as lualine does.
 * Backgrounds come from the active Pi theme. The used-context value turns yellow past 50k tokens and red past
 * 100k. Permission and Ponytail indicators use the same style below. Session activity is right-aligned.
 * An optional `statusline.command` from pidev.json is run after each turn and
 * shown as one of those status lines.
 * Adapted from pi-bites' footer.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

import type {
    ExtensionAPI,
    ExtensionContext,
    Theme,
    ThemeColor,
} from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { formatTokens } from "../domain/format.ts";
import type { PiDevConfig } from "../infra/config.ts";

const execAsync = promisify(exec);
const PILL_LEFT = "";
const PILL_RIGHT = "";
const PILL_OVERHEAD = 4;
const ROUTING_ICON = "\ueda6";
const PATH_ELLIPSIS_ICON = "\uf141";
const PROFILE_BACKGROUND: PaletteColour = {
    rgb: [187, 154, 247],
    ansi256: 183,
};
const PROFILE_FOREGROUND: PaletteColour = {
    rgb: [26, 27, 38],
    ansi256: 235,
};
const PRIORITY_BREAK = {
    importantOnly: 54,
    minimal: 86,
    less: 118,
} as const;
const RESET_FOREGROUND = "\x1b[39m";
const RESET_BACKGROUND = "\x1b[49m";

type ThemeBg = Parameters<Theme["getBgAnsi"]>[0];

interface PaletteColour {
    rgb: readonly [red: number, green: number, blue: number];
    ansi256: number;
}

type PillBackground = ThemeBg | PaletteColour;
type PillForeground = ThemeColor | PaletteColour;

interface StatuslinePalette {
    outer: PillBackground;
    inner: PillBackground;
}

interface PillSegment {
    background: PillBackground;
    foreground: PillForeground;
    text: string;
}

const OVERLAY_BACKGROUND: ThemeBg = "customMessageBg";
const SURFACE_BACKGROUND: ThemeBg = "selectedBg";

type FooterData = {
    getGitBranch(): string | null;
    getExtensionStatuses(): ReadonlyMap<string, string>;
    onBranchChange(callback: () => void): () => void;
};

interface UsageTotals {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
}

function finiteOrZero(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

/** Sum token/cost usage across the session's assistant messages. */
function sessionUsage(ctx: ExtensionContext): UsageTotals {
    const totals: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
    for (const entry of ctx.sessionManager.getEntries()) {
        if (entry.type !== "message" || entry.message.role !== "assistant") continue;
        const usage = entry.message.usage;
        if (!isRecord(usage)) continue;
        totals.input += finiteOrZero(usage.input);
        totals.output += finiteOrZero(usage.output);
        totals.cacheRead += finiteOrZero(usage.cacheRead);
        totals.cacheWrite += finiteOrZero(usage.cacheWrite);
        totals.cost += finiteOrZero(isRecord(usage.cost) ? usage.cost.total : usage.cost);
    }
    return totals;
}

function formatUsage(usage: UsageTotals): string {
    return [
        `↑${formatTokens(usage.input)}`,
        `↓${formatTokens(usage.output)}`,
        `↺${formatTokens(usage.cacheRead)}`,
        `$${usage.cost.toFixed(3)}`,
    ].join(" ");
}

function thinkingLevel(ctx: ExtensionContext): string {
    for (const entry of [...ctx.sessionManager.getBranch()].reverse()) {
        if (entry.type === "thinking_level_change") return entry.thinkingLevel;
    }
    return "off";
}

function paletteAnsi(
    theme: Theme,
    colour: PaletteColour,
    layer: "foreground" | "background",
): string {
    const code = layer === "foreground" ? 38 : 48;
    if (theme.getColorMode() === "256color") return `\x1b[${code};5;${colour.ansi256}m`;
    const [red, green, blue] = colour.rgb;
    return `\x1b[${code};2;${red};${green};${blue}m`;
}

function backgroundAnsi(theme: Theme, background: PillBackground): string {
    return typeof background === "string"
        ? theme.getBgAnsi(background)
        : paletteAnsi(theme, background, "background");
}

function backgroundForegroundAnsi(theme: Theme, background: PillBackground): string {
    return typeof background === "string"
        ? theme.getBgAnsi(background).replace("[48;", "[38;")
        : paletteAnsi(theme, background, "foreground");
}

function isPaletteColour(value: unknown): value is PaletteColour {
    if (!isRecord(value) || !Array.isArray(value.rgb) || value.rgb.length !== 3) return false;
    return [...value.rgb, value.ansi256].every(
        (part) => typeof part === "number" && Number.isInteger(part) && part >= 0 && part <= 255,
    );
}

function statuslinePalette(config: PiDevConfig, theme: Theme): StatuslinePalette {
    const palette = theme.name ? config.statusline?.palettes?.[theme.name] : undefined;
    return {
        outer: isPaletteColour(palette?.outer) ? palette.outer : OVERLAY_BACKGROUND,
        inner: isPaletteColour(palette?.inner) ? palette.inner : SURFACE_BACKGROUND,
    };
}

function foregroundAnsi(theme: Theme, foreground: PillForeground): string {
    return typeof foreground === "string"
        ? theme.getFgAnsi(foreground)
        : paletteAnsi(theme, foreground, "foreground");
}

function pillChain(theme: Theme, segments: readonly PillSegment[]): string {
    const first = segments[0];
    if (!first) return "";

    let output = `${RESET_BACKGROUND}${backgroundForegroundAnsi(theme, first.background)}${PILL_LEFT}`;
    for (const [index, segment] of segments.entries()) {
        const foreground = foregroundAnsi(theme, segment.foreground);
        output += `${backgroundAnsi(theme, segment.background)}${foreground} ${segment.text}${foreground} `;
        const next = segments[index + 1];
        if (next) {
            output += `${backgroundAnsi(theme, next.background)}${backgroundForegroundAnsi(theme, segment.background)}${PILL_RIGHT}`;
        } else {
            output += `${RESET_BACKGROUND}${backgroundForegroundAnsi(theme, segment.background)}${PILL_RIGHT}${RESET_FOREGROUND}`;
        }
    }
    return output;
}

function rightPillChain(theme: Theme, segments: readonly PillSegment[]): string {
    const first = segments[0];
    if (!first) return "";

    let output = `${RESET_BACKGROUND}${backgroundForegroundAnsi(theme, first.background)}${PILL_LEFT}`;
    for (const [index, segment] of segments.entries()) {
        const foreground = foregroundAnsi(theme, segment.foreground);
        output += `${backgroundAnsi(theme, segment.background)}${foreground} ${segment.text}${foreground} `;
        const next = segments[index + 1];
        if (next) {
            output += `${backgroundAnsi(theme, segment.background)}${backgroundForegroundAnsi(theme, next.background)}${PILL_LEFT}`;
        } else {
            output += `${RESET_BACKGROUND}${backgroundForegroundAnsi(theme, segment.background)}${PILL_RIGHT}${RESET_FOREGROUND}`;
        }
    }
    return output;
}

function contextColour(tokens: number | null | undefined): ThemeColor {
    if (typeof tokens === "number" && tokens >= 100_000) return "error";
    if (typeof tokens === "number" && tokens >= 50_000) return "warning";
    return "dim";
}

function routingText(status: string | undefined): string | undefined {
    if (!status) return undefined;
    return /^routing:\s*(.+)$/u.exec(status)?.[1];
}

function modelLabel(ctx: ExtensionContext): string {
    return ctx.model?.id ?? "no-model";
}

function projectRoot(cwd: string): string {
    const parts = cwd.split(/[\\/]/u).filter(Boolean);
    return parts.at(-1) ?? cwd;
}

function rightAlign(left: string, right: string, width: number): string {
    if (!right) return left;
    if (!left) return " ".repeat(Math.max(0, width - visibleWidth(right))) + right;
    const leftWidth = visibleWidth(left);
    const rightWidth = visibleWidth(right);
    if (leftWidth + 2 + rightWidth <= width) {
        return left + " ".repeat(width - leftWidth - rightWidth) + right;
    }
    return `${left}  ${right}`;
}

function buildFooterLine(
    ctx: ExtensionContext,
    footerData: FooterData,
    width: number,
    theme: Theme,
    config: PiDevConfig,
): string {
    const usage = ctx.getContextUsage();
    const tokens = usage?.tokens;

    const contextTokens = tokens === null || tokens === undefined ? "?" : formatTokens(tokens);
    const limit = formatTokens(usage?.contextWindow ?? ctx.model?.contextWindow ?? 0);
    const percent = typeof usage?.percent === "number" ? `${usage.percent.toFixed(0)}%` : "?%";
    const statsForeground: ThemeColor = "toolOutput";
    const palette = statuslinePalette(config, theme);
    const colouredContext = `${theme.getFgAnsi(contextColour(tokens))}${contextTokens}${theme.getFgAnsi(statsForeground)}/${limit} (${percent})`;
    const statuses = footerData.getExtensionStatuses();
    const identity = ctx.model?.provider ?? "";
    const modelAndRoute = `${modelLabel(ctx)} · ${thinkingLevel(ctx)}`;
    const modelSegments: PillSegment[] = [
        { background: palette.outer, foreground: "accent", text: modelAndRoute },
    ];
    if (width >= PRIORITY_BREAK.less) {
        modelSegments.push({
            background: palette.inner,
            foreground: statsForeground,
            text: `${colouredContext} · ${formatUsage(sessionUsage(ctx))}`,
        });
    }
    const left = pillChain(theme, [
        ...(identity
            ? [{ background: PROFILE_BACKGROUND, foreground: PROFILE_FOREGROUND, text: identity }]
            : []),
        ...modelSegments,
    ]);

    const branch = footerData.getGitBranch();
    const rightSegments: PillSegment[] = [];
    if (branch && width >= PRIORITY_BREAK.minimal) {
        rightSegments.push({
            background: palette.inner,
            foreground: "toolOutput",
            text: ` ${branch}`,
        });
    }
    const gitStatus = statuses.get("statusline-git");
    if (gitStatus && width >= PRIORITY_BREAK.minimal) {
        rightSegments.push({
            background: palette.inner,
            foreground: "toolOutput",
            text: gitStatus,
        });
    }
    if (width >= PRIORITY_BREAK.importantOnly) {
        rightSegments.push({
            background: palette.outer,
            foreground: "toolOutput",
            text: `${PATH_ELLIPSIS_ICON} /${projectRoot(ctx.cwd)}`,
        });
    }
    const right = rightPillChain(theme, rightSegments);

    if (!right) return truncateToWidth(left, width, "…");
    const aligned = rightAlign(left, right, width);
    if (visibleWidth(aligned) <= width) return aligned;
    if (visibleWidth(left) + PILL_OVERHEAD + 2 < width) {
        const contentWidth = width - visibleWidth(left) - PILL_OVERHEAD - 2;
        const truncatedRight = truncateToWidth(right, contentWidth, "…");
        return rightAlign(left, truncatedRight, width);
    }
    return truncateToWidth(left, width, "…");
}

function sessionStatusLine(status: string, theme: Theme): string | undefined {
    const match = /^π total (\d+) · !(\d+) · \?(\d+) · ▶(\d+)$/u.exec(status);
    if (!match) return undefined;
    const [, totalText, permissionText, inputText, workingText] = match;
    const total = Number(totalText);
    const permission = Number(permissionText);
    const input = Number(inputText);
    const working = Number(workingText);
    const idle = Math.max(0, total - permission - input - working);
    const separator = `${theme.getFgAnsi("dim")} · `;
    const categories: string[] = [];
    if (permission > 0) {
        categories.push(
            `${theme.getFgAnsi("error")}${permission} ${permission === 1 ? "needs" : "need"} permission`,
        );
    }
    if (input > 0) {
        categories.push(
            `${theme.getFgAnsi("warning")}${input} ${input === 1 ? "needs" : "need"} input`,
        );
    }
    if (working > 0) categories.push(`${theme.getFgAnsi("success")}${working} working`);
    if (idle > 0) categories.push(`${theme.getFgAnsi("toolOutput")}${idle} idle`);
    if (categories.length === 0) return undefined;
    return categories.join(separator);
}

export function formatGitStatus(output: string): string | undefined {
    let added = 0;
    let modified = 0;
    let removed = 0;
    for (const line of output.split("\n")) {
        const status = line.slice(0, 2);
        if (!status.trim()) continue;
        if (status === "??" || status.includes("A")) added++;
        else if (status.includes("D")) removed++;
        else modified++;
    }
    const parts = [
        ...(added > 0 ? [`+${added}`] : []),
        ...(modified > 0 ? [`󰦒${modified}`] : []),
        ...(removed > 0 ? [`-${removed}`] : []),
    ];
    return parts.length > 0 ? parts.join(" ") : undefined;
}

function extensionStatusLines(
    statuses: ReadonlyMap<string, string>,
    width: number,
    theme: Theme,
    config: PiDevConfig,
): string[] {
    const entries = Array.from(statuses.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, text]) => ({ key, text: text.replace(/[\r\n\t]+/g, " ").trim() }))
        .filter(({ text }) => Boolean(text));
    const statusOrder = [
        "session-tracker",
        "routing",
        "routing-profile",
        "statusline-git",
        "bash-gate-permissions",
        "ponytail",
    ] as const;
    const sessionStatus = entries.find(({ key }) => key === "session-tracker")?.text;
    const profile = entries.find(({ key }) => key === "routing-profile")?.text;
    const routing = routingText(entries.find(({ key }) => key === "routing")?.text);
    const permissions = entries.find(({ key }) => key === "bash-gate-permissions")?.text;
    const ponytail = entries.find(({ key }) => key === "ponytail")?.text;
    const palette = statuslinePalette(config, theme);
    const indicators: PillSegment[] = [];
    if (permissions) {
        indicators.push({
            background: palette.outer,
            foreground: permissions.endsWith("permissions: yolo") ? "error" : "borderAccent",
            text: permissions,
        });
    }
    if (routing && width >= PRIORITY_BREAK.importantOnly) {
        indicators.push({
            background: palette.inner,
            foreground: "toolOutput",
            text: `${ROUTING_ICON}  ${profile ? `${profile}: ` : ""}${routing}`,
        });
    }
    if (ponytail && width >= PRIORITY_BREAK.less) {
        indicators.push({
            background: palette.inner,
            foreground: "mdHeading",
            text: ponytail,
        });
    }
    const sessions = sessionStatus ? sessionStatusLine(sessionStatus, theme) : undefined;
    const indicatorLine = indicators.length > 0 ? pillChain(theme, indicators) : "";
    const sessionCounts = sessions && width >= PRIORITY_BREAK.importantOnly ? `${sessions}  ` : "";
    const lines = [
        ...(indicatorLine || sessionCounts
            ? [rightAlign(indicatorLine, sessionCounts, width)]
            : []),
    ];
    lines.push(
        ...entries
            .filter(({ key }) => !statusOrder.includes(key as (typeof statusOrder)[number]))
            .map(({ text }) => text),
    );
    return lines.map((text) => truncateToWidth(text, width, "…"));
}

class StatusFooter implements Component {
    private unsubscribe: () => void;
    private ctx: ExtensionContext;
    private theme: Theme;
    private footerData: FooterData;
    private configRef: { current: PiDevConfig };

    constructor(
        ctx: ExtensionContext,
        theme: Theme,
        footerData: FooterData,
        configRef: { current: PiDevConfig },
        requestRender: () => void,
    ) {
        this.ctx = ctx;
        this.theme = theme;
        this.footerData = footerData;
        this.configRef = configRef;
        this.unsubscribe = footerData.onBranchChange(requestRender);
    }

    invalidate(): void {}

    dispose(): void {
        this.unsubscribe();
    }

    render(width: number): string[] {
        const config = this.configRef.current;
        const footer = buildFooterLine(this.ctx, this.footerData, width, this.theme, config);
        return [
            footer,
            ...extensionStatusLines(
                this.footerData.getExtensionStatuses(),
                width,
                this.theme,
                config,
            ),
        ];
    }
}

export default function registerStatusline(
    pi: ExtensionAPI,
    configRef: { current: PiDevConfig },
): void {
    async function refreshGitStatus(ctx: ExtensionContext): Promise<void> {
        try {
            const { stdout } = await execAsync("git status --porcelain=v1", { cwd: ctx.cwd });
            ctx.ui.setStatus("statusline-git", formatGitStatus(stdout));
        } catch {
            ctx.ui.setStatus("statusline-git", undefined);
        }
    }

    async function runStatusCommand(ctx: ExtensionContext): Promise<void> {
        const command = configRef.current.statusline?.command;
        if (!command) return;
        try {
            const { stdout } = await execAsync(command, { cwd: ctx.cwd });
            const output = stdout.trim();
            ctx.ui.setStatus(
                "pidev-statusline",
                output ? ctx.ui.theme.fg("dim", output) : undefined,
            );
        } catch (error) {
            const message =
                error instanceof Error ? (error.message.split("\n")[0] ?? "error") : "error";
            ctx.ui.setStatus("pidev-statusline", ctx.ui.theme.fg("error", message));
        }
    }

    pi.on("session_start", async (_event, ctx) => {
        ctx.ui.setFooter(
            (tui, theme, footerData) =>
                new StatusFooter(ctx, theme, footerData, configRef, () => tui.requestRender()),
        );
        await Promise.all([runStatusCommand(ctx), refreshGitStatus(ctx)]);
    });

    pi.on("agent_end", async (_event, ctx) => {
        await Promise.all([runStatusCommand(ctx), refreshGitStatus(ctx)]);
    });
}
