/**
 * pi-dev-config settings loader.
 *
 * Reads `pidev.json` from two places and merges them, with the project file
 * overriding the global one:
 *
 *   - Global:  $PI_CODING_AGENT_DIR/pidev.json  (default ~/.pi/agent/pidev.json)
 *   - Project: <cwd>/<CONFIG_DIR_NAME>/pidev.json  (default <cwd>/.pi/pidev.json)
 *
 * Every field is optional; a missing or malformed file is treated as empty so a
 * typo never takes the harness down. The merge is generic (see `mergeObjects`):
 * adding a feature extends `PiDevConfig` below and needs no change to the merge.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

import type { BashGateConfig } from "../domain/bash.ts";

export const NOTIFICATION_MODES = ["off", "bell", "desktop", "both"] as const;
export type NotificationMode = (typeof NOTIFICATION_MODES)[number];

export type RoutingThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface RoutingModelConfig {
    /** Existing models.json id, or provider/id when the id is ambiguous. */
    model: string;
    /** Effort used while this model handles routed turns. */
    thinkingLevel?: RoutingThinkingLevel;
}

export type RoutingModelSetting = string | RoutingModelConfig;

export interface RoutingPreset {
    /** Baseline model restored by /routing-auto. */
    base: RoutingModelSetting;
    /** Cheap first-pass model. */
    fast?: RoutingModelSetting;
    /** Deep escalation model. */
    deep?: RoutingModelSetting;
}

export interface RoutingConfig {
    /** Named model sets available through /routing-preset. */
    presets?: Record<string, RoutingPreset>;
    /** Preset activated when a session starts. */
    defaultPreset?: string;
    /** Legacy baseline model. Defaults to pi's session model. */
    base?: RoutingModelSetting;
    /** Legacy cheap first-pass model. */
    fast?: RoutingModelSetting;
    /** Legacy deep escalation model. */
    deep?: RoutingModelSetting;
    /** Consecutive failed base turns before deep escalation. Default 2. */
    failureThreshold?: number;
    /** User correction requests within one task before deep escalation. Default 2. */
    correctionThreshold?: number;
    /**
     * Hold a warm higher-tier model this many minutes before de-escalating. 0 disables.
     * Default 5; PI_CACHE_RETENTION=long uses 24h for OpenAI and 1h for Anthropic.
     */
    cacheTtlMinutes?: number;
}

export function defaultRoutingModelSetting(
    config: RoutingConfig | undefined,
    role: keyof RoutingPreset,
): RoutingModelSetting | undefined {
    const name = config?.defaultPreset?.trim();
    const preset = name ? config?.presets?.[name] : undefined;
    return preset ? preset[role] : config?.[role];
}

/** Extract a configured model id, accepting the compact string form. */
export function routingModelId(setting: RoutingModelSetting | undefined): string | undefined {
    const model = typeof setting === "string" ? setting : setting?.model;
    const trimmed = model?.trim();
    return trimmed || undefined;
}

