/**
 * Shared fff (Fast File Finder) instances.
 *
 * The `@`-mention autocomplete and grep/find tools share native indexes. Content
 * indexing stays on; filesystem watching stays off, so searches rescan a stale
 * index on demand rather than holding native watchers for each root. Frecency
 * and history databases live under the user's durable XDG state directory.
 */

import { createHash } from "node:crypto";
import { mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, parse, resolve } from "node:path";

import { FileFinder, type FileFinderApi } from "@ff-labs/fff-node";

const SCAN_TIMEOUT_MS = 15_000;
const RESCAN_INTERVAL_MS = 2_000;
const MAX_AUX_FINDERS = 4;

type FinderOptions = Parameters<typeof FileFinder.create>[0];
type FinderFactory = (options: FinderOptions) => ReturnType<typeof FileFinder.create>;

type FinderEntry = {
    finder: FileFinderApi;
    lastRefreshAt: number;
    refreshPending?: Promise<void> | undefined;
};

type PendingEntry = {
    promise: Promise<FileFinderApi>;
    finder?: FileFinderApi;
};

/** Resolve aliases for existing roots without rejecting paths which do not exist yet. */
export function canonicalizeFffRoot(root: string): string {
    const resolved = resolve(root);
    try {
        return realpathSync.native(resolved);
    } catch {
        return resolved;
    }
}

/** fff refuses filesystem roots and the user's home directory as index roots. */
export function canUseFffRoot(root: string, home = homedir()): boolean {
    const normalized = canonicalizeFffRoot(root);
    return normalized !== parse(normalized).root && normalized !== canonicalizeFffRoot(home);
}

export function fffStateDirectory(
    stateHome = process.env.XDG_STATE_HOME,
    home = homedir(),
): string {
    const base = stateHome && isAbsolute(stateHome) ? stateHome : join(home, ".local", "state");
    return join(base, "pi-dev-config", "fff");
}

function statePath(root: string, name: string): string {
    const dir = fffStateDirectory();
    mkdirSync(dir, { recursive: true });
    const digest = createHash("sha256").update(root).digest("hex").slice(0, 16);
    return join(dir, `${digest}-${name}.db`);
}

function destroy(finder: FileFinderApi): void {
    if (finder.isDestroyed) return;
    try {
        finder.destroy();
    } catch (error) {
        console.warn("fff: destroy failed", error);
    }
}

/**
 * Owns cached native finders. The workspace finder is retained for the session;
 * at most four least-recently-used auxiliary roots are retained.
 */
export class FffManager {
    private finders = new Map<string, FinderEntry>();
    private pending = new Map<string, PendingEntry>();
    private generation = 0;
    private workspaceRoot: string | undefined;
    private primaryReservations = new Map<symbol, string>();

    constructor(
        private readonly createFinder: FinderFactory = FileFinder.create,
        private readonly now: () => number = Date.now,
        private readonly databasePath: typeof statePath = statePath,
    ) {}

    /** Tear down every finder and invalidate builds already in progress. */
    dispose(): void {
        this.generation++;
        for (const { finder } of this.finders.values()) destroy(finder);
        for (const { finder } of this.pending.values()) {
            if (finder) destroy(finder);
        }
        this.finders.clear();
        this.pending.clear();
        this.workspaceRoot = undefined;
        this.primaryReservations.clear();
    }

