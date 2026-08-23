import type {
    BashToolCallEvent,
    ExtensionAPI,
    ExtensionContext,
    ExtensionUIContext,
    SessionEntry,
    SessionStartEvent,
    ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, test, vi } from "vitest";
import { extractBashFacts } from "../../infra/bash-parser.ts";
import type { PiDevConfig } from "../../infra/config.ts";
import { formatPermissionPrompt } from "./events.ts";
import registerBashGate, {
    authorizeBashCommand,
    findMatchedPattern,
    findMatchedPatterns,
    subagentBashGatePolicy,
} from "./index.ts";

describe("extractBashFacts", () => {
    test("extracts commands, redirects, path-ish args, pipe presence, and flags", async () => {
        const facts = await extractBashFacts("git push origin main > out.txt | tee ./log.txt");

        expect(facts.hasPipe).toBe(true);
        expect(facts.commands.map((command) => command.argv)).toEqual([
            ["git", "push", "origin", "main"],
            ["tee", "./log.txt"],
        ]);
        expect(facts.commands[0]?.flags).toEqual([]);
        expect(facts.redirects).toContainEqual({ operator: ">", target: "out.txt" });
        expect(facts.pathCandidates).toContain("./log.txt");
        expect(facts.hasParseError).toBe(false);
    });

    test("extracts command and process substitutions", async () => {
        const facts = await extractBashFacts("printf '%s' \"$(pwd)\" <(git status)");

        expect(facts.constructs).toEqual(["command-substitution", "process-substitution"]);
    });
});

describe("formatPermissionPrompt", () => {
    test("identifies subagent requests without exposing permission data", () => {
        const prompt = formatPermissionPrompt("rm one", ["Deletes files."], "Explore");

        expect(prompt).toBe(
            "Permission required\n\nExplore requests permission to run:\n\n$ rm one\n\nDeletes files.",
        );
        expect(prompt).not.toContain("filesystem.delete.rm");
    });
});

describe("subagentBashGatePolicy", () => {
    test("reads prompt policy and fails invalid or missing policy closed", () => {
        const entry = (data: unknown): SessionEntry => ({
            type: "custom",
            id: "id",
            parentId: null,
            timestamp: "now",
            customType: "pi-pidev:subagent",
            data,
        });

        const metadata = { type: "Explore", title: "Explore" };
        expect(subagentBashGatePolicy([entry({ ...metadata, bashGatePolicy: "prompt" })])).toBe(
            "prompt",
        );
        expect(subagentBashGatePolicy([entry({ ...metadata, bashGatePolicy: "wat" })])).toBe(
            "deny",
        );
        expect(subagentBashGatePolicy([entry(metadata)])).toBe("deny");
    });
});

function subagentEntry(data: Record<string, unknown>): SessionEntry {
    return {
        type: "custom",
        id: "id",
        parentId: null,
        timestamp: "now",
        customType: "pi-pidev:subagent",
        data: { type: "Explore", title: "Explore", ...data },
    };
}

type BashGateHarnessContext = {
    cwd: string;
    hasUI: boolean;
    ui: Pick<ExtensionUIContext, "notify" | "select" | "setStatus">;
    sessionManager: Pick<ExtensionContext["sessionManager"], "getEntries">;
};

type BashGateToolCall = Pick<BashToolCallEvent, "toolName" | "input">;
type BashGateToolCallHandler = (
    event: BashGateToolCall,
    ctx: BashGateHarnessContext,
) => Promise<ToolCallEventResult | undefined> | ToolCallEventResult | undefined;
type SessionStartHandler = (
    event: SessionStartEvent,
    ctx: BashGateHarnessContext,
) => Promise<undefined> | undefined;
type ShortcutHandler = (ctx: BashGateHarnessContext) => Promise<undefined> | undefined;

function approvalRequestId(raw: unknown): string {
    if (
        typeof raw !== "object" ||
        raw === null ||
        !("requestId" in raw) ||
        typeof raw.requestId !== "string"
    ) {
        throw new Error("Expected a bash-gate approval request.");
    }
    return raw.requestId;
}

