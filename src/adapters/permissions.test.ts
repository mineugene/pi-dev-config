import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
    ExtensionAPI,
    ExtensionUIContext,
    SessionEntry,
    ToolCallEvent,
    ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import type { PiDevConfig } from "../infra/config.ts";
import registerPermissions, { normalizePermissionOperation } from "./permissions.ts";

describe("normalizePermissionOperation", () => {
    it("normalizes a write inside the working directory", async () => {
        const operation = await normalizePermissionOperation(
            {
                type: "tool_call",
                toolCallId: "write-1",
                toolName: "write",
                input: { path: "src/file.ts", content: "export {};" },
            } as ToolCallEvent,
            "/repo",
        );

        expect(operation).toEqual({
            tool: "write",
            effects: new Set(["write"]),
            resource: "/repo/src/file.ts",
        });
    });

    it("marks writes outside the working directory", async () => {
        const operation = await normalizePermissionOperation(
            {
                type: "tool_call",
                toolCallId: "write-2",
                toolName: "write",
                input: { path: "/tmp/file.ts", content: "export {};" },
            } as ToolCallEvent,
            "/repo",
        );

        expect(operation).toEqual({
            tool: "write",
            effects: new Set(["write", "external-path"]),
            resource: "/tmp/file.ts",
        });
    });

    it("normalizes Bash effects through the existing parser", async () => {
        const operation = await normalizePermissionOperation(
            {
                type: "tool_call",
                toolCallId: "bash-1",
                toolName: "bash",
                input: { command: "git push origin main" },
            } as ToolCallEvent,
            "/repo",
        );

        expect(operation).toEqual({
            tool: "bash",
            effects: new Set(["network", "write", "process"]),
            command: "git push origin main",
        });
    });

    it("normalizes the interactive commit tool as a project write", async () => {
        const operation = await normalizePermissionOperation(
            {
                type: "tool_call",
                toolCallId: "commit-1",
                toolName: "commit",
                input: { subject: "feat: commit through the permission engine" },
            } as ToolCallEvent,
            "/repo",
        );

        expect(operation).toEqual({
            tool: "commit",
            effects: new Set(["write", "process"]),
        });
    });

    it("normalizes reads as read-only operations", async () => {
        const operation = await normalizePermissionOperation(
            {
                type: "tool_call",
                toolCallId: "read-1",
                toolName: "read",
                input: { path: "src/file.ts" },
            } as ToolCallEvent,
            "/repo",
        );

        expect(operation).toEqual({
            tool: "read",
            effects: new Set(["read"]),
            resource: "/repo/src/file.ts",
        });
    });

    it("marks built-in secret paths as credential access", async () => {
        const operation = await normalizePermissionOperation(
            {
                type: "tool_call",
                toolCallId: "read-secret",
                toolName: "read",
                input: { path: ".env" },
            } as ToolCallEvent,
            "/repo",
        );

        expect(operation).toEqual({
            tool: "read",
            effects: new Set(["read", "credential"]),
            resource: "/repo/.env",
        });
    });

    it("marks Bash secret-path access as credential access", async () => {
        const operation = await normalizePermissionOperation(
            {
                type: "tool_call",
                toolCallId: "bash-secret",
                toolName: "bash",
                input: { command: "npm test --userconfig=.npmrc" },
            } as ToolCallEvent,
            "/repo",
        );

        expect(operation).toEqual({
            tool: "bash",
            effects: new Set(["read", "process", "credential"]),
            command: "npm test --userconfig=.npmrc",
        });
    });

    it("normalizes edits as writes", async () => {
        const operation = await normalizePermissionOperation(
            {
                type: "tool_call",
                toolCallId: "edit-1",
                toolName: "edit",
                input: { path: "src/file.ts", edits: [] },
            } as ToolCallEvent,
            "/repo",
        );

        expect(operation).toEqual({
            tool: "edit",
            effects: new Set(["write"]),
            resource: "/repo/src/file.ts",
        });
    });

    it("normalizes file searches as reads", async () => {
        const operation = await normalizePermissionOperation(
            {
                type: "tool_call",
                toolCallId: "grep-1",
                toolName: "grep",
                input: { pattern: "needle", path: "/etc" },
            } as ToolCallEvent,
            "/repo",
        );

        expect(operation).toEqual({
            tool: "grep",
            effects: new Set(["read", "external-path"]),
            resource: "/etc",
        });
    });

    it("normalizes web research as network reads", async () => {
        const operation = await normalizePermissionOperation(
            {
                type: "tool_call",
                toolCallId: "web-1",
                toolName: "web_search",
                input: { query: "permission policies" },
            } as ToolCallEvent,
            "/repo",
        );

        expect(operation).toEqual({
            tool: "web_search",
            effects: new Set(["read", "network"]),
        });
    });

    it("fails conservatively for unsupported PowerShell syntax", async () => {
        const operation = await normalizePermissionOperation(
            {
                type: "tool_call",
                toolCallId: "powershell-1",
                toolName: "powershell",
                input: { command: "Get-ChildItem" },
            } as ToolCallEvent,
            "/repo",
        );

        expect(operation).toEqual({
            tool: "powershell",
            effects: new Set(["process"]),
            command: "Get-ChildItem",
            unknown: true,
        });
    });
});

