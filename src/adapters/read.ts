/**
 * Quieter `read` tool.
 *
 * Keeps pi's built-in read behaviour but renders results collapsed by default,
 * so large file reads don't flood the transcript; the "ctrl+o to expand" hint
 * stays, so the body is one keystroke away. The description also steers the
 * model to grep large or unstructured files before reading them, and an
 * unbounded read of a file over READ_GATE_BYTES is redirected to grep with a
 * soft escape hatch (an explicit offset/limit forces it through). Adapted from
 * pi-bites' read tweak (packages/ext/tools.ts). The gate threshold and extra
 * bypass extensions come from pidev.json (read.grepGateKb / read.grepGateBypass).
 */

import { statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import {
    type AgentToolResult,
    createReadToolDefinition,
    type ExtensionAPI,
    type ReadToolDetails,
} from "@earendil-works/pi-coding-agent";

import { describeReadGate, shouldBypassReadGate } from "../domain/read-gate.ts";
import type { PiDevConfig } from "../infra/config.ts";

const READ_DESCRIPTION_SUFFIX =
    "Read known files in parallel. For large or unstructured files, grep first, then read a focused window.";

/** Byte gate (in KB) for redirecting blind reads to grep when pidev.json is silent. */
const DEFAULT_GREP_GATE_KB = 256;
export default function registerRead(pi: ExtensionAPI, configRef: { current: PiDevConfig }): void {
    const cwd = process.cwd();
    const read = createReadToolDefinition(cwd);
    const renderReadResult = read.renderResult;
    if (!renderReadResult) throw new Error("Built-in read renderer unavailable");

    pi.registerTool({
        ...read,
        description: `${read.description} ${READ_DESCRIPTION_SUFFIX}`,
        async execute(toolCallId, params, signal, onUpdate, ctx) {
            const readCfg = configRef.current.read;
            const thresholdBytes = (readCfg?.grepGateKb ?? DEFAULT_GREP_GATE_KB) * 1024;
            let redirect: string | null = null;
            if (!shouldBypassReadGate(params.path, readCfg?.grepGateBypass ?? [])) {
                try {
                    const absolute = isAbsolute(params.path)
                        ? params.path
                        : resolve(cwd, params.path);
                    redirect = describeReadGate(params, statSync(absolute).size, thresholdBytes);
                } catch {
                    // Let the built-in read surface missing or unreadable files.
                }
            }
            if (redirect) throw new Error(redirect);
            return read.execute(toolCallId, params, signal, onUpdate, ctx);
        },
        renderResult(result, options, theme, context) {
            return renderReadResult(
                result as AgentToolResult<ReadToolDetails | undefined>,
                { ...options, expanded: false },
                theme,
                context,
            );
        },
    });
}
