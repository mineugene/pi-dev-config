import type { AgentSession, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentManager, type CompactionInfo } from "../agent-manager.ts";
import type { AgentRecord } from "../types.ts";

vi.mock("../agent-runner.js", () => ({
    runAgent: vi.fn(),
    resumeAgent: vi.fn(),
}));

vi.mock("../worktree.js", () => ({
    createWorktree: vi.fn(),
    cleanupWorktree: vi.fn(() => ({ hasChanges: false })),
    pruneWorktrees: vi.fn(),
}));

import { type RunOptions, resumeAgent, runAgent } from "../agent-runner.ts";

const mockPi = {} as unknown as ExtensionAPI;
const mockCtx = { cwd: "/tmp" } as unknown as ExtensionContext;

const mockSession = (): AgentSession => ({ dispose: vi.fn() }) as unknown as AgentSession;

const resolvedRun = () =>
    vi.mocked(runAgent).mockResolvedValue({
        responseText: "done",
        session: mockSession(),
    });

describe("AgentManager — Bug 1 race condition (resultConsumed vs onComplete)", () => {
    let manager: AgentManager;

    afterEach(() => {
        manager.dispose();
    });

    it("reproduces bug: onComplete fires with resultConsumed=false when set after await", async () => {
        let seenConsumed: boolean | undefined;
        manager = new AgentManager((r) => {
            seenConsumed = r.resultConsumed;
        });
        resolvedRun();

        const id = manager.spawn(mockPi, mockCtx, "general-purpose", "test", {
            description: "test",
            isBackground: true,
        });
        const record = manager.getRecord(id)!;

        // Simulate the buggy get_subagent_result: await THEN mark consumed
        await record.promise;
        record.resultConsumed = true; // too late — onComplete already fired

        // onComplete saw resultConsumed as falsy (undefined) — would queue a notification (the bug)
        expect(seenConsumed).toBeFalsy();
    });

    it("fix: onComplete sees resultConsumed=true when pre-marked before await", async () => {
        let seenConsumed: boolean | undefined;
        manager = new AgentManager((r) => {
            seenConsumed = r.resultConsumed;
        });
        resolvedRun();

        const id = manager.spawn(mockPi, mockCtx, "general-purpose", "test", {
            description: "test",
            isBackground: true,
        });
        const record = manager.getRecord(id)!;

        // The fix: pre-mark BEFORE awaiting
        record.resultConsumed = true;
        await record.promise;

        expect(seenConsumed).toBe(true);
    });

    it("normal case: onComplete fires with resultConsumed falsy when no explicit polling", async () => {
        let completedRecord: AgentRecord | undefined;
        manager = new AgentManager((r) => {
            completedRecord = r;
        });
        resolvedRun();

        const id = manager.spawn(mockPi, mockCtx, "general-purpose", "test", {
            description: "test",
            isBackground: true,
        });
        await manager.getRecord(id)!.promise;

        expect(completedRecord).toBeDefined();
        expect(completedRecord!.resultConsumed).toBeFalsy();
    });

    it("onComplete IS called for foreground agents (lifecycle symmetry)", async () => {
        let completedRecord: AgentRecord | undefined;
        manager = new AgentManager((r) => {
            completedRecord = r;
        });
        resolvedRun();

        const { record } = await manager.spawnAndWait(mockPi, mockCtx, "general-purpose", "test", {
            description: "test",
        });

        expect(completedRecord).toBeDefined();
        expect(completedRecord!.status).toBe("completed");
        // resultConsumed is set by spawnAndWait so onComplete skips notifications
        expect(completedRecord!.resultConsumed).toBe(true);
        expect(record).toBe(completedRecord);
    });
});

