import type {
    ExtensionContext,
    ReadonlyFooterDataProvider,
    Theme,
} from "@earendil-works/pi-coding-agent";
import { type Component, type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, test, vi } from "vitest";

import type { PiDevConfig } from "../infra/config.ts";
import registerStatusline, { formatGitStatus } from "./statusline.ts";

type Handler = (event: unknown, ctx: ExtensionContext) => Promise<void> | void;
type FooterFactory = (
    tui: TUI,
    theme: Theme,
    footerData: ReadonlyFooterDataProvider,
) => Component & { dispose?(): void };

const ANSI_BY_FOREGROUND: Record<string, string> = {
    accent: "\x1b[38;5;1m",
    borderAccent: "\x1b[38;5;2m",
    error: "\x1b[38;5;3m",
    mdHeading: "\x1b[38;5;4m",
    muted: "\x1b[38;5;9m",
    toolOutput: "\x1b[38;5;5m",
    warning: "\x1b[38;5;6m",
    success: "\x1b[38;5;7m",
    dim: "\x1b[38;5;8m",
};
const OVERLAY_BACKGROUND = "\x1b[48;2;12;14;20m";
const SURFACE_BACKGROUND = "\x1b[48;2;22;22;30m";
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "gu");

function plain(text: string): string {
    return text.replace(ANSI_PATTERN, "");
}

async function setup(statuses = new Map<string, string>(), config: PiDevConfig = {}) {
    let sessionStart: Handler | undefined;
    let footerFactory: FooterFactory | undefined;
    const getFgAnsi = vi.fn((colour: string) => ANSI_BY_FOREGROUND[colour] ?? "\x1b[38;5;7m");
    const getBgAnsi = vi.fn((colour: string) => {
        if (colour === "customMessageBg") return OVERLAY_BACKGROUND;
        if (colour === "selectedBg") return SURFACE_BACKGROUND;
        return "\x1b[48;5;7m";
    });
    const inverse = vi.fn((text: string) => `\x1b[7m${text}\x1b[27m`);
    const theme = {
        fg: (colour: string, text: string) => `${getFgAnsi(colour)}${text}\x1b[39m`,
        getBgAnsi,
        name: "tokyo-night",
        getColorMode: () => "truecolor",
        getFgAnsi,
        inverse,
    } as unknown as Theme;
    const ctx = {
        cwd: "/repo",
        model: { provider: "test", id: "model", contextWindow: 272_000 },
        getContextUsage: () => ({ tokens: 169_000, contextWindow: 272_000, percent: 62 }),
        sessionManager: {
            getBranch: () => [{ type: "thinking_level_change", thinkingLevel: "high" }],
            getEntries: () => [
                {
                    type: "message",
                    message: {
                        role: "assistant",
                        usage: {
                            input: 270,
                            output: 33_000,
                            cacheRead: 9_300_000,
                            cost: { total: 5.116 },
                        },
                    },
                },
            ],
        },
        ui: {
            theme,
            setFooter(factory: typeof footerFactory) {
                footerFactory = factory;
            },
            setStatus: vi.fn(),
        },
    } as unknown as ExtensionContext;

    registerStatusline(
        {
            on(name: string, handler: Handler) {
                if (name === "session_start") sessionStart = handler;
            },
        } as unknown as Parameters<typeof registerStatusline>[0],
        { current: config },
    );
    await sessionStart?.({}, ctx);
    if (!footerFactory) throw new Error("Status footer was not registered");

    const component = footerFactory({ requestRender: vi.fn() } as unknown as TUI, theme, {
        getGitBranch: () => "main",
        getExtensionStatuses: () => statuses,
        getAvailableProviderCount: () => 1,
        onBranchChange: () => () => {},
    });
    return { component, getBgAnsi, getFgAnsi, inverse };
}

