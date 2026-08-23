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

async function setup(
    statuses = new Map<string, string>(),
    config: PiDevConfig = {},
    sessionName?: string,
) {
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
            getSessionName: () => sessionName,
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
    test("puts session details on the first line and Git details on the second", async () => {
        const { component, getBgAnsi, getFgAnsi, inverse } = await setup(
            new Map([
                ["routing-profile", "general"],
                ["routing", "routing: base · warm prefix: 4m"],
                ["statusline-git", "+1 \u{f0992}2 -3"],
                ["session-tracker", "π total 2 · !0 · ?0 · ▶0"],
            ]),
        );
        const [first, second] = component.render(200);
        if (!first || !second) throw new Error("Status footer rendered too few lines");
        const firstText = plain(first);
        const secondText = plain(second);

        expect(firstText).toContain("\ue0b6 test \ue0b4 model · high \ue0b4");
        expect(firstText).toContain("169k/272k (62%) · ↑270 ↓33k ↺9.3M $5.116 \ue0b4");
        expect(firstText).toContain("\ue0b6 \uf058  0/2 ready \ue0b6 Unnamed session \ue0b4");
        expect(secondText).toContain("\uf418 main +1 \u{f0992}2 -3  \uf141 /repo");
        expect(secondText).not.toContain("\ue0b6 \uf418 main");
        expect(secondText).not.toContain("-3 \ue0b4");
        expect(secondText).not.toContain("\uf141 /repo \ue0b4");
        expect(firstText).not.toContain("routing");
        expect(firstText).not.toContain("[general]");
        expect(visibleWidth(first)).toBe(200);
        expect(visibleWidth(second)).toBe(200);
        expect(first).toContain(
            `${ANSI_BY_FOREGROUND.error}169k${ANSI_BY_FOREGROUND.toolOutput}/272k`,
        );
        expect(first).toContain("\x1b[48;2;187;154;247m\x1b[38;2;26;27;38m test");
        expect(first).toContain(`${OVERLAY_BACKGROUND}${ANSI_BY_FOREGROUND.accent} model · high`);
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
                ["statusline-git", "+1 \u{f0992}2 -3"],
                ["session-tracker", "π total 3 · !0 · ?0 · ▶2"],
            ]),
        );

        const lessLines = component.render(117);
        const less = plain(lessLines[0] ?? "");
        expect(less).toContain("test");
        expect(less).toContain("model · high");
        expect(less).toContain("\ue0b6 \uf192  2/3 working \ue0b6 Unnamed session \ue0b4");
        expect(less).not.toContain("169k/272k (62%)");
        expect(less).not.toContain("test/model");
        expect(plain(lessLines[1] ?? "")).toContain("\uf418 main +1 \u{f0992}2 -3");
        expect(plain(lessLines[1] ?? "")).not.toContain("\ue0b6 \uf418 main");
        expect(less).not.toContain("FULL");

        const minimal = plain(component.render(85)[0] ?? "");
        expect(minimal).toContain("test");
        expect(minimal).toContain("model · high");
        expect(minimal).not.toContain("169k/272k (62%)");

        const importantOnly = component.render(53);
        expect(plain(importantOnly[0] ?? "")).not.toContain("\uf141 /repo");
        expect(importantOnly).toHaveLength(1);
    });

    test("formats dirty git status like lualine's diff component", () => {
        expect(
            formatGitStatus(" M changed\nA  added\n D deleted\n?? untracked\nR  renamed\n"),
        ).toBe("+2 \u{f0992}2 -1");
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
        const lines = component.render(120);

        expect(lines.join("")).toContain("\x1b[48;2;12;14;20m");
        expect(lines.join("")).toContain("\x1b[48;2;22;22;30m");
        expect(getBgAnsi).not.toHaveBeenCalled();
    });

    test("right-aligns compact tracker sessions in a pill", async () => {
        const { component } = await setup(
            new Map([["session-tracker", "π total 5 · !0 · ?0 · ▶1"]]),
        );
        const line = component.render(100)[0];
        expect(line ? plain(line).trim() : undefined).toMatch(
            /\ue0b6 \uf192 {2}1\/5 working \ue0b6 Unnamed session \ue0b4$/u,
        );
        expect(visibleWidth(line ?? "")).toBe(100);
        expect(line).toContain(ANSI_BY_FOREGROUND.accent);
        expect(line).toContain(
            `${ANSI_BY_FOREGROUND.accent}\uf192  ${ANSI_BY_FOREGROUND.toolOutput}1${ANSI_BY_FOREGROUND.dim}/5 ${ANSI_BY_FOREGROUND.accent}working`,
        );
        expect(line).toContain("\x1b[48;");
    });

    test("adds the session name with a Tokyo Night teal foreground", async () => {
        const { component } = await setup(
            new Map([["session-tracker", "π total 5 · !0 · ?0 · ▶1"]]),
            {},
            "Fix session naming",
        );
        const line = component.render(100)[0];

        expect(line ? plain(line).trim() : undefined).toMatch(
            /\ue0b6 \uf192 {2}1\/5 working \ue0b6 Fix session naming \ue0b4$/u,
        );
        expect(line).toContain("\x1b[38;2;115;218;202m Fix session naming");
        expect(line).toContain("\x1b[48;");
        expect(visibleWidth(line ?? "")).toBe(100);
    });

    test.each([
        ["a".repeat(49), "a".repeat(49)],
        ["b".repeat(50), `${"b".repeat(47)}…`],
        ["c".repeat(70), `${"c".repeat(47)}…`],
    ])("truncates session names at 50 characters", async (sessionName, expected) => {
        const { component } = await setup(new Map(), {}, sessionName);
        const line = plain(component.render(220)[0] ?? "");

        expect(line.trim()).toMatch(new RegExp(`\ue0b6 ${expected} \ue0b4$`, "u"));
    });

    test("shows zero active sessions when all tracked sessions are idle", async () => {
        const { component } = await setup(
            new Map([["session-tracker", "π total 3 · !0 · ?0 · ▶0"]]),
        );
        expect(plain(component.render(100)[0] ?? "").trim()).toMatch(
            /\ue0b6 \uf058 {2}0\/3 ready \ue0b6 Unnamed session \ue0b4$/u,
        );
    });

    test.each(["!1 · ?0", "!0 · ?1"])("marks %s waits as attention", async (waits) => {
        const { component } = await setup(
            new Map([["session-tracker", `π total 3 · ${waits} · ▶1`]]),
        );
        const line = component.render(100)[0];
        expect(line ? plain(line).trim() : undefined).toMatch(
            /\ue0b6 \uf28b {2}\(1\) 1\/3 attn \ue0b6 Unnamed session \ue0b4$/u,
        );
        expect(line).toContain(ANSI_BY_FOREGROUND.error);
        expect(line).toContain(
            `${ANSI_BY_FOREGROUND.error}\uf28b  ${ANSI_BY_FOREGROUND.toolOutput}(1) 1${ANSI_BY_FOREGROUND.dim}/3 ${ANSI_BY_FOREGROUND.error}attn`,
        );
    });

    test("combines input and permission waits into the attention state", async () => {
        const { component } = await setup(
            new Map([["session-tracker", "π total 5 · !1 · ?2 · ▶1"]]),
        );
        expect(plain(component.render(100)[0] ?? "").trim()).toMatch(
            /\ue0b6 \uf28b {2}\(3\) 1\/5 attn \ue0b6 Unnamed session \ue0b4$/u,
        );
    });

    test("renders coloured status text with right-aligned Git details", async () => {
        const { component } = await setup(
            new Map([
                ["ponytail", "\ued63 FULL"],
                ["bash-gate-permissions", "\u{f0780} guarded"],
                ["routing-profile", "general"],
                ["routing", "routing: base · warm prefix: 4m"],
                ["session-tracker", "π total 3 · !0 · ?0 · ▶2"],
            ]),
        );
        const lines = component.render(200).slice(1);
        expect(plain(lines[0] ?? "")).toContain(
            "  \u{f0780}   guarded   base(general) · warm prefix: 4m  ",
        );
        expect(plain(lines[0] ?? "")).toMatch(/\ued63 FULL {2}\uf418 main {2}\uf141 \/repo {2}$/u);
        expect(plain(lines[0] ?? "")).not.toContain("\ue0b6 \uf418 main");
        expect(visibleWidth(lines[0] ?? "")).toBe(200);
        expect(lines[0]).not.toContain("\x1b[48;");
        expect(lines[0]).not.toContain(ANSI_BY_FOREGROUND.accent);
        expect(lines[0]).toContain(ANSI_BY_FOREGROUND.borderAccent);
        expect(lines[0]).toContain(`${ANSI_BY_FOREGROUND.toolOutput} base(general)`);
        expect(lines[0]).toContain(ANSI_BY_FOREGROUND.mdHeading);
    });

    test("hides Ponytail below the widest breakpoint", async () => {
        const { component } = await setup(new Map([["ponytail", "\ued63 FULL"]]));
        expect(plain(component.render(118)[1] ?? "")).toContain("FULL");
        const narrow = plain(component.render(117)[1] ?? "");
        expect(narrow).not.toContain("FULL");
        expect(narrow.trim()).toMatch(/\uf418 main {2}\uf141 \/repo$/u);
    });

    test.each(["auto", "guarded", "yolo", "bypass"])(
        "compacts existing %s permission and Ponytail statuses",
        async (mode) => {
            const { component } = await setup(
                new Map([
                    ["bash-gate-permissions", `\uee15 permissions: ${mode}`],
                    ["ponytail", "\ued63 mode: LITE"],
                ]),
            );
            const line = plain(component.render(200)[1] ?? "");
            expect(line).toContain(`\uee15   ${mode === "bypass" ? "yolo" : mode}`);
            expect(line).toContain("\ued63 LITE");
            expect(line).not.toContain("permissions:");
            expect(line).not.toContain("mode:");
        },
    );

    test.each(["graph needs update", "graph rebuild failed"])(
        "does not render a leftover Graphify status: %s",
        async (status) => {
            const { component } = await setup(
                new Map([
                    ["ponytail", "\ued63 FULL"],
                    ["graphify", `\uf1e0  ${status}`],
                ]),
            );
            const lines = component.render(200);
            expect(lines).toHaveLength(2);
            expect(plain(lines[1] ?? "")).toContain("\ued63 FULL");
            expect(lines.map(plain).join("\n")).not.toContain(status);
        },
    );

    test.each([
        [
            new Map([
                ["routing", "routing: base · multi-step task"],
                ["routing-profile", "general"],
            ]),
            "base(general) · multi-step task",
        ],
        [new Map([["routing", "routing: base"]]), "base"],
        [
            new Map([
                ["routing", "routing: base"],
                ["routing-profile", "general"],
            ]),
            "base(general)",
        ],
    ])("formats routing without inventing missing parts", async (statuses, expected) => {
        const { component } = await setup(statuses);
        expect(plain(component.render(200)[1] ?? "")).toContain(`${expected} `);
        expect(plain(component.render(200)[1] ?? "")).not.toContain("undefined");
    });

    test.each(["yolo", "bypass"])(
        "uses the theme error accent for %s permission mode",
        async (mode) => {
            const { component } = await setup(
                new Map([["bash-gate-permissions", `\uee15 ${mode}`]]),
            );
            const indicator = component.render(100)[1];
            expect(indicator).toContain(ANSI_BY_FOREGROUND.error);
            expect(indicator ? plain(indicator).trim() : undefined).toMatch(
                new RegExp(
                    `^\uee15   ${mode === "bypass" ? "yolo" : mode} +\uf418 main  \uf141 /repo$`,
                    "u",
                ),
            );
        },
    );
});