describe("AgentManager — spawnAndWait onSpawned + foreground output file wiring (#105)", () => {
    let manager: AgentManager;
    afterEach(() => manager.dispose());

    it("fields set on the record in onSpawned are visible when onSessionCreated fires", async () => {
        // The load-bearing ordering guarantee: onSpawned fires synchronously inside
        // spawn(), before runAgent's async onSessionCreated fires. index.ts relies on
        // this to set record.outputFile so streamToOutputFile can pick it up.
        manager = new AgentManager();
        let capturedId: string | undefined;
        let outputFileSeenAtSessionCreated: string | undefined;

        vi.mocked(runAgent).mockImplementation(async (_ctx, _type, _prompt, opts) => {
            const session = mockSession();
            // Yield one microtask to mirror real behavior: in production, onSessionCreated
            // fires async (after network/session setup). onSpawned fires synchronously
            // inside spawn() before runAgent's promise even starts. This await lets the
            // remainder of startAgent (record.promise = …, onSpawned?.()) finish first.
            await Promise.resolve();
            opts.onSessionCreated?.(session);
            outputFileSeenAtSessionCreated = capturedId
                ? manager.getRecord(capturedId)?.outputFile
                : undefined;
            return { responseText: "done", session };
        });

        await manager.spawnAndWait(
            mockPi,
            mockCtx,
            "general-purpose",
            "test",
            {
                description: "test",
            },
            (fgId) => {
                capturedId = fgId;
                manager.getRecord(fgId)!.outputFile = "/fake/agent.jsonl";
            },
        );

        expect(outputFileSeenAtSessionCreated).toBe("/fake/agent.jsonl");
    });

    it("onSpawned id matches the id returned by spawnAndWait", async () => {
        manager = new AgentManager();
        let spawnedId: string | undefined;
        resolvedRun();

        const { id } = await manager.spawnAndWait(
            mockPi,
            mockCtx,
            "general-purpose",
            "test",
            {
                description: "test",
            },
            (fgId) => {
                spawnedId = fgId;
            },
        );

        expect(spawnedId).toBe(id);
    });

    it("onComplete fires on the error path with resultConsumed=true", async () => {
        // The .then path is covered by the lifecycle-symmetry test above; this guards
        // the .catch path which lacks try/catch around onComplete (a known asymmetry).
        let completedRecord: AgentRecord | undefined;
        manager = new AgentManager((r) => {
            completedRecord = r;
        });
        vi.mocked(runAgent).mockRejectedValue(new Error("agent failed"));

        const { record } = await manager.spawnAndWait(mockPi, mockCtx, "general-purpose", "test", {
            description: "test",
        });

        expect(completedRecord).toBeDefined();
        expect(completedRecord!.status).toBe("error");
        expect(completedRecord!.resultConsumed).toBe(true);
        expect(record).toBe(completedRecord);
    });
});

describe("AgentManager — completion callbacks", () => {
    let manager: AgentManager;

    afterEach(() => {
        manager.dispose();
    });

    it("does not let onComplete errors turn a completed agent into a failed run", async () => {
        manager = new AgentManager(() => {
            throw new Error("stale extension context");
        });
        resolvedRun();

        const id = manager.spawn(mockPi, mockCtx, "general-purpose", "test", {
            description: "test",
            isBackground: true,
        });
        await expect(manager.getRecord(id)!.promise).resolves.toBe("done");

        expect(manager.getRecord(id)!.status).toBe("completed");
    });
});

describe("AgentManager — cleanup timer", () => {
    let manager: AgentManager;

    afterEach(() => {
        manager.dispose();
    });

    it("does not keep the process alive on its own", () => {
        manager = new AgentManager();

        const privateState = manager as unknown as {
            cleanupInterval: { hasRef(): boolean };
        };
        expect(privateState.cleanupInterval.hasRef()).toBe(false);
    });
});

