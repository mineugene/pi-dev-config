import { mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FileFinder, type FileFinderApi } from "@ff-labs/fff-node";
import { describe, expect, it, vi } from "vitest";
import { canonicalizeFffRoot, canUseFffRoot, FffManager, fffStateDirectory } from "./fff.ts";

type ScanResult = { ok: true; value: boolean } | { ok: false; error: string };

function fakeFinder(
    waitForScan: () => Promise<ScanResult> = async () => ({ ok: true, value: true }),
) {
    let destroyed = false;
    let scanning = false;
    const finder = {
        get isDestroyed() {
            return destroyed;
        },
        destroy: vi.fn(() => {
            destroyed = true;
        }),
        waitForScan: vi.fn(async () => {
            const result = await waitForScan();
            if (result.ok && result.value) scanning = false;
            return result;
        }),
        scanFiles: vi.fn(() => {
            scanning = true;
            return { ok: true, value: undefined };
        }),
        isScanning: vi.fn(() => scanning),
    } as unknown as FileFinderApi;
    return finder;
}

function managerFor(finders: FileFinderApi[], now: () => number = () => 0): FffManager {
    const create = vi.fn(() => {
        const finder = finders.shift();
        if (!finder) throw new Error("unexpected finder creation");
        return { ok: true, value: finder } as ReturnType<typeof FileFinder.create>;
    });
    return new FffManager(create, now, () => "/tmp/fff.db");
}

describe("canUseFffRoot", () => {
    it("rejects filesystem and home roots", () => {
        expect(canUseFffRoot("/", "/home/dev")).toBe(false);
        expect(canUseFffRoot("/home/dev", "/home/dev")).toBe(false);
        expect(canUseFffRoot("/home/dev/project", "/home/dev")).toBe(true);
    });

    it("normalises equivalent non-existent roots", () => {
        expect(canonicalizeFffRoot("/tmp/project/.")).toBe("/tmp/project");
    });

    it("rejects a real home path when home is a symlink", async () => {
        const home = await mkdtemp(join(tmpdir(), "fff-home-"));
        const alias = `${home}-link`;

        try {
            await symlink(home, alias, "dir");
            expect(canUseFffRoot(home, alias)).toBe(false);
        } finally {
            await Promise.all([
                rm(home, { recursive: true, force: true }),
                rm(alias, { force: true }),
            ]);
        }
    });
});

describe("fffStateDirectory", () => {
    it("ignores empty and relative XDG state paths", () => {
        const fallback = "/home/dev/.local/state/pi-dev-config/fff";
        expect(fffStateDirectory("", "/home/dev")).toBe(fallback);
        expect(fffStateDirectory(".", "/home/dev")).toBe(fallback);
        expect(fffStateDirectory("/state", "/home/dev")).toBe("/state/pi-dev-config/fff");
    });
});

