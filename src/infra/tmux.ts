import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { type AgentPaneState, isAgentPaneState } from "../domain/session-tracker.ts";

const execFileAsync = promisify(execFile);

export type TmuxExec = (args: readonly string[]) => Promise<string>;

export interface PaneMetadata {
    runtimeId: string;
    sessionId?: string;
    cwd: string;
    state: AgentPaneState;
    title?: string;
    role?: string;
    group?: string;
    parentPaneId?: string;
}

const OPTION_FIELDS = {
    "@pidev_runtime": "runtimeId",
    "@pidev_session": "sessionId",
    "@pidev_cwd": "cwd",
    "@pidev_state": "state",
    "@pidev_title": "title",
    "@pidev_role": "role",
    "@pidev_group": "group",
    "@pidev_parent": "parentPaneId",
} as const;

const OWNED_OPTIONS = ["@pidev_agent", ...Object.keys(OPTION_FIELDS)] as const;

async function defaultExec(args: readonly string[]): Promise<string> {
    const { stdout } = await execFileAsync("tmux", [...args], { encoding: "utf8" });
    return String(stdout);
}

function oneLine(output: string): string {
    return output.replace(/\r?\n$/u, "");
}

export function createTmux(exec: TmuxExec = defaultExec) {
    async function option(paneId: string, name: string): Promise<string | undefined> {
        try {
            const value = oneLine(await exec(["show-options", "-pqv", "-t", paneId, name]));
            return value || undefined;
        } catch {
            return undefined;
        }
    }

    async function listPaneIds(): Promise<Set<string>> {
        const output = await exec(["list-panes", "-a", "-F", "#{pane_id}"]);
        return new Set(output.split(/\r?\n/u).filter((paneId) => paneId.startsWith("%")));
    }

    async function setPaneMetadata(paneId: string, metadata: PaneMetadata): Promise<void> {
        const values: Record<string, string | undefined> = {
            "@pidev_agent": "1",
            "@pidev_runtime": metadata.runtimeId,
            "@pidev_session": metadata.sessionId,
            "@pidev_cwd": metadata.cwd,
            "@pidev_state": metadata.state,
            "@pidev_title": metadata.title,
            "@pidev_role": metadata.role,
            "@pidev_group": metadata.group,
            "@pidev_parent": metadata.parentPaneId,
        };
        await Promise.all(
            Object.entries(values).map(([name, value]) =>
                value === undefined
                    ? exec(["set-option", "-pu", "-t", paneId, name])
                    : exec(["set-option", "-p", "-t", paneId, name, value]),
            ),
        );
    }

    async function readPaneMetadata(paneId: string): Promise<PaneMetadata | undefined> {
        const names = ["@pidev_agent", ...Object.keys(OPTION_FIELDS)];
        const values = await Promise.all(names.map((name) => option(paneId, name)));
        if (values[0] !== "1") return undefined;
        const metadata: Partial<
            Record<(typeof OPTION_FIELDS)[keyof typeof OPTION_FIELDS], string>
        > = {};
        for (const [index, name] of Object.keys(OPTION_FIELDS).entries()) {
            const value = values[index + 1];
            if (value !== undefined)
                metadata[OPTION_FIELDS[name as keyof typeof OPTION_FIELDS]] = value;
        }
        if (!metadata.runtimeId || !metadata.cwd || !isAgentPaneState(metadata.state)) {
            return undefined;
        }
        return metadata as PaneMetadata;
    }

    async function clearPaneMetadata(paneId: string, runtimeId: string): Promise<boolean> {
        if ((await option(paneId, "@pidev_runtime")) !== runtimeId) return false;
        await Promise.all(
            OWNED_OPTIONS.map((name) => exec(["set-option", "-pu", "-t", paneId, name])),
        );
        return true;
    }

    async function readAllPaneMetadata(): Promise<
        Array<{ paneId: string; metadata: PaneMetadata }>
    > {
        const paneIds = await listPaneIds();
        const records = await Promise.all(
            [...paneIds].map(async (paneId) => ({
                paneId,
                metadata: await readPaneMetadata(paneId),
            })),
        );
        return records.flatMap(({ paneId, metadata }) => (metadata ? [{ paneId, metadata }] : []));
    }

    async function focusPane(paneId: string, targetClient?: string): Promise<boolean> {
        if (!(await listPaneIds()).has(paneId)) return false;
        const clientArgs = targetClient ? ["-c", targetClient] : [];
        await exec(["switch-client", ...clientArgs, "-t", paneId]);
        return true;
    }

    async function currentClient(): Promise<string | undefined> {
        try {
            return oneLine(await exec(["display-message", "-p", "#{client_name}"])) || undefined;
        } catch {
            return undefined;
        }
    }

    return {
        clearPaneMetadata,
        currentClient,
        focusPane,
        listPaneIds,
        readAllPaneMetadata,
        readPaneMetadata,
        setPaneMetadata,
    };
}

export type Tmux = ReturnType<typeof createTmux>;