describe("AgentManager — Bug 3 clearCompleted", () => {
    let manager: AgentManager;

    afterEach(() => {
        manager.dispose();
    });

    it("clearCompleted removes completed records", async () => {
        manager = new AgentManager();
        resolvedRun();

        const id = manager.spawn(mockPi, mockCtx, "general-purpose", "test", {
            description: "test",
            isBackground: true,
        });
        await manager.getRecord(id)!.promise;

        expect(manager.listAgents()).toHaveLength(1);
        manager.clearCompleted();
        expect(manager.listAgents()).toHaveLength(0);
    });

    it("clearCompleted does not remove running or queued agents", async () => {
        // Use maxConcurrent=0 to keep agents queued, then spawn one running via foreground
        manager = new AgentManager(undefined, 1);

        // Mock runAgent to never resolve (keeps agent "running")
        vi.mocked(runAgent).mockImplementation(
            () => new Promise(() => {}), // hangs forever
        );

        const id1 = manager.spawn(mockPi, mockCtx, "general-purpose", "test1", {
            description: "running agent",
            isBackground: true,
        });
        // Second agent should be queued (limit=1)
        const id2 = manager.spawn(mockPi, mockCtx, "general-purpose", "test2", {
            description: "queued agent",
            isBackground: true,
        });

        expect(manager.getRecord(id1)!.status).toBe("running");
        expect(manager.getRecord(id2)!.status).toBe("queued");

        manager.clearCompleted();

        // Both should still be present
        expect(manager.getRecord(id1)).toBeDefined();
        expect(manager.getRecord(id2)).toBeDefined();

        // Abort to allow cleanup
        manager.abort(id1);
        manager.abort(id2);
    });

    it("clearCompleted calls dispose on sessions of removed records", async () => {
        manager = new AgentManager();
        const disposeSpy = vi.fn();
        const sess = { dispose: disposeSpy };
        vi.mocked(runAgent).mockResolvedValue({
            responseText: "done",
            session: sess as unknown as AgentSession,
        });

        const id = manager.spawn(mockPi, mockCtx, "general-purpose", "test", {
            description: "test",
            isBackground: true,
        });
        await manager.getRecord(id)!.promise;

        manager.clearCompleted();

        expect(disposeSpy).toHaveBeenCalledOnce();
    });

    it("clearCompleted removes error and stopped records", async () => {
        manager = new AgentManager();
        vi.mocked(runAgent).mockRejectedValue(new Error("boom"));

        const id = manager.spawn(mockPi, mockCtx, "general-purpose", "test", {
            description: "test",
            isBackground: true,
        });
        await manager.getRecord(id)!.promise;
        expect(manager.getRecord(id)!.status).toBe("error");

        manager.clearCompleted();
        expect(manager.getRecord(id)).toBeUndefined();
    });

    it("clearCompleted(true) preserves completed records with resultConsumed=false", async () => {
        manager = new AgentManager();
        resolvedRun();

        const id = manager.spawn(mockPi, mockCtx, "general-purpose", "test", {
            description: "test",
            isBackground: true,
        });
        await manager.getRecord(id)!.promise;
        expect(manager.getRecord(id)!.status).toBe("completed");
        expect(manager.getRecord(id)!.resultConsumed).toBeFalsy();

        manager.clearCompleted(true);
        expect(manager.getRecord(id)).toBeDefined();
    });

    it("clearCompleted(true) removes completed records with resultConsumed=true", async () => {
        manager = new AgentManager();
        resolvedRun();

        const id = manager.spawn(mockPi, mockCtx, "general-purpose", "test", {
            description: "test",
            isBackground: true,
        });
        const record = manager.getRecord(id)!;
        await record.promise;
        record.resultConsumed = true;

        manager.clearCompleted(true);
        expect(manager.getRecord(id)).toBeUndefined();
    });

    it("clearCompleted(true) still removes running=false queued=false records when resultConsumed=false for error status", async () => {
        manager = new AgentManager();
        vi.mocked(runAgent).mockRejectedValue(new Error("boom"));

        const id = manager.spawn(mockPi, mockCtx, "general-purpose", "test", {
            description: "test",
            isBackground: true,
        });
        await manager.getRecord(id)!.promise;
        expect(manager.getRecord(id)!.status).toBe("error");
        expect(manager.getRecord(id)!.resultConsumed).toBeFalsy();

        // Error records with unread results are also preserved — the LLM should
        // be able to read the error message via get_subagent_result before the
        // record is evicted.
        manager.clearCompleted(true);
        expect(manager.getRecord(id)).toBeDefined();
    });
});