function createBashGateHarness(entries: SessionEntry[] = [], config: PiDevConfig = {}) {
    const handlers = new Map<string, unknown>();
    const eventHandlers = new Map<string, (data: unknown) => void>();
    const emit = vi.fn((event: string, data: unknown): void => {
        eventHandlers.get(event)?.(data);
    });
    let shortcutHandler: ShortcutHandler | undefined;
    const pi = {
        registerTool: vi.fn(),
        registerFlag: vi.fn(),
        registerShortcut: vi.fn((_key: string, options: { handler: ShortcutHandler }): void => {
            shortcutHandler = options.handler;
        }),
        getFlag: vi.fn<(name: string) => boolean | string | undefined>(() => false),
        on: vi.fn((event: string, handler: unknown): void => {
            handlers.set(event, handler);
        }),
        events: {
            emit,
            on: vi.fn((event: string, handler: (data: unknown) => void) => {
                eventHandlers.set(event, handler);
                return () => eventHandlers.delete(event);
            }),
        },
    };
    const ui = {
        notify: vi.fn<(message: string, type?: "info" | "warning" | "error") => void>(),
        select: vi.fn<(prompt: string, choices: string[]) => Promise<string | undefined>>(
            async () => "Deny",
        ),
        setStatus: vi.fn<(key: string, text: string | undefined) => void>(),
    };
    const ctx: BashGateHarnessContext = {
        cwd: "/repo",
        hasUI: true,
        ui,
        sessionManager: { getEntries: () => entries },
    };

    registerBashGate(pi as unknown as ExtensionAPI, { current: config });
    const sessionStart = (): void => {
        const handler = handlers.get("session_start") as SessionStartHandler | undefined;
        void handler?.({ type: "session_start", reason: "startup" }, ctx);
    };
    sessionStart();

    return {
        pi,
        ctx,
        ui,
        eventHandlers,
        sessionStart,
        toggleYolo: () => shortcutHandler?.(ctx),
        toolCall: handlers.get("tool_call") as BashGateToolCallHandler,
    };
}