export interface PiDevConfig {
    /** Extension names to skip; see the registry (adapters/registry.ts) for the valid set. */
    disable?: string[];
    /** Modal vim editor (normal/insert). Off by default; keybindings.json is always on. */
    vim?: { enabled?: boolean };
    /** Omit generic Pi documentation guidance except during explicit Pi-help turns. */
    promptSlim?: { enabled?: boolean };
    /** Model, usage, location, and extension-status footer. */
    statusline?: {
        /** Optional shell command whose stdout is appended as an extra status-line row. */
        command?: string;
        /** Per-Pi-theme pill backgrounds. Unknown or malformed palettes fall back to theme tokens. */
        palettes?: Record<
            string,
            {
                /** Outer pill background. */
                outer?: { rgb: [number, number, number]; ansi256: number };
                /** Inner pill background. */
                inner?: { rgb: [number, number, number]; ansi256: number };
            }
        >;
    };
    /** tmux pane tracker and attention-state classification. */
    sessionTracker?: {
        /** Small model used to classify required input. Defaults to the default preset's fast model. */
        needsInputModel?: string;
    };
    /** Elapsed timers beside the Working and Thinking labels. On by default. */
    timer?: { enabled?: boolean };
    /** Public-web discovery and static page reading. Credentials stay in WEB_SEARCH_API_KEY. */
    web?: {
        search?: { limit?: number };
        read?: { maxTokens?: number; maxResponseBytes?: number; timeoutMs?: number };
    };
    /** Quieter read tool. */
    read?: {
        /**
         * Redirect an unbounded read (no offset/limit) of a file larger than this
         * many KB to grep first. 0 disables the redirect. Default 256.
         */
        grepGateKb?: number;
        /**
         * File extensions that skip the grep gate, on top of the built-in image
         * types (their contents are not usefully greppable). Leading dot/asterisk
         * optional, e.g. ["pdf", ".zip", "*.wasm"].
         */
        grepGateBypass?: string[];
    };
    /** Heads-up before git commands that sign (and may block on a YubiKey touch). */
    commitSign?: {
        /** "warn" (notify only), "confirm" (ask, default), or "block" (refuse). */
        mode?: "warn" | "confirm" | "block";
        /**
         * Block a signing commit whose bash timeout is below this many seconds, so
         * a short timeout cannot kill it mid-touch. Default 120.
         */
        minTimeoutSec?: number;
    };
    /** Adds protected rules to routine/unknown Bash authorization policy. */
    bashGate?: BashGateConfig;
    /** Graphify knowledge-graph command and skill. Disabled unless explicitly enabled. */
    graphify?: { enabled?: boolean };
    /**
     * End-of-turn notifications. "both" (default) rings the terminal bell and,
     * in a graphical session, also fires notify-send; "bell" / "desktop" limit
     * to one channel; "off" silences both.
     */
    notifications?: { mode?: NotificationMode };
    /** Session-scoped snapshots of pi's own edit/write changes; /rollback restores. */
    checkpoints?: { enabled?: boolean };
    /** Per-agent overrides keyed by agent type, e.g. { "explore": { "model": "..." } }. */
    subagents?: { [agentType: string]: { model?: string } };
    /** Automatic fast/base/deep routing. */
    routing?: RoutingConfig;
    /**
     * Guard against secret files (.env, .npmrc, sops blobs, ...) leaking into
     * context. NOT a security boundary: the agent can edit this extension. See the
     * threat-model banner in adapters/secret-guard.ts. Real enforcement is OS
     * perms + sops key isolation + egress control.
     */
    secretGuard?: {
        /** "block" (refuse, default), "warn" (notify only), or "off" (disable). */
        mode?: "off" | "warn" | "block";
        /** Extra secret-file globs, unioned with the built-in defaults. */
        paths?: string[];
        /**
         * Plaintext files whose values the output scrubber learns and redacts.
         * Default [".env", ".envrc", ".npmrc"]. sops blobs are never decrypted here.
         */
        scrubFrom?: string[];
        /** Decrypted sops-nix tree to also scrub, if this uid can read it. Default /run/secrets. */
        runSecretsDir?: string;
        /** Do not redact values shorter than this (avoids nuking "true"/ports). Default 6. */
        minSecretLen?: number;
    };
}

/** The precise shape `JSON.parse` yields; the working type while merging config. */
type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
interface JsonObject {
    readonly [key: string]: JsonValue;
}

function isJsonObject(value: JsonValue): value is JsonObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse a pidev.json to an object, or {} on a missing file, bad JSON, or non-object. */
function readJsonObject(path: string): JsonObject {
    try {
        const parsed = JSON.parse(readFileSync(path, "utf8")) as JsonValue;
        return isJsonObject(parsed) ? parsed : {};
    } catch {
        // Missing file or bad JSON: fall back to defaults.
        return {};
    }
}

/** Concatenate two lists, dropping values (by JSON identity) already present. */
function unionArrays(base: readonly JsonValue[], override: readonly JsonValue[]): JsonValue[] {
    const seen = new Set<string>();
    const merged: JsonValue[] = [];
    for (const item of [...base, ...override]) {
        const identity = JSON.stringify(item);
        if (seen.has(identity)) continue;
        seen.add(identity);
        merged.push(item);
    }
    return merged;
}

function mergeValues(base: JsonValue, override: JsonValue): JsonValue {
    if (Array.isArray(base) && Array.isArray(override)) return unionArrays(base, override);
    if (isJsonObject(base) && isJsonObject(override)) return mergeObjects(base, override);
    return override;
}

/**
 * Deep-merge two config objects with one feature-agnostic policy so new fields
 * need no bespoke merge code: nested objects merge key by key, arrays union (so a
 * globally set constraint stays set in every project), and scalars take the
 * override (project) value.
 */
function mergeObjects(base: JsonObject, override: JsonObject): JsonObject {
    const merged: { [key: string]: JsonValue } = { ...base };
    for (const key of Object.keys(override)) {
        const overrideValue = override[key];
        if (overrideValue === undefined) continue;
        const baseValue = base[key];
        merged[key] =
            baseValue === undefined ? overrideValue : mergeValues(baseValue, overrideValue);
    }
    return merged;
}

export function loadConfig(cwd: string): PiDevConfig {
    const global = readJsonObject(join(getAgentDir(), "pidev.json"));
    const project = readJsonObject(join(cwd, CONFIG_DIR_NAME, "pidev.json"));
    // Trust boundary: the merged tree is JSON in the pidev.json shape (all fields optional).
    return mergeObjects(global, project) as PiDevConfig;
}