// Eager init removes the optional/required asymmetry that previously required
// `??=` defaults at the callback sites and `?? 0` / `?? 1` at the read sites.
describe("AgentManager — lifetime usage + compaction count are eagerly initialized", () => {
    let manager: AgentManager;

    afterEach(() => {
        manager.dispose();
    });

    it("spawn initializes lifetimeUsage to zeros and compactionCount to 0", () => {
        manager = new AgentManager();
        // Don't resolve the run — we just want to inspect the record at spawn time.
        vi.mocked(runAgent).mockImplementation(() => new Promise(() => {}));

        const id = manager.spawn(mockPi, mockCtx, "general-purpose", "test", {
            description: "test",
            isBackground: true,
        });
        const record = manager.getRecord(id)!;

        expect(record.lifetimeUsage).toEqual({ input: 0, output: 0, cacheWrite: 0 });
        expect(record.compactionCount).toBe(0);

        manager.abort(id);
    });

    it("onAssistantUsage from runAgent accumulates into record.lifetimeUsage", async () => {
        manager = new AgentManager();

        // Capture the options passed to runAgent so we can drive callbacks
        let captured: RunOptions | undefined;
        vi.mocked(runAgent).mockImplementation(async (_ctx, _type, _prompt, opts) => {
            captured = opts;
            // Two assistant messages with usage
            opts.onAssistantUsage?.({ input: 100, output: 50, cacheWrite: 10 });
            opts.onAssistantUsage?.({ input: 200, output: 80, cacheWrite: 20 });
            return { responseText: "done", session: mockSession() };
        });

        const id = manager.spawn(mockPi, mockCtx, "general-purpose", "test", {
            description: "test",
            isBackground: true,
        });
        await manager.getRecord(id)!.promise;

        expect(captured).toBeDefined();
        expect(manager.getRecord(id)!.lifetimeUsage).toEqual({
            input: 300,
            output: 130,
            cacheWrite: 30,
        });
    });

    it("onCompaction from runAgent increments record.compactionCount", async () => {
        manager = new AgentManager();
        const compactSeen: Array<{ count: number; reason: CompactionInfo["reason"] }> = [];

        vi.mocked(runAgent).mockImplementation(async (_ctx, _type, _prompt, opts) => {
            // Compaction fires while the agent is still running — the record passed to
            // onCompact should reflect the just-incremented count.
            opts.onCompaction?.({ reason: "threshold", tokensBefore: 12345 });
            opts.onCompaction?.({ reason: "manual", tokensBefore: 22222 });
            return { responseText: "done", session: mockSession() };
        });

        manager = new AgentManager(undefined, undefined, undefined, (record, info) => {
            compactSeen.push({ count: record.compactionCount, reason: info.reason });
        });

        const id = manager.spawn(mockPi, mockCtx, "general-purpose", "test", {
            description: "test",
            isBackground: true,
        });
        await manager.getRecord(id)!.promise;

        expect(compactSeen).toEqual([
            { count: 1, reason: "threshold" },
            { count: 2, reason: "manual" },
        ]);
        expect(manager.getRecord(id)!.compactionCount).toBe(2);
    });

    it("resume() also accumulates usage and increments compactions on the same record", async () => {
        manager = new AgentManager();

        // First, spawn with a session that resume can latch onto
        const session = { ...mockSession() };
        vi.mocked(runAgent).mockResolvedValue({
            responseText: "first",
            session: session as unknown as AgentSession,
        });

        const id = manager.spawn(mockPi, mockCtx, "general-purpose", "test", {
            description: "test",
            isBackground: true,
        });
        await manager.getRecord(id)!.promise;

        // Pre-resume: lifetimeUsage from spawn was zero (mock didn't call onAssistantUsage)
        expect(manager.getRecord(id)!.lifetimeUsage).toEqual({
            input: 0,
            output: 0,
            cacheWrite: 0,
        });
        expect(manager.getRecord(id)!.compactionCount).toBe(0);

        // Now resume — drive callbacks via the mocked resumeAgent
        const { resumeAgent: resumeMock } = await import("../agent-runner.ts");
        vi.mocked(resumeMock).mockImplementation(async (_session, _prompt, opts) => {
            opts?.onAssistantUsage?.({ input: 70, output: 30, cacheWrite: 5 });
            opts?.onCompaction?.({ reason: "overflow", tokensBefore: 999 });
            return "second";
        });

        await manager.resume(id, "more");

        expect(manager.getRecord(id)!.lifetimeUsage).toEqual({
            input: 70,
            output: 30,
            cacheWrite: 5,
        });
        expect(manager.getRecord(id)!.compactionCount).toBe(1);
    });
});