type PermissionHarnessContext = {
    cwd: string;
    hasUI: boolean;
    ui: Pick<ExtensionUIContext, "notify" | "select" | "setStatus">;
    sessionManager: { getEntries(): SessionEntry[] };
};

type PermissionToolCallHandler = (
    event: ToolCallEvent,
    ctx: PermissionHarnessContext,
) => Promise<ToolCallEventResult | undefined> | ToolCallEventResult | undefined;
type SessionStartHandler = (
    event: { type: "session_start"; reason: "startup" },
    ctx: PermissionHarnessContext,
) => Promise<undefined> | undefined;
type ShortcutHandler = (ctx: PermissionHarnessContext) => Promise<undefined> | undefined;

function approvalRequestId(raw: unknown): string {
    if (
        typeof raw !== "object" ||
        raw === null ||
        !("requestId" in raw) ||
        typeof raw.requestId !== "string"
    ) {
        throw new Error("Expected a permission approval request.");
    }
    return raw.requestId;
}

function subagentEntry(data: Record<string, unknown>): SessionEntry {
    return {
        type: "custom",
        id: "metadata",
        parentId: null,
        timestamp: "now",
        customType: "pi-pidev:subagent",
        data: { type: "Explore", title: "Explore", ...data },
    };
}

function createPermissionsHarness(config: PiDevConfig = {}, entries: SessionEntry[] = []) {
    let currentEntries = entries;
    const handlers = new Map<string, unknown>();
    const eventHandlers = new Map<string, (data: unknown) => void>();
    const emit = vi.fn((event: string, data: unknown): void => {
        eventHandlers.get(event)?.(data);
    });
    let shortcutHandler: ShortcutHandler | undefined;
    const pi = {
        on: vi.fn((event: string, handler: unknown) => handlers.set(event, handler)),
        registerFlag: vi.fn(),
        registerShortcut: vi.fn((_key: string, options: { handler: ShortcutHandler }) => {
            shortcutHandler = options.handler;
        }),
        getFlag: vi.fn(() => false),
        events: {
            emit,
            on: vi.fn((event: string, handler: (data: unknown) => void) => {
                eventHandlers.set(event, handler);
                return () => eventHandlers.delete(event);
            }),
        },
    };
    const select = vi.fn(async () => "Deny");
    const setStatus = vi.fn();
    const ctx: PermissionHarnessContext = {
        cwd: "/repo",
        hasUI: false,
        ui: { notify: vi.fn(), select, setStatus },
        sessionManager: { getEntries: () => currentEntries },
    };

    registerPermissions(pi as unknown as ExtensionAPI, { current: config });
    return {
        ctx,
        eventHandlers,
        pi,
        select,
        setEntries: (next: SessionEntry[]) => {
            currentEntries = next;
        },
        sessionStart: () => {
            void (handlers.get("session_start") as SessionStartHandler | undefined)?.(
                { type: "session_start", reason: "startup" },
                ctx,
            );
        },
        setStatus,
        toggleBypass: () => shortcutHandler?.(ctx),
        toolCall: handlers.get("tool_call") as PermissionToolCallHandler,
    };
}