describe("status footer", () => {
    test("groups the model host, model, usage, branch, and project root into pills", async () => {
        const { component, getBgAnsi, getFgAnsi, inverse } = await setup(
            new Map([
                ["routing-profile", "general"],
                ["routing", "routing: base · warm prefix: 4m"],
                ["statusline-git", "+1 󰦒2 -3"],
            ]),
        );
        const line = component.render(200)[0];
        if (!line) throw new Error("Status footer rendered no line");
        const text = plain(line);

        expect(text).toContain(" test  model · high ");
        expect(text).toContain("169k/272k (62%) · ↑270 ↓33k ↺9.3M $5.116 ");
        expect(text).toContain("  main  +1 󰦒2 -3   /repo ");
        expect(text).not.toContain("routing");
        expect(text).not.toContain("[general]");
        expect(visibleWidth(line)).toBe(200);
        expect(line).toContain(
            `${ANSI_BY_FOREGROUND.error}169k${ANSI_BY_FOREGROUND.toolOutput}/272k`,
        );
        expect(line).toContain("\x1b[48;2;187;154;247m\x1b[38;2;26;27;38m test");
        expect(line).toContain(`${OVERLAY_BACKGROUND}${ANSI_BY_FOREGROUND.accent} model · high`);
        expect(getBgAnsi).toHaveBeenCalledWith("customMessageBg");
        expect(getBgAnsi).toHaveBeenCalledWith("selectedBg");
        expect(getFgAnsi).toHaveBeenCalledWith("error");
        expect(inverse).not.toHaveBeenCalled();
    });

    test("collapses first-line details by priority without hiding model, thinking, profile, or usage", async () => {
        const { component } = await setup(
            new Map([
                ["routing-profile", "general"],
                ["routing", "routing: base · warm prefix: 4m"],
                ["statusline-git", "+1 󰦒2 -3"],
                ["session-tracker", "π total 3 · !0 · ?0 · ▶2"],
            ]),
        );

        const less = plain(component.render(117)[0] ?? "");
        expect(less).toContain("test");
        expect(less).toContain("model · high");
        expect(less).not.toContain("");
        expect(less).not.toContain("169k/272k (62%)");
        expect(less).not.toContain("test/model");
        expect(less).toContain(" main");
        expect(less).toContain("+1 󰦒2 -3");
        expect(less).not.toContain("mode: FULL");

        const minimal = plain(component.render(85)[0] ?? "");
        expect(minimal).toContain("test");
        expect(minimal).toContain("model · high");
        expect(minimal).not.toContain("169k/272k (62%)");

        const importantOnly = component.render(53);
        expect(plain(importantOnly[0] ?? "")).not.toContain(" /repo");
        expect(importantOnly).toHaveLength(1);
    });

    test("formats dirty git status like lualine's diff component", () => {
        expect(
            formatGitStatus(" M changed\nA  added\n D deleted\n?? untracked\nR  renamed\n"),
        ).toBe("+2 󰦒2 -1");
        expect(formatGitStatus("")).toBeUndefined();
    });

    test("uses the configured palette for the active theme", async () => {
        const { component, getBgAnsi } = await setup(new Map(), {
            statusline: {
                palettes: {
                    "tokyo-night": {
                        outer: { rgb: [12, 14, 20], ansi256: 233 },
                        inner: { rgb: [22, 22, 30], ansi256: 234 },
                    },
                },
            },
        });
        const line = component.render(100)[0] ?? "";

        expect(line).toContain("\x1b[48;2;12;14;20m");
        expect(line).toContain("\x1b[48;2;22;22;30m");
        expect(getBgAnsi).not.toHaveBeenCalled();
    });

    test("right-aligns tracker sessions without a prefix", async () => {
        const { component } = await setup(
            new Map([["session-tracker", "π total 5 · !0 · ?0 · ▶1"]]),
        );
        const line = component.render(100)[1];
        expect(line ? plain(line).trimStart() : undefined).toBe("1 working · 4 idle  ");
        expect(visibleWidth(line ?? "")).toBe(100);
        expect(line).not.toContain(ANSI_BY_FOREGROUND.mdHeading);
        expect(line).toContain(ANSI_BY_FOREGROUND.success);
        expect(line).toContain(ANSI_BY_FOREGROUND.toolOutput);
        expect(line ? plain(line) : undefined).not.toContain("");
        expect(line ? plain(line) : undefined).not.toContain("");
    });

    test("hides zero session activity categories", async () => {
        const { component } = await setup(
            new Map([["session-tracker", "π total 3 · !0 · ?0 · ▶0"]]),
        );
        expect(plain(component.render(100)[1] ?? "").trimStart()).toBe("3 idle  ");
    });

    test("keeps non-idle attention categories distinct", async () => {
        const { component } = await setup(
            new Map([["session-tracker", "π total 5 · !1 · ?2 · ▶1"]]),
        );
        const line = component.render(100)[1];
        expect(line ? plain(line).trimStart() : undefined).toBe(
            "1 needs permission · 2 need input · 1 working · 1 idle  ",
        );
        expect(line).toContain(ANSI_BY_FOREGROUND.error);
        expect(line).toContain(ANSI_BY_FOREGROUND.warning);
    });

    test("renders permissions and Ponytail in contrasted pills with sessions right-aligned", async () => {
        const { component } = await setup(
            new Map([
                ["ponytail", "  mode: FULL"],
                ["bash-gate-permissions", "󰞀  permissions: guarded"],
                ["routing-profile", "general"],
                ["routing", "routing: base · warm prefix: 4m"],
                ["session-tracker", "π total 3 · !0 · ?0 · ▶2"],
            ]),
        );
        const lines = component.render(200).slice(1);
        expect(plain(lines[0] ?? "")).toContain(
            " 󰞀  permissions: guarded    general: base · warm prefix: 4m    mode: FULL ",
        );
        expect(plain(lines[0] ?? "")).toMatch(/2 working · 1 idle {2}$/u);
        expect(visibleWidth(lines[0] ?? "")).toBe(200);
        expect(lines[0]).toContain(OVERLAY_BACKGROUND);
        expect(lines[0]).toContain(SURFACE_BACKGROUND);
        expect(lines[0]).not.toContain(ANSI_BY_FOREGROUND.accent);
        expect(lines[0]).toContain(ANSI_BY_FOREGROUND.borderAccent);
        expect(lines[0]).toContain(`${ANSI_BY_FOREGROUND.toolOutput}   general: base`);
        expect(lines[0]).toContain(ANSI_BY_FOREGROUND.mdHeading);
    });

    test("hides Ponytail below the widest breakpoint", async () => {
        const { component } = await setup(new Map([["ponytail", "  mode: FULL"]]));
        expect(plain(component.render(118)[1] ?? "")).toContain("mode: FULL");
        expect(component.render(117)).toHaveLength(1);
    });

    test("uses the theme error accent for YOLO permission mode", async () => {
        const { component } = await setup(
            new Map([["bash-gate-permissions", "  permissions: yolo"]]),
        );
        const indicator = component.render(100)[1];
        expect(indicator).toContain(ANSI_BY_FOREGROUND.error);
        expect(indicator ? plain(indicator) : undefined).toBe("   permissions: yolo ");
    });
});