// Regression: `isolation: "worktree"` MUST fail loud when the cwd can't host
// a worktree. The previous behavior silently fell back to the main tree and
// injected a warning into the LLM's prompt — invisible to the caller.
describe("AgentManager — isolation: worktree fails loud, no silent fallback", () => {
    let manager: AgentManager;

    afterEach(() => {
        manager.dispose();
    });

    it("spawn() throws when createWorktree returns undefined; no orphan record left behind", async () => {
        const { createWorktree } = await import("../worktree.ts");
        vi.mocked(createWorktree).mockReturnValueOnce(undefined);
        vi.mocked(runAgent).mockClear();

        manager = new AgentManager();
        expect(() =>
            manager.spawn(mockPi, mockCtx, "general-purpose", "test", {
                description: "test",
                isolation: "worktree",
            }),
        ).toThrow(/isolation: "worktree"/);

        // Cleaned up — no orphan in listAgents()
        expect(manager.listAgents()).toEqual([]);
        // runAgent never invoked — strict, no silent fallback
        expect(runAgent).not.toHaveBeenCalled();
    });

    it("runs and cleans up isolated agents in the worktree root", async () => {
        const { createWorktree, cleanupWorktree } = await import("../worktree.ts");
        vi.mocked(createWorktree).mockReturnValueOnce({
            path: "/wt/copy",
            branch: "pi-agent-x",
            baseSha: "abc",
        });
        resolvedRun();
        manager = new AgentManager();

        const id = manager.spawn(mockPi, mockCtx, "general-purpose", "test", {
            description: "test",
            isolation: "worktree",
        });
        const record = manager.getRecord(id)!;
        await record.promise;

        expect(record.isBackground).toBe(false);
        expect(createWorktree).toHaveBeenCalledWith(mockCtx.cwd, id);
        expect(runAgent).toHaveBeenCalledWith(
            mockCtx,
            "general-purpose",
            "test",
            expect.objectContaining({ cwd: "/wt/copy" }),
        );
        expect(cleanupWorktree).toHaveBeenCalledWith(mockCtx.cwd, expect.anything(), "test");
    });
});