describe("permission adapter", () => {
    it.each([
        ["guarded", "󰞀  permissions: guarded"],
        ["auto", "  permissions: auto"],
        ["bypass", "  permissions: bypass"],
    ] as const)("projects configured %s mode into permission status", (mode, expected) => {
        const { sessionStart, setStatus } = createPermissionsHarness({ permissions: { mode } });

        sessionStart();

        expect(setStatus).toHaveBeenCalledWith("bash-gate-permissions", expected);
    });

    it("projects --yolo as the bypass status", () => {
        const { pi, sessionStart, setStatus } = createPermissionsHarness();
        pi.getFlag.mockReturnValue(true);

        sessionStart();

        expect(setStatus).toHaveBeenCalledWith("bash-gate-permissions", "  permissions: yolo");
    });

    it("cycles the session permission mode guarded, auto, yolo and resets on session start", async () => {
        const { ctx, sessionStart, setStatus, toggleBypass, toolCall } = createPermissionsHarness({
            permissions: { mode: "guarded" },
        });
        const write = {
            type: "tool_call",
            toolCallId: "write",
            toolName: "write",
            input: { path: "src/file.ts", content: "export {};" },
        } as ToolCallEvent;

        await toggleBypass();
        expect(setStatus).toHaveBeenLastCalledWith("bash-gate-permissions", "  permissions: auto");
        await expect(toolCall({ ...write, toolCallId: "write-1" }, ctx)).resolves.toBeUndefined();

        await toggleBypass();
        expect(setStatus).toHaveBeenLastCalledWith("bash-gate-permissions", "  permissions: yolo");
        await expect(toolCall({ ...write, toolCallId: "write-2" }, ctx)).resolves.toBeUndefined();

        await toggleBypass();
        expect(setStatus).toHaveBeenLastCalledWith(
            "bash-gate-permissions",
            "󰞀  permissions: guarded",
        );

        sessionStart();
        expect(setStatus).toHaveBeenLastCalledWith(
            "bash-gate-permissions",
            "󰞀  permissions: guarded",
        );
        await expect(toolCall({ ...write, toolCallId: "write-3" }, ctx)).resolves.toEqual({
            block: true,
            reason: "Permissions: approval is required, but the current run mode cannot prompt.",
        });
    });

    it("cycles from a configured auto mode to yolo first", async () => {
        const { setStatus, toggleBypass } = createPermissionsHarness({
            permissions: { mode: "auto" },
        });

        await toggleBypass();

        expect(setStatus).toHaveBeenLastCalledWith("bash-gate-permissions", "  permissions: yolo");
    });

    it("cycles out of --yolo with the shortcut", async () => {
        const { ctx, pi, sessionStart, setStatus, toggleBypass, toolCall } =
            createPermissionsHarness({ permissions: { mode: "guarded" } });
        pi.getFlag.mockReturnValue(true);
        sessionStart();
        expect(setStatus).toHaveBeenLastCalledWith("bash-gate-permissions", "  permissions: yolo");

        await toggleBypass();

        expect(setStatus).toHaveBeenLastCalledWith(
            "bash-gate-permissions",
            "󰞀  permissions: guarded",
        );
        await expect(
            toolCall(
                {
                    type: "tool_call",
                    toolCallId: "write-1",
                    toolName: "write",
                    input: { path: "src/file.ts", content: "export {};" },
                } as ToolCallEvent,
                ctx,
            ),
        ).resolves.toEqual({
            block: true,
            reason: "Permissions: approval is required, but the current run mode cannot prompt.",
        });
    });

    it("allows routine project writes in auto mode without a prompt", async () => {
        const { ctx, select, toolCall } = createPermissionsHarness({
            permissions: { mode: "auto" },
        });

        await expect(
            toolCall(
                {
                    type: "tool_call",
                    toolCallId: "write-1",
                    toolName: "write",
                    input: { path: "src/file.ts", content: "export {};" },
                } as ToolCallEvent,
                ctx,
            ),
        ).resolves.toBeUndefined();
        expect(select).not.toHaveBeenCalled();
    });

    it("requires approval for writes outside the working directory in auto mode", async () => {
        const { ctx, toolCall } = createPermissionsHarness({ permissions: { mode: "auto" } });

        await expect(
            toolCall(
                {
                    type: "tool_call",
                    toolCallId: "write-1",
                    toolName: "write",
                    input: { path: "/tmp/file.ts", content: "export {};" },
                } as ToolCallEvent,
                ctx,
            ),
        ).resolves.toEqual({
            block: true,
            reason: "Permissions: approval is required, but the current run mode cannot prompt.",
        });
    });

    it("requires approval for reads outside the working directory in auto mode", async () => {
        const { ctx, toolCall } = createPermissionsHarness({ permissions: { mode: "auto" } });

        await expect(
            toolCall(
                {
                    type: "tool_call",
                    toolCallId: "read-1",
                    toolName: "read",
                    input: { path: "/home/user/notes/a.txt" },
                } as ToolCallEvent,
                ctx,
            ),
        ).resolves.toEqual({
            block: true,
            reason: "Permissions: approval is required, but the current run mode cannot prompt.",
        });
    });

    it("allows read-only Bash redirecting to /dev/null in auto mode", async () => {
        const { ctx, toolCall } = createPermissionsHarness({ permissions: { mode: "auto" } });

        await expect(
            toolCall(
                {
                    type: "tool_call",
                    toolCallId: "bash-1",
                    toolName: "bash",
                    input: {
                        command:
                            'ls docs/agents/; wc -l docs/agents/permissions.md 2>/dev/null; grep -rn "allow" docs/agents/permissions.md 2>/dev/null | head',
                    },
                } as ToolCallEvent,
                ctx,
            ),
        ).resolves.toBeUndefined();
    });

    it("grants the file directory for the session after approving an external read", async () => {
        const externalRoot = mkdtempSync(join(tmpdir(), "test-read-file-"));
        const notes = join(externalRoot, "notes");
        mkdirSync(notes);
        writeFileSync(join(notes, "a.txt"), "");
        try {
            const { ctx, select, toolCall } = createPermissionsHarness({
                permissions: { mode: "auto" },
            });
            ctx.hasUI = true;
            select.mockResolvedValue(`Allow ${notes} for session`);
            const read = (toolCallId: string, path: string) =>
                ({
                    type: "tool_call",
                    toolCallId,
                    toolName: "read",
                    input: { path },
                }) as ToolCallEvent;

            await expect(
                toolCall(read("read-1", join(notes, "a.txt")), ctx),
            ).resolves.toBeUndefined();
            expect(select).toHaveBeenCalledWith(expect.anything(), [
                "Allow once",
                `Allow ${notes} for session`,
                "Deny",
            ]);

            select.mockClear();
            await expect(
                toolCall(read("read-2", join(notes, "b.txt")), ctx),
            ).resolves.toBeUndefined();
            await expect(
                toolCall(read("read-3", join(notes, "lib", "c.txt")), ctx),
            ).resolves.toBeUndefined();
            expect(select).not.toHaveBeenCalled();

            select.mockResolvedValue("Deny");
            await expect(
                toolCall(read("read-4", join(externalRoot, "other.txt")), ctx),
            ).resolves.toEqual({
                block: true,
                reason: "Permissions: operation was denied by the user.",
            });
            await expect(
                toolCall(
                    {
                        type: "tool_call",
                        toolCallId: "write-1",
                        toolName: "write",
                        input: { path: join(notes, "d.txt"), content: "export {};" },
                    } as ToolCallEvent,
                    ctx,
                ),
            ).resolves.toEqual({
                block: true,
                reason: "Permissions: operation was denied by the user.",
            });
        } finally {
            rmSync(externalRoot, { recursive: true, force: true });
        }
    });

    it("grants an external directory itself when approving grep of a directory", async () => {
        const externalDir = mkdtempSync(join(tmpdir(), "test-grep-dir-"));
        try {
            const { ctx, select, toolCall } = createPermissionsHarness({
                permissions: { mode: "auto" },
            });
            ctx.hasUI = true;
            select.mockResolvedValue(`Allow ${externalDir} for session`);

            await expect(
                toolCall(
                    {
                        type: "tool_call",
                        toolCallId: "grep-1",
                        toolName: "grep",
                        input: { pattern: "needle", path: externalDir },
                    } as ToolCallEvent,
                    ctx,
                ),
            ).resolves.toBeUndefined();

            expect(select).toHaveBeenCalledWith(expect.anything(), [
                "Allow once",
                `Allow ${externalDir} for session`,
                "Deny",
            ]);

            select.mockClear();
            await expect(
                toolCall(
                    {
                        type: "tool_call",
                        toolCallId: "grep-2",
                        toolName: "grep",
                        input: { pattern: "needle2", path: externalDir },
                    } as ToolCallEvent,
                    ctx,
                ),
            ).resolves.toBeUndefined();
            expect(select).not.toHaveBeenCalled();
        } finally {
            rmSync(externalDir, { recursive: true, force: true });
        }
    });

    it("keeps an unavailable external read grant scoped to its exact resource", async () => {
        const externalRoot = mkdtempSync(join(tmpdir(), "test-grep-unavailable-"));
        try {
            const unavailable = join(externalRoot, "missing");
            const sibling = join(externalRoot, "sibling");
            const { ctx, select, toolCall } = createPermissionsHarness({
                permissions: { mode: "auto" },
            });
            ctx.hasUI = true;
            select.mockResolvedValue("Allow for session");
            const grep = (toolCallId: string, path: string) =>
                ({
                    type: "tool_call",
                    toolCallId,
                    toolName: "grep",
                    input: { pattern: "needle", path },
                }) as ToolCallEvent;

            await expect(toolCall(grep("grep-1", unavailable), ctx)).resolves.toBeUndefined();
            expect(select).toHaveBeenCalledWith(expect.anything(), [
                "Allow once",
                "Allow for session",
                "Deny",
            ]);

            select.mockClear();
            await expect(toolCall(grep("grep-2", unavailable), ctx)).resolves.toBeUndefined();
            expect(select).not.toHaveBeenCalled();

            select.mockResolvedValue("Deny");
            await expect(toolCall(grep("grep-3", sibling), ctx)).resolves.toEqual({
                block: true,
                reason: "Permissions: operation was denied by the user.",
            });
        } finally {
            rmSync(externalRoot, { recursive: true, force: true });
        }
    });

    it("applies permission policy to the interactive commit tool", async () => {
        const { ctx, toolCall } = createPermissionsHarness({ permissions: { mode: "guarded" } });

        await expect(
            toolCall(
                {
                    type: "tool_call",
                    toolCallId: "commit-1",
                    toolName: "commit",
                    input: { subject: "feat: protect custom commits" },
                } as ToolCallEvent,
                ctx,
            ),
        ).resolves.toEqual({
            block: true,
            reason: "Permissions: approval is required, but the current run mode cannot prompt.",
        });
    });

    it("denies unknown Bash in headless auto mode", async () => {
        const { ctx, toolCall } = createPermissionsHarness({ permissions: { mode: "auto" } });

        await expect(
            toolCall(
                {
                    type: "tool_call",
                    toolCallId: "bash-1",
                    toolName: "bash",
                    input: { command: "acme deploy" },
                } as ToolCallEvent,
                ctx,
            ),
        ).resolves.toEqual({
            block: true,
            reason: "Permissions: approval is required, but the current run mode cannot prompt.",
        });
    });

    it("denies an approval-required operation in headless mode", async () => {
        const { ctx, toolCall } = createPermissionsHarness({ permissions: { mode: "guarded" } });

        await expect(
            toolCall(
                {
                    type: "tool_call",
                    toolCallId: "write-1",
                    toolName: "write",
                    input: { path: "src/file.ts", content: "export {};" },
                } as ToolCallEvent,
                ctx,
            ),
        ).resolves.toEqual({
            block: true,
            reason: "Permissions: approval is required, but the current run mode cannot prompt.",
        });
    });

    it("treats reads under the Pi agent directory as trusted harness configuration", async () => {
        const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
        process.env.PI_CODING_AGENT_DIR = "/home/user/.pi/agent";
        try {
            const { ctx, toolCall } = createPermissionsHarness({ permissions: { mode: "auto" } });

            await expect(
                toolCall(
                    {
                        type: "tool_call",
                        toolCallId: "read-1",
                        toolName: "read",
                        input: { path: "/home/user/.pi/agent/pidev.json" },
                    } as ToolCallEvent,
                    ctx,
                ),
            ).resolves.toBeUndefined();
        } finally {
            if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
            else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
        }
    });

    it("allows once after interactive approval", async () => {
        const { ctx, select, toolCall } = createPermissionsHarness({
            permissions: { mode: "guarded" },
        });
        ctx.hasUI = true;
        select.mockResolvedValue("Allow once");

        await expect(
            toolCall(
                {
                    type: "tool_call",
                    toolCallId: "write-1",
                    toolName: "write",
                    input: { path: "src/file.ts", content: "export {};" },
                } as ToolCallEvent,
                ctx,
            ),
        ).resolves.toBeUndefined();

        expect(select).toHaveBeenCalledWith(expect.stringContaining("Permission required"), [
            "Allow once",
            "Allow for session",
            "Deny",
        ]);
    });

    it("emits legacy Bash wait events while interactive approval is open", async () => {
        const { ctx, pi, select, toolCall } = createPermissionsHarness({
            permissions: { mode: "auto" },
        });
        ctx.hasUI = true;
        select.mockResolvedValue("Allow once");

        await toolCall(
            {
                type: "tool_call",
                toolCallId: "bash-1",
                toolName: "bash",
                input: { command: "rm file" },
            } as ToolCallEvent,
            ctx,
        );

        expect(pi.events.emit).toHaveBeenCalledWith(
            "pidev:bash_gate",
            expect.objectContaining({ cwd: "/repo", command: "rm file", requiresHuman: true }),
        );
        expect(pi.events.emit).toHaveBeenCalledWith(
            "pidev:bash_gate_resolved",
            expect.objectContaining({ cwd: "/repo", command: "rm file", requiresHuman: true }),
        );
    });

    it("keeps a session grant scoped to its approved resource", async () => {
        const { ctx, select, toolCall } = createPermissionsHarness({
            permissions: { mode: "guarded" },
        });
        ctx.hasUI = true;
        select.mockResolvedValueOnce("Allow for session").mockResolvedValueOnce("Deny");

        const first = {
            type: "tool_call",
            toolCallId: "write-1",
            toolName: "write",
            input: { path: "src/one.ts", content: "export {};" },
        } as ToolCallEvent;
        const second = { ...first, toolCallId: "write-2" };
        const other = {
            ...first,
            toolCallId: "write-3",
            input: { path: "src/two.ts", content: "export {};" },
        } as ToolCallEvent;

        await expect(toolCall(first, ctx)).resolves.toBeUndefined();
        await expect(toolCall(second, ctx)).resolves.toBeUndefined();
        await expect(toolCall(other, ctx)).resolves.toEqual({
            block: true,
            reason: "Permissions: operation was denied by the user.",
        });
        expect(select).toHaveBeenCalledTimes(2);
    });

    it("does not share main-agent grants with prompt-policy subagents", async () => {
        const { ctx, eventHandlers, pi, select, setEntries, toolCall } = createPermissionsHarness({
            permissions: { mode: "auto" },
        });
        ctx.hasUI = true;
        select.mockResolvedValueOnce("Allow for session");
        const command = {
            type: "tool_call",
            toolCallId: "bash-main",
            toolName: "bash",
            input: { command: "rm file" },
        } as ToolCallEvent;

        await expect(toolCall(command, ctx)).resolves.toBeUndefined();

        setEntries([subagentEntry({ agentId: "agent-1", bashGatePolicy: "prompt" })]);
        eventHandlers.set("subagents:bash_gate:approval", (raw) => {
            const requestId = approvalRequestId(raw);
            eventHandlers.get(`subagents:bash_gate:approval:ack:${requestId}`)?.({});
            eventHandlers.get(`subagents:bash_gate:approval:reply:${requestId}`)?.({
                decision: "deny",
            });
        });

        await expect(toolCall({ ...command, toolCallId: "bash-child" }, ctx)).resolves.toEqual({
            block: true,
            reason: "Permissions: Bash was denied by parent approval.",
        });
        expect(pi.events.emit).toHaveBeenCalledWith(
            "subagents:bash_gate:approval",
            expect.objectContaining({ agentId: "agent-1" }),
        );
    });

    it("clears session grants at session start", async () => {
        const { ctx, select, sessionStart, toolCall } = createPermissionsHarness({
            permissions: { mode: "guarded" },
        });
        ctx.hasUI = true;
        select.mockResolvedValueOnce("Allow for session").mockResolvedValueOnce("Deny");
        const write = {
            type: "tool_call",
            toolCallId: "write-1",
            toolName: "write",
            input: { path: "src/file.ts", content: "export {};" },
        } as ToolCallEvent;

        await toolCall(write, ctx);
        await toolCall({ ...write, toolCallId: "write-2" }, ctx);
        sessionStart();
        await expect(toolCall({ ...write, toolCallId: "write-3" }, ctx)).resolves.toEqual({
            block: true,
            reason: "Permissions: operation was denied by the user.",
        });
        expect(select).toHaveBeenCalledTimes(2);
    });

    it("maps --yolo to bypass without changing configured policy", async () => {
        const { ctx, pi, sessionStart, toolCall } = createPermissionsHarness({
            permissions: { mode: "guarded" },
        });
        pi.getFlag.mockReturnValue(true);
        sessionStart();

        await expect(
            toolCall(
                {
                    type: "tool_call",
                    toolCallId: "write-1",
                    toolName: "write",
                    input: { path: "src/file.ts", content: "export {};" },
                } as ToolCallEvent,
                ctx,
            ),
        ).resolves.toBeUndefined();
        expect(pi.registerFlag).toHaveBeenCalledWith(
            "yolo",
            expect.objectContaining({ type: "boolean" }),
        );
    });

    it("allows unknown Bash in --yolo mode without prompting", async () => {
        const { ctx, pi, sessionStart, toolCall } = createPermissionsHarness();
        pi.getFlag.mockReturnValue(true);
        sessionStart();

        await expect(
            toolCall(
                {
                    type: "tool_call",
                    toolCallId: "bash-1",
                    toolName: "bash",
                    input: { command: "acme deploy" },
                } as ToolCallEvent,
                ctx,
            ),
        ).resolves.toBeUndefined();
    });

    it("keeps Bash secret-path access denied in bypass when the supplemental guard is off", async () => {
        const { ctx, toolCall } = createPermissionsHarness({
            permissions: { mode: "bypass" },
            secretGuard: { mode: "off" },
        });

        await expect(
            toolCall(
                {
                    type: "tool_call",
                    toolCallId: "bash-secret",
                    toolName: "bash",
                    input: { command: "npm test --userconfig=.npmrc" },
                } as ToolCallEvent,
                ctx,
            ),
        ).resolves.toEqual({
            block: true,
            reason: "Permissions: operation is denied by policy.",
        });
    });

    it("allows ambiguous Bash in --yolo mode without prompting", async () => {
        const { ctx, pi, sessionStart, toolCall } = createPermissionsHarness();
        pi.getFlag.mockReturnValue(true);
        sessionStart();

        await expect(
            toolCall(
                {
                    type: "tool_call",
                    toolCallId: "bash-ambiguous",
                    toolName: "bash",
                    input: { command: "bash -c 'printf ok'" },
                } as ToolCallEvent,
                ctx,
            ),
        ).resolves.toBeUndefined();
    });

    it("keeps credential access denied in bypass even when the supplemental guard is off", async () => {
        const { ctx, toolCall } = createPermissionsHarness({
            permissions: { mode: "bypass" },
            secretGuard: { mode: "off" },
        });

        await expect(
            toolCall(
                {
                    type: "tool_call",
                    toolCallId: "read-secret",
                    toolName: "read",
                    input: { path: ".env" },
                } as ToolCallEvent,
                ctx,
            ),
        ).resolves.toEqual({
            block: true,
            reason: "Permissions: operation is denied by policy.",
        });
    });

    it("keeps catastrophic Bash operations denied in bypass mode", async () => {
        const { ctx, toolCall } = createPermissionsHarness({ permissions: { mode: "bypass" } });

        await expect(
            toolCall(
                {
                    type: "tool_call",
                    toolCallId: "bash-1",
                    toolName: "bash",
                    input: { command: "rm -rf /" },
                } as ToolCallEvent,
                ctx,
            ),
        ).resolves.toEqual({
            block: true,
            reason: "Permissions: Bash operation is denied by safety policy.",
        });
    });

    it("keeps configured Bash restrictions above auto policy", async () => {
        const { ctx, toolCall } = createPermissionsHarness({
            permissions: { mode: "auto" },
            bashGate: { rules: [{ cmd: "pytest", reason: "Runs a protected project check." }] },
        });

        await expect(
            toolCall(
                {
                    type: "tool_call",
                    toolCallId: "bash-1",
                    toolName: "bash",
                    input: { command: "pytest" },
                } as ToolCallEvent,
                ctx,
            ),
        ).resolves.toEqual({
            block: true,
            reason: "Permissions: approval is required, but the current run mode cannot prompt.",
        });
    });

    it("preserves deny-policy subagent isolation for approval-required Bash", async () => {
        const { ctx, toolCall } = createPermissionsHarness({ permissions: { mode: "auto" } }, [
            subagentEntry({ agentId: "agent-1", bashGatePolicy: "deny" }),
        ]);

        await expect(
            toolCall(
                {
                    type: "tool_call",
                    toolCallId: "bash-1",
                    toolName: "bash",
                    input: { command: "rm file" },
                } as ToolCallEvent,
                ctx,
            ),
        ).resolves.toEqual({
            block: true,
            reason: "Permissions: state-changing or ambiguous Bash is not allowed for this subagent.",
        });
    });

    it("does not let --yolo weaken deny-policy subagent isolation", async () => {
        const { ctx, pi, toolCall } = createPermissionsHarness(
            { permissions: { mode: "guarded" } },
            [subagentEntry({ agentId: "agent-1", bashGatePolicy: "deny" })],
        );
        pi.getFlag.mockReturnValue(true);

        await expect(
            toolCall(
                {
                    type: "tool_call",
                    toolCallId: "bash-1",
                    toolName: "bash",
                    input: { command: "rm file" },
                } as ToolCallEvent,
                ctx,
            ),
        ).resolves.toEqual({
            block: true,
            reason: "Permissions: state-changing or ambiguous Bash is not allowed for this subagent.",
        });
    });

    it("brokers approval-required Bash for prompt-policy subagents", async () => {
        const { ctx, eventHandlers, pi, toolCall } = createPermissionsHarness(
            { permissions: { mode: "auto" } },
            [
                subagentEntry({
                    agentId: "agent-1",
                    title: "General",
                    bashGatePolicy: "prompt",
                }),
            ],
        );
        eventHandlers.set("subagents:bash_gate:approval", (raw) => {
            const requestId = approvalRequestId(raw);
            eventHandlers.get(`subagents:bash_gate:approval:ack:${requestId}`)?.({});
            eventHandlers.get(`subagents:bash_gate:approval:reply:${requestId}`)?.({
                decision: "allow",
            });
        });

        await expect(
            toolCall(
                {
                    type: "tool_call",
                    toolCallId: "bash-1",
                    toolName: "bash",
                    input: { command: "rm file" },
                } as ToolCallEvent,
                ctx,
            ),
        ).resolves.toBeUndefined();
        expect(pi.events.emit).toHaveBeenCalledWith(
            "subagents:bash_gate:approval",
            expect.objectContaining({ agentId: "agent-1", title: "General", command: "rm file" }),
        );
    });
});