describe("bash gate tool_call", () => {
    test("does not override the stock Bash tool renderer", () => {
        const { pi } = createBashGateHarness();

        expect(pi.registerTool).not.toHaveBeenCalled();
    });

    test.each(["rm -rf tmp", "acme deploy"])(
        "auto-denies protected or unknown bash for deny-policy subagents: %s",
        async (command) => {
            const { pi, ui, toolCall, ctx } = createBashGateHarness([
                subagentEntry({ bashGatePolicy: "deny" }),
            ]);

            const result = await toolCall({ toolName: "bash", input: { command } }, ctx);

            expect(result).toEqual({
                block: true,
                reason: "Bash gate: gated command not allowed for this subagent.",
            });
            expect(ui.select).not.toHaveBeenCalled();
            expect(pi.events.emit).not.toHaveBeenCalledWith("pidev:bash_gate", expect.anything());
        },
    );

    test("keeps main-agent gated bash on the approval path", async () => {
        const { pi, ui, toolCall, ctx } = createBashGateHarness();

        await toolCall({ toolName: "bash", input: { command: "rm -rf tmp" } }, ctx);

        expect(ui.select).toHaveBeenCalled();
        expect(pi.events.emit).toHaveBeenCalledWith(
            "pidev:bash_gate",
            expect.objectContaining({
                cwd: "/repo",
                command: "rm -rf tmp",
                source: "protected",
                permissionIds: ["filesystem.delete.rm"],
                requiresHuman: true,
            }),
        );
        expect(pi.events.emit).toHaveBeenCalledWith(
            "pidev:bash_gate_resolved",
            expect.objectContaining({ cwd: "/repo", command: "rm -rf tmp" }),
        );
        expect(ui.select).toHaveBeenCalledWith(
            "Permission required\n\n$ rm -rf tmp\n\nDeletes files or directories.",
            ["Allow once", "Allow similar commands this session", "Deny"],
        );
    });

    test("blocks unknown commands when no permission UI is available", async () => {
        const { toolCall, ctx } = createBashGateHarness();
        ctx.hasUI = false;

        await expect(
            toolCall({ toolName: "bash", input: { command: "acme deploy" } }, ctx),
        ).resolves.toEqual({
            block: true,
            reason: "Bash gate: no UI available for confirmation.",
        });
    });

    test("shortcut toggles the main-agent gate and footer status", async () => {
        const { pi, ui, toggleYolo, toolCall, ctx } = createBashGateHarness();

        await toggleYolo();
        await expect(
            toolCall({ toolName: "bash", input: { command: "rm -rf tmp" } }, ctx),
        ).resolves.toBeUndefined();

        expect(pi.registerShortcut).toHaveBeenCalledWith(
            "ctrl+shift+y",
            expect.objectContaining({ description: expect.any(String) }),
        );
        expect(ui.setStatus).toHaveBeenLastCalledWith(
            "bash-gate-permissions",
            "  permissions: yolo",
        );
        expect(ui.select).not.toHaveBeenCalled();

        await toggleYolo();
        await toolCall({ toolName: "bash", input: { command: "rm -rf tmp" } }, ctx);

        expect(ui.setStatus).toHaveBeenLastCalledWith(
            "bash-gate-permissions",
            "󰞀  permissions: guarded",
        );
        expect(ui.select).toHaveBeenCalled();
    });

    test("the yolo flag bypasses main-agent and subagent enforcement", async () => {
        const { pi, ui, toolCall, ctx } = createBashGateHarness([
            subagentEntry({ bashGatePolicy: "deny" }),
        ]);
        pi.getFlag.mockReturnValue(true);

        await expect(
            toolCall({ toolName: "bash", input: { command: "rm -rf tmp" } }, ctx),
        ).resolves.toBeUndefined();
        expect(ui.select).not.toHaveBeenCalled();
    });

    test("main-agent yolo mode does not bypass subagent gates", async () => {
        const { toggleYolo, toolCall, ctx } = createBashGateHarness([
            subagentEntry({ bashGatePolicy: "deny" }),
        ]);

        await toggleYolo();

        await expect(
            toolCall({ toolName: "bash", input: { command: "rm -rf tmp" } }, ctx),
        ).resolves.toEqual({
            block: true,
            reason: "Bash gate: gated command not allowed for this subagent.",
        });
    });

    test("does not gate safe bash for deny-policy subagents", async () => {
        const { pi, ui, toolCall, ctx } = createBashGateHarness([
            subagentEntry({ bashGatePolicy: "deny" }),
        ]);

        const result = await toolCall({ toolName: "bash", input: { command: "rg foo ." } }, ctx);

        expect(result).toBeUndefined();
        expect(ui.select).not.toHaveBeenCalled();
        expect(pi.events.emit).not.toHaveBeenCalled();
    });

    test("prompt-policy subagents use parent broker and allow once only", async () => {
        const { pi, toolCall, ctx, eventHandlers } = createBashGateHarness([
            subagentEntry({ agentId: "agent-1", title: "Explore", bashGatePolicy: "prompt" }),
        ]);
        let approvals = 0;
        eventHandlers.set("subagents:bash_gate:approval", (raw) => {
            const requestId = approvalRequestId(raw);
            approvals++;
            eventHandlers.get(`subagents:bash_gate:approval:ack:${requestId}`)?.({});
            eventHandlers.get(`subagents:bash_gate:approval:reply:${requestId}`)?.({
                decision: "allow",
            });
        });

        await expect(
            toolCall({ toolName: "bash", input: { command: "rm -rf tmp" } }, ctx),
        ).resolves.toBeUndefined();
        await expect(
            toolCall({ toolName: "bash", input: { command: "rm -rf tmp" } }, ctx),
        ).resolves.toBeUndefined();

        expect(approvals).toBe(2);
        expect(pi.events.emit).toHaveBeenCalledWith(
            "subagents:bash_gate:approval",
            expect.objectContaining({
                title: "Explore",
                command: "rm -rf tmp",
                source: "protected",
                permissionIds: ["filesystem.delete.rm"],
            }),
        );
    });

    test("prompt-policy allow for session is scoped to one subagent session", async () => {
        const entries = [
            subagentEntry({ agentId: "agent-1", title: "Explore", bashGatePolicy: "prompt" }),
        ];
        const { toolCall, ctx, eventHandlers } = createBashGateHarness(entries);
        let approvals = 0;
        eventHandlers.set("subagents:bash_gate:approval", (raw) => {
            const requestId = approvalRequestId(raw);
            approvals++;
            eventHandlers.get(`subagents:bash_gate:approval:ack:${requestId}`)?.({});
            eventHandlers.get(`subagents:bash_gate:approval:reply:${requestId}`)?.({
                decision: "allow-session",
            });
        });

        await toolCall({ toolName: "bash", input: { command: "rm -rf tmp" } }, ctx);
        await toolCall({ toolName: "bash", input: { command: "rm -rf tmp" } }, ctx);
        entries[0] = subagentEntry({
            agentId: "agent-2",
            title: "Explore",
            bashGatePolicy: "prompt",
        });
        await toolCall({ toolName: "bash", input: { command: "rm -rf tmp" } }, ctx);

        expect(approvals).toBe(2);
    });

    test.each(["subagents:completed", "subagents:failed"])(
        "clears scoped allowances on %s",
        async (lifecycleEvent) => {
            const entries = [
                subagentEntry({ agentId: "agent-1", title: "General", bashGatePolicy: "prompt" }),
            ];
            const { pi, toolCall, ctx, eventHandlers } = createBashGateHarness(entries);
            let approvals = 0;
            eventHandlers.set("subagents:bash_gate:approval", (raw) => {
                const requestId = approvalRequestId(raw);
                approvals++;
                eventHandlers.get(`subagents:bash_gate:approval:ack:${requestId}`)?.({});
                eventHandlers.get(`subagents:bash_gate:approval:reply:${requestId}`)?.({
                    decision: "allow-session",
                });
            });

            await toolCall({ toolName: "bash", input: { command: "rm -rf tmp" } }, ctx);
            pi.events.emit(lifecycleEvent, { id: "agent-1" });
            await expect(
                toolCall({ toolName: "bash", input: { command: "rm -rf tmp" } }, ctx),
            ).resolves.toEqual({
                block: true,
                reason: "Bash gate: subagent identity is unavailable or finished.",
            });

            expect(approvals).toBe(1);
        },
    );

    test.each(["allow", "allow-session"])(
        "rejects %s resolved after subagent completion",
        async (decision) => {
            const entries = [
                subagentEntry({ agentId: "agent-1", title: "General", bashGatePolicy: "prompt" }),
            ];
            const { pi, toolCall, ctx, eventHandlers } = createBashGateHarness(entries);
            eventHandlers.set("subagents:bash_gate:approval", (raw) => {
                const requestId = approvalRequestId(raw);
                eventHandlers.get(`subagents:bash_gate:approval:ack:${requestId}`)?.({});
                pi.events.emit("subagents:failed", { id: "agent-1", status: "stopped" });
                eventHandlers.get(`subagents:bash_gate:approval:reply:${requestId}`)?.({
                    decision,
                });
            });

            await expect(
                toolCall({ toolName: "bash", input: { command: "rm -rf tmp" } }, ctx),
            ).resolves.toEqual({
                block: true,
                reason: "Bash gate: subagent finished before approval.",
            });
        },
    );

    test("prompt-policy subagents deny when no broker answers", async () => {
        const { toolCall, ctx } = createBashGateHarness([
            subagentEntry({ agentId: "agent-1", title: "Explore", bashGatePolicy: "prompt" }),
        ]);

        await expect(
            toolCall({ toolName: "bash", input: { command: "rm -rf tmp" } }, ctx),
        ).resolves.toEqual({
            block: true,
            reason: "Bash gate: command was denied by parent approval.",
        });
    });
});