describe("AgentManager — abort() state machine", () => {
    let manager: AgentManager;
    afterEach(() => manager.dispose());

    it("returns false for an unknown id (no record, no side-effects)", () => {
        manager = new AgentManager();
        expect(manager.abort("does-not-exist")).toBe(false);
    });

    it("removes a queued agent from the queue and marks it stopped", () => {
        // Concurrency=1: the second background spawn queues behind the first
        manager = new AgentManager(undefined, 1);
        vi.mocked(runAgent).mockImplementation(() => new Promise(() => {}));

        manager.spawn(mockPi, mockCtx, "X", "blocker", {
            description: "block",
            isBackground: true,
        });
        const queuedId = manager.spawn(mockPi, mockCtx, "Y", "queued", {
            description: "q",
            isBackground: true,
        });
        const queuedRecord = manager.getRecord(queuedId)!;
        expect(queuedRecord.status).toBe("queued");

        expect(manager.abort(queuedId)).toBe(true);
        expect(queuedRecord.status).toBe("stopped");
        expect(queuedRecord.completedAt).toBeGreaterThan(0);
        // Aborting again is a no-op — status is no longer "queued" or "running"
        expect(manager.abort(queuedId)).toBe(false);
    });

    it("aborts a running agent by firing its AbortController and setting status='stopped'", () => {
        manager = new AgentManager();
        let receivedSignal: AbortSignal | undefined;
        vi.mocked(runAgent).mockImplementation((_ctx, _type, _prompt, opts) => {
            receivedSignal = (opts as { signal?: AbortSignal }).signal;
            return new Promise(() => {});
        });

        const id = manager.spawn(mockPi, mockCtx, "X", "p", {
            description: "r",
            isBackground: true,
        });
        const record = manager.getRecord(id)!;
        expect(record.status).toBe("running");
        expect(receivedSignal?.aborted).toBe(false);

        expect(manager.abort(id)).toBe(true);
        expect(record.status).toBe("stopped");
        expect(record.completedAt).toBeGreaterThan(0);
        expect(receivedSignal?.aborted).toBe(true);
    });

    it("returns false (and does not change status) for an already-completed agent", async () => {
        manager = new AgentManager();
        resolvedRun();
        const id = manager.spawn(mockPi, mockCtx, "X", "p", {
            description: "x",
            isBackground: false,
        });
        await manager.getRecord(id)?.promise;
        expect(manager.getRecord(id)?.status).toBe("completed");

        expect(manager.abort(id)).toBe(false);
        expect(manager.getRecord(id)?.status).toBe("completed");
    });

    it("a user abort survives the agent settling — stays 'stopped', never 'completed'", async () => {
        // Guards the `if (record.status !== "stopped")` check in the completion
        // handler: after a user abort, runAgent's promise still settles (here with
        // as a non-cooperative mock would), and must NOT flip the
        // user-stopped status back to "completed" — otherwise the parent agent
        // would read the partial output as a finished result.
        manager = new AgentManager();
        let resolveRun!: (v: unknown) => void;
        vi.mocked(runAgent).mockImplementation(
            () =>
                new Promise((res) => {
                    resolveRun = res as (v: unknown) => void;
                }),
        );

        const id = manager.spawn(mockPi, mockCtx, "X", "p", {
            description: "r",
            isBackground: true,
        });
        const record = manager.getRecord(id)!;
        expect(record.status).toBe("running");

        expect(manager.abort(id)).toBe(true);
        expect(record.status).toBe("stopped");

        // The agent loop ends and the promise settles "normally".
        resolveRun({
            responseText: "partial output",
            session: mockSession(),
        });
        await record.promise;

        expect(record.status).toBe("stopped"); // not overwritten to "completed"
        expect(record.result).toBe("partial output"); // partial result still captured
    });
});

// Regression for #44: ESC during a foreground Agent call must propagate to
// the child. Pi delivers parent abort via AbortSignal; the manager wires the
// signal's "abort" event to this.abort(id).
describe("AgentManager — steer()", () => {
    let manager: AgentManager;
    afterEach(() => manager.dispose());

    it("returns false for an unknown id", () => {
        manager = new AgentManager();
        expect(manager.steer("nope", "hi")).toBe(false);
    });

    it("delivers to a live session via session.steer()", () => {
        manager = new AgentManager();
        const steer = vi.fn(() => Promise.resolve());
        let captured: RunOptions["onSessionCreated"];
        vi.mocked(runAgent).mockImplementation((_ctx, _type, _prompt, opts) => {
            captured = opts.onSessionCreated;
            return new Promise(() => {});
        });
        const id = manager.spawn(mockPi, mockCtx, "X", "p", {
            description: "r",
            isBackground: true,
        });
        // Simulate the session becoming ready.
        captured?.({ steer, dispose: vi.fn(), isStreaming: true } as unknown as AgentSession);

        expect(manager.steer(id, "go left")).toBe(true);
        expect(steer).toHaveBeenCalledWith("go left");
    });

    it("queues onto pendingSteers when the session isn't ready yet", () => {
        manager = new AgentManager();
        vi.mocked(runAgent).mockImplementation(() => new Promise(() => {}));
        const id = manager.spawn(mockPi, mockCtx, "X", "p", {
            description: "r",
            isBackground: true,
        });
        const record = manager.getRecord(id)!;
        record.session = undefined; // not ready

        expect(manager.steer(id, "first")).toBe(true);
        expect(manager.steer(id, "second")).toBe(true);
        expect(record.pendingSteers).toEqual(["first", "second"]);
    });

    it("resumes a completed session with a follow-up prompt", async () => {
        manager = new AgentManager();
        resolvedRun();
        vi.mocked(resumeAgent).mockResolvedValue("again");
        const id = manager.spawn(mockPi, mockCtx, "X", "p", {
            description: "x",
            isBackground: false,
        });
        await manager.getRecord(id)?.promise;
        expect(manager.getRecord(id)?.status).toBe("completed");
        expect(manager.steer(id, "keep going")).toBe(true);
        expect(resumeAgent).toHaveBeenCalledWith(
            expect.anything(),
            "keep going",
            expect.anything(),
        );
    });
});