describe("FffManager", () => {
    it("reuses one finder for repeated and concurrent requests", async () => {
        const finder = fakeFinder();
        const manager = managerFor([finder]);

        const [first, second] = await Promise.all([
            manager.ensure("/tmp/project"),
            manager.ensure("/tmp/project"),
        ]);
        const third = await manager.ensure("/tmp/project");

        expect(first).toBe(finder);
        expect(second).toBe(finder);
        expect(third).toBe(finder);
        expect(finder.waitForScan).toHaveBeenCalledTimes(1);
    });

    it("reuses one finder through a symlinked root", async () => {
        const root = await mkdtemp(join(tmpdir(), "fff-canonical-"));
        const alias = `${root}-link`;
        const finder = fakeFinder();
        const manager = managerFor([finder]);

        try {
            await symlink(root, alias, "dir");
            await manager.ensure(root);
            await expect(manager.ensure(alias)).resolves.toBe(finder);
            expect(finder.waitForScan).toHaveBeenCalledOnce();
        } finally {
            manager.dispose();
            await Promise.all([
                rm(root, { recursive: true, force: true }),
                rm(alias, { force: true }),
            ]);
        }
    });

    it("destroys and does not cache a finder whose initial scan fails", async () => {
        const finder = fakeFinder(async () => ({ ok: true, value: false }));
        const replacement = fakeFinder();
        const manager = managerFor([finder, replacement]);

        await expect(manager.ensure("/tmp/project")).rejects.toThrow("initial scan failed");
        expect(finder.destroy).toHaveBeenCalledOnce();
        await expect(manager.ensure("/tmp/project")).resolves.toBe(replacement);
    });

    it("does not restore a pending finder after disposal", async () => {
        let finish!: (result: ScanResult) => void;
        const finder = fakeFinder(() => new Promise((resolve) => (finish = resolve)));
        const manager = managerFor([finder]);

        const pending = manager.ensure("/tmp/project");
        manager.dispose();
        expect(finder.destroy).toHaveBeenCalledOnce();
        finish({ ok: true, value: true });

        await expect(pending).rejects.toThrow("disposed during initialisation");
    });

    it("creates a fresh finder after disposal", async () => {
        const first = fakeFinder();
        const second = fakeFinder();
        const manager = managerFor([first, second]);

        await manager.ensure("/tmp/project");
        manager.dispose();
        await expect(manager.ensure("/tmp/project")).resolves.toBe(second);
        expect(first.destroy).toHaveBeenCalledOnce();
    });

    it("creates a fresh finder while a disposed build is still settling", async () => {
        let finish!: (result: ScanResult) => void;
        const first = fakeFinder(() => new Promise((resolve) => (finish = resolve)));
        const second = fakeFinder();
        const manager = managerFor([first, second]);

        const stale = manager.ensure("/tmp/project");
        manager.dispose();
        const fresh = manager.ensure("/tmp/project");
        finish({ ok: true, value: true });

        await expect(stale).rejects.toThrow("disposed during initialisation");
        await expect(fresh).resolves.toBe(second);
    });

    it("rejects a finder disposed during a no-op refresh", async () => {
        const finder = fakeFinder();
        const manager = managerFor([finder]);
        await manager.ensure("/tmp/project");

        const acquiring = manager.ensure("/tmp/project", { refresh: true });
        manager.dispose();

        await expect(acquiring).rejects.toThrow("disposed while being acquired");
    });

    it("evicts the least-recently-used auxiliary finder but keeps the workspace", async () => {
        const workspace = fakeFinder();
        const auxiliaries = Array.from({ length: 5 }, () => fakeFinder());
        const manager = managerFor([workspace, ...auxiliaries]);

        await manager.ensure("/tmp/workspace", { primary: true });
        for (const root of ["a", "b", "c", "d", "e"]) await manager.ensure(`/tmp/${root}`);

        expect(auxiliaries[0]?.destroy).toHaveBeenCalledOnce();
        expect(workspace.destroy).not.toHaveBeenCalled();
    });

    it("keeps the current workspace when a replacement primary fails", async () => {
        const workspace = fakeFinder();
        const auxiliaries = Array.from({ length: 5 }, () => fakeFinder());
        const failed = fakeFinder(async () => ({ ok: true, value: false }));
        const manager = managerFor([
            workspace,
            ...auxiliaries.slice(0, 4),
            failed,
            auxiliaries[4]!,
        ]);

        await manager.ensure("/tmp/workspace", { primary: true });
        for (const root of ["a", "b", "c", "d"]) await manager.ensure(`/tmp/${root}`);
        await expect(manager.ensure("/tmp/replacement", { primary: true })).rejects.toThrow(
            "initial scan failed",
        );
        await manager.ensure("/tmp/e");

        expect(workspace.destroy).not.toHaveBeenCalled();
        expect(auxiliaries[0]?.destroy).toHaveBeenCalledOnce();
    });

    it("reserves a pending primary against concurrent auxiliary eviction", async () => {
        const workspace = fakeFinder();
        const existing = Array.from({ length: 4 }, () => fakeFinder());
        const finishes: Array<(result: ScanResult) => void> = [];
        const pending = Array.from({ length: 5 }, () =>
            fakeFinder(() => new Promise((resolve) => finishes.push(resolve))),
        );
        const manager = managerFor([workspace, ...existing, ...pending]);

        await manager.ensure("/tmp/workspace", { primary: true });
        for (const root of ["a", "b", "c", "d"]) await manager.ensure(`/tmp/${root}`);
        const primary = manager.ensure("/tmp/replacement", { primary: true });
        const auxiliaries = ["e", "f", "g", "h"].map((root) => manager.ensure(`/tmp/${root}`));
        for (const finish of finishes) finish({ ok: true, value: true });

        await expect(primary).resolves.toBe(pending[0]);
        await Promise.all(auxiliaries);
        expect(pending[0]?.destroy).not.toHaveBeenCalled();
    });

    it("rescans stale indexes once before reuse", async () => {
        let time = 0;
        const finder = fakeFinder();
        const manager = managerFor([finder], () => time);

        await manager.ensure("/tmp/project", { refresh: true });
        time = 2_000;
        await Promise.all([
            manager.ensure("/tmp/project", { refresh: true }),
            manager.ensure("/tmp/project", { refresh: true }),
        ]);

        expect(finder.scanFiles).toHaveBeenCalledOnce();
        expect(finder.waitForScan).toHaveBeenCalledTimes(2);
    });

    it("joins a scan still running after a refresh timeout", async () => {
        let time = 0;
        let scans = 0;
        const finder = fakeFinder(async () => ({
            ok: true,
            value: ++scans !== 2,
        }));
        const manager = managerFor([finder], () => time);

        await manager.ensure("/tmp/project");
        time = 2_000;
        await expect(manager.ensure("/tmp/project", { refresh: true })).rejects.toThrow(
            "refresh failed: timed out",
        );
        time = 4_000;
        await manager.ensure("/tmp/project", { refresh: true });

        expect(finder.scanFiles).toHaveBeenCalledOnce();
        expect(finder.waitForScan).toHaveBeenCalledTimes(3);
    });

    it("updates created, renamed, and removed paths after a refresh", async () => {
        const root = await mkdtemp(join(tmpdir(), "fff-root-"));
        const state = await mkdtemp(join(tmpdir(), "fff-state-"));
        let time = 0;
        const manager = new FffManager(
            FileFinder.create,
            () => time,
            (_root, name) => join(state, `${name}.db`),
        );

        try {
            await writeFile(join(root, "old.txt"), "old");
            const finder = await manager.ensure(root, { primary: true, refresh: true });

            await writeFile(join(root, "new.txt"), "new");
            time = 2_000;
            await manager.ensure(root, { refresh: true });
            const created = finder.glob("*.txt");
            expect(created.ok).toBe(true);
            if (created.ok) {
                expect(created.value.items.map((item) => item.relativePath)).toContain("new.txt");
            }

            await rename(join(root, "new.txt"), join(root, "renamed.txt"));
            await rm(join(root, "old.txt"));
            time = 4_000;
            await manager.ensure(root, { refresh: true });
            const paths = finder.glob("*.txt");
            expect(paths.ok).toBe(true);
            if (paths.ok) {
                expect(paths.value.items.map((item) => item.relativePath)).toEqual(["renamed.txt"]);
            }
        } finally {
            manager.dispose();
            await Promise.all([
                rm(root, { recursive: true, force: true }),
                rm(state, { recursive: true, force: true }),
            ]);
        }
    });
});