describe("authorization", () => {
    test.each([
        ["find . -name '*.ts'", "prompt", "unknown"],
        ["fd -e ts", "allow", "allowlist"],
        ["fd --exec rm {}", "prompt", "protected"],
        ["rg pattern .", "allow", "allowlist"],
        ["rg --pre rm pattern .", "prompt", "protected"],
        ["rg --hostname-bin=rm pattern .", "prompt", "protected"],
        ["graphify --help", "allow", "allowlist"],
        ["graphify --version", "allow", "allowlist"],
        ["graphify query 'Ponytail runtime state'", "allow", "allowlist"],
        ["graphify explain buildFooterLine", "allow", "allowlist"],
        ["graphify path registerPonytail currentMode", "allow", "allowlist"],
        ["graphify affected registerPonytail", "allow", "allowlist"],
        ["graphify god-nodes --top 5", "allow", "allowlist"],
        ["graphify diagnose multigraph --json", "allow", "allowlist"],
        ["graphify benchmark graphify-out/graph.json", "allow", "allowlist"],
        ["graphify check-update .", "allow", "allowlist"],
        ["graphify update .", "allow", "allowlist"],
        ["graphify cluster-only . --no-label", "allow", "allowlist"],
        ["graphify hook status", "allow", "allowlist"],
        ["graphify global list", "allow", "allowlist"],
        ["graphify global path", "allow", "allowlist"],
        ["graphify .", "prompt", "unknown"],
        ["graphify extract .", "prompt", "unknown"],
        ["graphify label .", "prompt", "unknown"],
        ["graphify cluster-only .", "prompt", "unknown"],
        ["graphify watch .", "prompt", "unknown"],
        ["graphify hook install", "prompt", "unknown"],
        ["/usr/bin/rg pattern .", "prompt", "unknown"],
        ["/bin/rm old", "prompt", "protected"],
        ["PATH=./bin rg pattern .", "prompt", "protected"],
        ["tool=rg; $tool pattern .", "prompt", "protected"],
        ["find . -delete", "prompt", "protected"],
        ["sort names.txt", "allow", "allowlist"],
        ["sort names.txt -o names.txt", "prompt", "protected"],
        ["sort -nro names.txt input.txt", "prompt", "protected"],
        ["git status", "allow", "allowlist"],
        ["git add src/domain/bash.ts", "allow", "allowlist"],
        ["git commit -m test", "allow", "allowlist"],
        ["git commit --amend", "prompt", "protected"],
        ["git push", "prompt", "protected"],
        ["gh pr view 42", "allow", "allowlist"],
        ["gh pr merge 42", "prompt", "protected"],
        ["docker ps", "allow", "allowlist"],
        ["docker rm old", "prompt", "protected"],
        ["kubectl get pods", "allow", "allowlist"],
        ["kubectl delete pod old", "prompt", "protected"],
        ["git status && pytest", "allow", "allowlist"],
        ["npx vitest run src/domain/bash.test.ts", "allow", "allowlist"],
        ["npx untrusted-package", "prompt", "unknown"],
        ["npm run check", "allow", "allowlist"],
        ["npm run lint -- --fix", "prompt", "protected"],
        ["npm test -- -u", "prompt", "protected"],
        ["ruff check --fix", "prompt", "protected"],
        ["git status && rm foo", "prompt", "protected"],
        ["pytest || echo failed", "allow", "allowlist"],
        ["unknown-tool foo && git status", "prompt", "unknown"],
        ["echo foo > result.txt", "prompt", "protected"],
        ["echo foo >& result.txt", "prompt", "protected"],
        ["echo foo 2>&1", "allow", "allowlist"],
        ["printf '%s' \"$(pwd)\"", "prompt", "protected"],
        ["cat <<'EOF'\nhello\nEOF", "prompt", "protected"],
        ["cat <<< hello", "allow", "allowlist"],
    ])("classifies %s", async (command, decision, source) => {
        await expect(authorizeBashCommand(command)).resolves.toMatchObject({ decision, source });
    });

    test("prompts unknown commands without exposing authorization identifiers", async () => {
        const { pi, ui, toolCall, ctx } = createBashGateHarness();

        await toolCall({ toolName: "bash", input: { command: "acme deploy preview" } }, ctx);

        const [prompt, choices] = ui.select.mock.calls[0] ?? [];
        expect(prompt).toBe(
            "Permission required\n\n$ acme deploy preview\n\nThis command is not in the routine command allowlist.",
        );
        expect(choices).toEqual(["Allow once", "Allow similar commands this session", "Deny"]);
        expect(prompt).not.toContain("command.unknown");
        expect(prompt).not.toContain("protected rule");
        expect(pi.events.emit).toHaveBeenCalledWith(
            "pidev:bash_gate",
            expect.objectContaining({ source: "unknown", permissionIds: [], requiresHuman: true }),
        );
    });

    test("allow once prompts again while session approval uses a narrow protected scope", async () => {
        const { ui, toolCall, ctx } = createBashGateHarness();
        ui.select
            .mockResolvedValueOnce("Allow once")
            .mockResolvedValueOnce("Allow similar commands this session");

        await toolCall({ toolName: "bash", input: { command: "rm one" } }, ctx);
        await toolCall({ toolName: "bash", input: { command: "rm two" } }, ctx);
        await toolCall({ toolName: "bash", input: { command: "rm three" } }, ctx);
        await toolCall({ toolName: "bash", input: { command: "git push origin main" } }, ctx);

        expect(ui.select).toHaveBeenCalledTimes(3);
    });

    test("grouped command families keep separate session permissions", async () => {
        const { ui, toolCall, ctx } = createBashGateHarness();
        ui.select.mockResolvedValue("Allow similar commands this session");

        await toolCall({ toolName: "bash", input: { command: "chmod 600 one" } }, ctx);
        await toolCall({ toolName: "bash", input: { command: "chown user one" } }, ctx);
        await toolCall({ toolName: "bash", input: { command: "kill 123" } }, ctx);
        await toolCall({ toolName: "bash", input: { command: "killall worker" } }, ctx);

        expect(ui.select).toHaveBeenCalledTimes(4);
    });

    test("session approval distinguishes materially different Git reset modes", async () => {
        const { ui, toolCall, ctx } = createBashGateHarness();
        ui.select.mockResolvedValue("Allow similar commands this session");

        await toolCall({ toolName: "bash", input: { command: "git reset --soft HEAD~1" } }, ctx);
        await toolCall({ toolName: "bash", input: { command: "git reset --hard HEAD~1" } }, ctx);

        expect(ui.select).toHaveBeenCalledTimes(2);
    });

    test("write-redirection approval stays scoped to the producing command", async () => {
        const { ui, toolCall, ctx } = createBashGateHarness();
        ui.select.mockResolvedValueOnce("Allow similar commands this session");

        await toolCall({ toolName: "bash", input: { command: "echo one > first.txt" } }, ctx);
        await toolCall({ toolName: "bash", input: { command: "echo two > second.txt" } }, ctx);
        await toolCall({ toolName: "bash", input: { command: "cat input > output.txt" } }, ctx);

        expect(ui.select).toHaveBeenCalledTimes(2);
    });

    test("dynamic-command approval stays scoped to its command arguments", async () => {
        const { ui, toolCall, ctx } = createBashGateHarness();
        ui.select.mockResolvedValueOnce("Allow similar commands this session");

        await toolCall({ toolName: "bash", input: { command: "bash -c 'printf one'" } }, ctx);
        await toolCall({ toolName: "bash", input: { command: "bash -c 'printf two'" } }, ctx);

        expect(ui.select).toHaveBeenCalledTimes(2);
    });

    test("protected session approval does not authorize unknown compound parts", async () => {
        const { ui, toolCall, ctx } = createBashGateHarness();
        ui.select.mockResolvedValueOnce("Allow similar commands this session");

        await toolCall({ toolName: "bash", input: { command: "rm one" } }, ctx);
        await toolCall({ toolName: "bash", input: { command: "rm two && acme deploy" } }, ctx);

        expect(ui.select).toHaveBeenCalledTimes(2);
    });

    test("unknown session approval covers the same command family only", async () => {
        const { ui, toolCall, ctx } = createBashGateHarness();
        ui.select.mockResolvedValueOnce("Allow similar commands this session");

        await toolCall({ toolName: "bash", input: { command: "acme deploy preview" } }, ctx);
        await toolCall({ toolName: "bash", input: { command: "acme deploy production" } }, ctx);
        await toolCall({ toolName: "bash", input: { command: "acme destroy production" } }, ctx);

        expect(ui.select).toHaveBeenCalledTimes(2);
    });

    test("configured protection overrides the built-in allowlist", async () => {
        const { ui, toolCall, ctx } = createBashGateHarness([], {
            bashGate: {
                rules: [{ cmd: "pytest", reason: "Runs a protected project check." }],
            },
        });

        await toolCall({ toolName: "bash", input: { command: "pytest" } }, ctx);

        expect(ui.select).toHaveBeenCalledWith(
            "Permission required\n\n$ pytest\n\nRuns a protected project check.",
            expect.any(Array),
        );
    });

    test("session start clears session approvals", async () => {
        const { ui, toolCall, ctx, sessionStart } = createBashGateHarness();
        ui.select.mockResolvedValue("Allow similar commands this session");

        await toolCall({ toolName: "bash", input: { command: "rm one" } }, ctx);
        await toolCall({ toolName: "bash", input: { command: "rm two" } }, ctx);
        sessionStart();
        await toolCall({ toolName: "bash", input: { command: "rm three" } }, ctx);

        expect(ui.select).toHaveBeenCalledTimes(2);
    });
});