describe("AgentManager — parent abort signal forwarding (#44)", () => {
    let manager: AgentManager;
    afterEach(() => manager.dispose());

    it("aborts the child when the parent signal aborts", () => {
        manager = new AgentManager();
        vi.mocked(runAgent).mockImplementation(() => new Promise(() => {}));

        const parent = new AbortController();
        const id = manager.spawn(mockPi, mockCtx, "X", "p", {
            description: "x",
            isBackground: false,
            signal: parent.signal,
        });
        const record = manager.getRecord(id)!;
        expect(record.status).toBe("running");

        parent.abort();
        expect(record.status).toBe("stopped");
        expect(record.completedAt).toBeGreaterThan(0);
    });
});

describe("AgentManager — listAgents() ordering", () => {
    let manager: AgentManager;
    afterEach(() => manager.dispose());

    it("returns records sorted by startedAt descending (most recent first)", () => {
        manager = new AgentManager();
        resolvedRun();

        const a = manager.spawn(mockPi, mockCtx, "X", "1", { description: "a" });
        const b = manager.spawn(mockPi, mockCtx, "X", "2", { description: "b" });
        const c = manager.spawn(mockPi, mockCtx, "X", "3", { description: "c" });

        // Force deterministic startedAt — Date.now() can collide on fast runs
        manager.getRecord(a)!.startedAt = 100;
        manager.getRecord(b)!.startedAt = 200;
        manager.getRecord(c)!.startedAt = 300;

        expect(manager.listAgents().map((r) => r.id)).toEqual([c, b, a]);
    });
});

describe("AgentManager — abortAll", () => {
    let manager: AgentManager;
    afterEach(() => manager.dispose());

    it("stops both queued and running agents and returns the total count", () => {
        manager = new AgentManager(undefined, 1);
        vi.mocked(runAgent).mockImplementation(() => new Promise(() => {}));

        const running = manager.spawn(mockPi, mockCtx, "X", "r", {
            description: "r",
            isBackground: true,
        });
        const queued = manager.spawn(mockPi, mockCtx, "Y", "q", {
            description: "q",
            isBackground: true,
        });
        expect(manager.getRecord(running)?.status).toBe("running");
        expect(manager.getRecord(queued)?.status).toBe("queued");

        expect(manager.abortAll()).toBe(2);
        expect(manager.getRecord(running)?.status).toBe("stopped");
        expect(manager.getRecord(queued)?.status).toBe("stopped");
    });

    it("returns 0 when there are no running or queued agents", () => {
        manager = new AgentManager();
        expect(manager.abortAll()).toBe(0);
    });
});

describe("AgentManager — runAgent rejection leaves the record visible with error status", () => {
    let manager: AgentManager;
    afterEach(() => manager.dispose());

    it("sets status='error', captures the error message, and stamps completedAt", async () => {
        manager = new AgentManager();
        vi.mocked(runAgent).mockRejectedValue(new Error("boom"));

        const id = manager.spawn(mockPi, mockCtx, "X", "p", {
            description: "x",
            isBackground: false,
        });
        const record = manager.getRecord(id)!;
        await record.promise;

        expect(record.status).toBe("error");
        expect(record.error).toBe("boom");
        expect(record.completedAt).toBeGreaterThan(0);
    });
});