    /** Get a finder, optionally refreshing its watcher-free index when stale. */
    async ensure(
        root: string,
        options: { primary?: boolean; refresh?: boolean } = {},
    ): Promise<FileFinderApi> {
        root = canonicalizeFffRoot(root);
        if (!canUseFffRoot(root)) {
            throw new Error(
                "fff cannot index a filesystem root or home directory; use a narrower path",
            );
        }

        const reservation = options.primary ? Symbol(root) : undefined;
        if (reservation) this.primaryReservations.set(reservation, root);
        try {
            let entry = this.finders.get(root);
            if (!entry || entry.finder.isDestroyed) {
                const pending = this.pending.get(root);
                const finder = await (pending?.promise ?? this.build(root));
                entry = this.finders.get(root);
                if (!entry || entry.finder !== finder || finder.isDestroyed) {
                    throw new Error("fff manager disposed during initialisation");
                }
            }
            if (options.primary) this.workspaceRoot = root;
            this.touch(root, entry);
            this.evictAuxiliaries();
            if (options.refresh) await this.refresh(root, entry);
            if (this.finders.get(root) !== entry || entry.finder.isDestroyed) {
                throw new Error("fff finder disposed while being acquired");
            }
            return entry.finder;
        } finally {
            if (reservation) this.primaryReservations.delete(reservation);
        }
    }

    private build(root: string): Promise<FileFinderApi> {
        const generation = this.generation;
        const pending = {} as PendingEntry;
        const operation = (async () => {
            let finder: FileFinderApi | undefined;
            let cached = false;
            try {
                const result = this.createFinder({
                    basePath: root,
                    aiMode: true,
                    frecencyDbPath: this.databasePath(root, "frecency"),
                    historyDbPath: this.databasePath(root, "history"),
                    disableWatch: true,
                });
                if (!result.ok) throw new Error(`fff init failed: ${result.error}`);

                finder = result.value;
                pending.finder = finder;
                const scanned = await finder.waitForScan(SCAN_TIMEOUT_MS);
                if (!scanned.ok || !scanned.value) {
                    throw new Error(
                        `fff initial scan failed: ${scanned.ok ? "timed out" : scanned.error}`,
                    );
                }
                if (generation !== this.generation) {
                    throw new Error("fff manager disposed during initialisation");
                }

                const entry = { finder, lastRefreshAt: this.now() };
                this.finders.set(root, entry);
                this.touch(root, entry);
                this.evictAuxiliaries();
                cached = true;
                return finder;
            } finally {
                if (!cached && finder) destroy(finder);
            }
        })();
        pending.promise = operation.finally(() => {
            if (this.pending.get(root) === pending) this.pending.delete(root);
        });
        this.pending.set(root, pending);
        return pending.promise;
    }

    private async refresh(root: string, entry: FinderEntry): Promise<void> {
        if (this.now() - entry.lastRefreshAt < RESCAN_INTERVAL_MS) return;
        if (entry.refreshPending) return entry.refreshPending;

        const generation = this.generation;
        entry.refreshPending = (async () => {
            if (!entry.finder.isScanning()) {
                const started = entry.finder.scanFiles();
                if (!started.ok) throw new Error(`fff refresh failed: ${started.error}`);
            }
            const scanned = await entry.finder.waitForScan(SCAN_TIMEOUT_MS);
            if (!scanned.ok || !scanned.value) {
                throw new Error(`fff refresh failed: ${scanned.ok ? "timed out" : scanned.error}`);
            }
            if (generation !== this.generation || this.finders.get(root) !== entry) {
                throw new Error("fff manager disposed during refresh");
            }
            entry.lastRefreshAt = this.now();
        })().finally(() => {
            entry.refreshPending = undefined;
        });
        return entry.refreshPending;
    }

    private touch(root: string, entry: FinderEntry): void {
        this.finders.delete(root);
        this.finders.set(root, entry);
    }

    private evictAuxiliaries(): void {
        const primaryRoots = new Set(this.primaryReservations.values());
        if (this.workspaceRoot) primaryRoots.add(this.workspaceRoot);
        while (
            [...this.finders.keys()].filter((root) => !primaryRoots.has(root)).length >
            MAX_AUX_FINDERS
        ) {
            const oldest = [...this.finders.keys()].find((root) => !primaryRoots.has(root));
            if (!oldest) return;
            const entry = this.finders.get(oldest);
            this.finders.delete(oldest);
            if (entry) destroy(entry.finder);
        }
    }
}

/** Process-wide singleton shared by the mention and search extensions. */
export const fff = new FffManager();