describe("findMatchedPattern", () => {
    test.each([
        "rg foo . 2>&1",
        "rg foo . 1>&2",
        "rg foo . 2>/dev/null",
        "rg foo . >/dev/null",
        "rg foo . >>/dev/null",
        "make build >/dev/null 2>&1",
        "python3 scripts/planner.py lisst --mode all | rg 'block-big-tables|sync-servers-code-refactor' -n -C 2",
        "printf '%s\n' code-refactor",
    ])("does not protect safe redirect case: %s", async (command: string) => {
        expect(await findMatchedPattern(command)).toBeUndefined();
    });

    test.each([
        ["echo hi > out.txt", "redirect:>"],
        ["echo hi >& out.txt", "redirect:>"],
        ["cat < in.txt > out.txt", "redirect:>"],
        ["make build >/tmp/build.log 2>&1", "redirect:>"],
        ["echo hi >> out.txt", "redirect:>>"],
        ["rm -rf tmp", "rm"],
        ["git push origin main", "git push"],
        ["git branch -D old-branch", "git branch -d"],
        ["bun add zod", "bun add"],
        ["service nginx restart", "service restart"],
    ])("matches a destructive pattern for: %s", async (command: string, label: string) => {
        const matched = await findMatchedPattern(command);

        expect(matched).toBeDefined();
        expect(matched?.label).toBe(label);
    });

    test("matches every gated command in a compound command", async () => {
        const matches = await findMatchedPatterns("chmod +x foo && rm bar");

        expect(matches.map((match) => match.label)).toEqual(
            expect.arrayContaining(["chmod", "rm"]),
        );
    });

    test("matches every gated command separated by semicolons", async () => {
        const matches = await findMatchedPatterns("rmdir a; rm b");

        expect(matches.map((match) => match.label)).toEqual(["rmdir", "rm"]);
    });

    test("supports configured command-only rules", async () => {
        const matched = await findMatchedPattern("pytest -q", {
            bashGate: { rules: [{ cmd: "pytest" }] },
        });

        expect(matched?.label).toBe("pytest");
        expect(matched?.source).toBe("configured");
    });

    test("supports configured subcommand rules", async () => {
        const matched = await findMatchedPattern("git push origin main", {
            bashGate: {
                rules: [{ cmd: "git", subcommands: ["push"], reason: "push mutates remote state" }],
            },
        });

        expect(matched?.label).toBe("git push");
        expect(matched?.reason).toBe("push mutates remote state");
    });

    test("supports configured flagAny rules", async () => {
        const matched = await findMatchedPattern("sed -i 's/a/b/' file.txt", {
            bashGate: { rules: [{ cmd: "sed", flagAny: ["-i"] }] },
        });

        expect(matched?.label).toBe("sed -i");
        expect(matched?.source).toBe("configured");
    });

    test("supports configured redirect rules", async () => {
        const matched = await findMatchedPattern("echo hi >> out.txt", {
            bashGate: { rules: [{ redirects: "append" }] },
        });

        expect(matched?.label).toBe("redirect:>>");
        expect(matched?.source).toBe("configured");
    });

    test("configured rules extend builtin defaults", async () => {
        const builtinMatch = await findMatchedPattern("git push origin main", {
            bashGate: { rules: [{ cmd: "sed", flagAny: ["-i"] }] },
        });
        const configuredMatch = await findMatchedPattern("sed -i 's/a/b/' file.txt", {
            bashGate: { rules: [{ cmd: "sed", flagAny: ["-i"] }] },
        });

        expect(builtinMatch?.label).toBe("git push");
        expect(builtinMatch?.source).toBe("builtin");
        expect(configuredMatch?.label).toBe("sed -i");
        expect(configuredMatch?.source).toBe("configured");
    });
});
