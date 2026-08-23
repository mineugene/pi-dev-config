/**
 * secretGuard - layered guard for secret files (.env, .npmrc, nuget.config,
 * appsettings*.json, dotnet user-secrets, sops/age/gpg blobs, ssh keys, ...).
 *
 * THREAT MODEL - READ THIS BEFORE TRUSTING IT.
 * This extension runs INSIDE the agent process and its source lives in a repo
 * the agent can edit/write/bash. It is NOT a security boundary against an
 * adversarial or prompt-injected model: such a model can rewrite this file,
 * disable it via pidev.json, or setActiveTools past it. Treat it as (a) accident
 * and lazy-leak prevention for a cooperative model and (b) a tripwire. The real
 * boundary lives where the agent cannot reach: OS file permissions, sops age/PGP
 * key isolation, and network egress control. See the checklist in the PR/README.
 *
 * Three layers, weakest to strongest:
 *   1. Path gate (tool_call): deny a built-in file tool (read/grep/find/ls/edit/
 *      write) pointed at a secret path. Blocks the honest path; a rename escapes it.
 *   2. Command gate (tool_call/bash): deny a bash segment that decrypts a sops/
 *      age/gpg blob, dumps a secret path, relocates one to a staging name (the
 *      "store now, decrypt/exfil later" move), or pipes one into an egress tool.
 *      Heuristic over the command string, not a shell parser; leaky by nature.
 *   3. Output scrubber (tool_result): replace known secret VALUES in every tool
 *      result with ***. Matches on value, not path, so it survives a rename and is
 *      the layer that answers "what if they renamed the file". Only covers values
 *      it can learn up front (configured plaintext files + readable /run/secrets);
 *      a secret the model freshly mints cannot be scrubbed.
 *
 * The pure matchers below (isSecretPath / classifySecretBashCommand / scrubSecrets)
 * are kept side-effect free and SHOULD move into util.ts with unit tests mirroring
 * isSigningCommand / isGuardedPrCommand once the shape settles.
 */

import { readdirSync, readFileSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { PiDevConfig } from "../infra/config.ts";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Glob-ish patterns (matched against basename and each path segment) for secret files. */
const DEFAULT_SECRET_PATTERNS = [
    ".env",
    ".env.*",
    "*.env",
    ".envrc",
    ".npmrc",
    ".pypirc",
    "nuget.config",
    "appsettings*.json",
    "secrets.json", // dotnet user-secrets
    "secrets*.y*ml",
    "*.sops.y*ml",
    "*.age",
    "*.gpg",
    "*.pem",
    "*.key",
    "id_rsa",
    "id_ed25519",
    "*.pfx",
    ".pgpass",
    ".netrc",
    "keys.txt", // sops age key default name
] as const;

/** Values shorter than this are too generic to redact safely (e.g. "true", a port). */
const DEFAULT_MIN_SECRET_LEN = 6;

/** Where sops-nix drops decrypted plaintext at activation. */
const DEFAULT_RUN_SECRETS_DIR = "/run/secrets";

// Commands that send file contents to stdout (leak into context).
const DUMPERS = new Set([
    "cat",
    "tac",
    "nl",
    "head",
    "tail",
    "less",
    "more",
    "xxd",
    "od",
    "hexdump",
    "strings",
    "base64",
    "base32",
    "cut",
    "tr",
    "fold",
    "tee",
    "awk",
    "gawk",
    "sed",
    "grep",
    "egrep",
    "rg",
    "ag",
    "perl",
    "python",
    "python3",
    "ruby",
    "node",
    "php",
    "envsubst",
    "dotenv",
]);

// Commands that relocate/duplicate a file to a new name (staging for later).
const MOVERS = new Set([
    "mv",
    "cp",
    "rsync",
    "ln",
    "link",
    "install",
    "rename",
    "tar",
    "zip",
    "gzip",
    "7z",
    "dd",
    "cpio",
    "shred",
]);

// Commands that push data off the box.
const EGRESS = new Set([
    "curl",
    "wget",
    "http",
    "httpie",
    "nc",
    "ncat",
    "netcat",
    "socat",
    "ssh",
    "scp",
    "sftp",
    "ftp",
    "telnet",
    "rclone",
    "aws",
    "gsutil",
    "az",
    "s3cmd",
    "mc",
    "gh",
]);

// ---------------------------------------------------------------------------
// Pure matchers (destined for util.ts + tests)
// ---------------------------------------------------------------------------

/** Compile a simple glob (only `*` wildcard) to a case-insensitive whole-string regex. */
function globToRegExp(glob: string): RegExp {
    const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`, "i");
}

const compiledCache = new Map<string, RegExp>();
function compile(glob: string): RegExp {
    let re = compiledCache.get(glob);
    if (!re) {
        re = globToRegExp(glob);
        compiledCache.set(glob, re);
    }
    return re;
}

/**
 * True when `path` (or any of its segments) matches one of `patterns`. Matching
 * the basename catches `.env`; matching a mid-path segment catches
 * `config/secrets/prod.yaml` so a nested layout is not a bypass.
 */
export function isSecretPath(path: string, patterns: readonly string[]): boolean {
    const cleaned = stripArg(path);
    if (!cleaned) return false;
    const segments = cleaned.split(/[\\/]/).filter(Boolean);
    const base = basename(cleaned);
    return patterns.some((p) => {
        const re = compile(p);
        return re.test(base) || segments.some((s) => re.test(s));
    });
}

/** Strip a leading `--flag=` and surrounding quotes so a path embedded in a token is seen. */
function stripArg(token: string): string {
    let t = token.trim();
    const eq = t.indexOf("=");
    // Keep the RHS of `--userconfig=.npmrc`, but not of a bare `KEY=val`.
    if (t.startsWith("-") && eq !== -1) t = t.slice(eq + 1);
    if (t.startsWith("@")) t = t.slice(1); // curl --data @file
    return t.replace(/^['"]|['"]$/g, "");
}

/** Split a compound command on shell separators, mirroring util.ts isSigningCommand. */
function splitSegments(command: string): string[] {
    return command.split(/&&|\|\||[;|\n]/);
}

function tokenize(segment: string): string[] {
    return segment.trim().split(/\s+/).filter(Boolean);
}

/** A sops invocation that is not clearly encrypt-only decrypts (to stdout, editor, or env). */
function isSopsDecrypt(tokens: string[]): boolean {
    const i = tokens.findIndex((t) => t === "sops" || t.endsWith("/sops"));
    if (i === -1) return false;
    const rest = tokens.slice(i + 1);
    // Encrypt-only forms are safe; everything else (bare file, -d, exec-env/-file, edit) decrypts.
    const encryptOnly =
        rest.some((t) => t === "-e" || t === "--encrypt") &&
        !rest.some((t) => t === "-d" || t === "--decrypt");
    return !encryptOnly;
}

/** age/rage/gpg used to decrypt. */
function isKeyDecrypt(tokens: string[]): boolean {
    const tool = tokens.find((t) => /^(?:.*\/)?(?:age|rage|gpg|gpg2)$/.test(t));
    if (!tool) return false;
    return tokens.some((t) => t === "-d" || t === "--decrypt");
}

/**
 * Classify a bash command against the secret policy. Returns a block reason, or
 * null to allow. Segments are checked independently. Heuristic, not a parser:
 * it over-blocks on quoting edge cases (safe) and can be evaded by an adversarial
 * model (the scrubber and OS boundary are the backstop).
 */
export function classifySecretBashCommand(
    command: string,
    patterns: readonly string[],
): string | null {
    for (const segment of splitSegments(command)) {
        const tokens = tokenize(segment);
        if (tokens.length === 0) continue;

        // 1. Decrypt verbs - caught regardless of the (possibly renamed) filename.
        if (isSopsDecrypt(tokens)) {
            return "Blocked: decrypting a sops secret. Consume it via a path-taking tool (sops exec-file into the real consumer) or run the decrypt yourself outside the agent.";
        }
        if (isKeyDecrypt(tokens)) {
            return "Blocked: age/gpg decryption of an encrypted file.";
        }

        // Does this segment name a secret path?
        const hasSecret = tokens.some((t) => isSecretPath(t, patterns));
        // `< secrets` redirection feeds the file into a command's stdin.
        const redirectFromSecret =
            /<\s*("?[^\s"|;&]+"?)/.test(segment) &&
            (segment.match(/<\s*("?[^\s"|;&]+"?)/g) ?? []).some((m) =>
                isSecretPath(m.replace(/^<\s*/, ""), patterns),
            );
        if (!hasSecret && !redirectFromSecret) continue;

        const verbs = tokens.map((t) => basename(stripArg(t)));
        if (verbs.some((v) => DUMPERS.has(v)) || redirectFromSecret) {
            return "Blocked: reading a secret file's contents into context. Pass the file by PATH to the tool that needs it (npm --userconfig, docker --env-file, dotnet, ...), do not cat/grep it.";
        }
        if (verbs.some((v) => MOVERS.has(v))) {
            return "Blocked: copying/moving/renaming a secret file. This is the classic stage-now-exfil-later move; keep secrets in place.";
        }
        if (verbs.some((v) => EGRESS.has(v))) {
            return "Blocked: piping a secret file into a network/egress tool.";
        }
    }
    return null;
}

/**
 * Replace every occurrence of a known secret value (and its base64 form) in
 * `text` with a placeholder. Literal replacement, so no regex escaping needed.
 */
export function scrubSecrets(text: string, needles: readonly string[]): string {
    let out = text;
    for (const needle of needles) {
        if (needle && out.includes(needle)) out = out.split(needle).join("***REDACTED***");
    }
    return out;
}

/**
 * Build the redaction needle set from a value list: each value plus its base64
 * encoding (padded and unpadded), filtered to those at least `minLen` long and
 * sorted longest-first so a longer secret is redacted before a substring of it.
 */
export function buildNeedles(values: Iterable<string>, minLen: number): string[] {
    const set = new Set<string>();
    for (const raw of values) {
        const v = raw.trim();
        if (v.length < minLen) continue;
        set.add(v);
        const b64 = Buffer.from(v, "utf8").toString("base64");
        set.add(b64);
        set.add(b64.replace(/=+$/, ""));
    }
    return [...set].sort((a, b) => b.length - a.length);
}

// ---------------------------------------------------------------------------
// Secret value loading (for the scrubber)
//
// The guard deliberately does NOT decrypt sops here; that would need the key and
// defeat the point. It scrubs plaintext it can already see: configured dotfiles
// and the decrypted /run/secrets tree IF this uid can read it. If it cannot read
// /run/secrets (the desired OS boundary), those plaintexts never reach tool
// output either, so there is nothing to scrub - consistent, not a gap.
// ---------------------------------------------------------------------------

function parseValues(content: string, path: string): string[] {
    const values: string[] = [];
    const base = basename(path).toLowerCase();
    if (base.endsWith(".json")) {
        try {
            collectJsonStrings(JSON.parse(content), values);
        } catch {
            // Malformed JSON: fall through to line parsing.
        }
    }
    // dotenv / npmrc / ini: RHS of the first `=` on each non-comment line.
    for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        values.push(
            trimmed
                .slice(eq + 1)
                .trim()
                .replace(/^["']|["']$/g, ""),
        );
    }
    return values;
}

function collectJsonStrings(node: unknown, out: string[]): void {
    if (typeof node === "string") out.push(node);
    else if (Array.isArray(node)) for (const v of node) collectJsonStrings(v, out);
    else if (node && typeof node === "object") {
        for (const v of Object.values(node)) collectJsonStrings(v, out);
    }
}

function loadSecretValues(cwd: string, cfg: NonNullable<PiDevConfig["secretGuard"]>): string[] {
    const values: string[] = [];
    const files = new Set(cfg.scrubFrom ?? [".env", ".envrc", ".npmrc"]);
    for (const file of files) {
        const abs = isAbsolute(file) ? file : resolve(cwd, file);
        try {
            values.push(...parseValues(readFileSync(abs, "utf8"), abs));
        } catch {
            // Missing/unreadable: skip. Unreadable /run/secrets is the intended boundary.
        }
    }
    // Whole-file contents of /run/secrets/* (each file holds one plaintext secret).
    const runDir = cfg.runSecretsDir ?? DEFAULT_RUN_SECRETS_DIR;
    try {
        for (const entry of readdirSync(runDir, { withFileTypes: true })) {
            if (!entry.isFile()) continue;
            try {
                values.push(readFileSync(resolve(runDir, entry.name), "utf8").trim());
            } catch {
                // Not readable by this uid: good, nothing to scrub.
            }
        }
    } catch {
        // No /run/secrets or not readable.
    }
    return values;
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

const FILE_TOOLS = new Set(["read", "grep", "find", "ls", "edit", "write"]);

function isTextPart(part: unknown): part is { type: "text"; text: string } {
    return (
        typeof part === "object" &&
        part !== null &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string"
    );
}

export default function registerSecretGuard(
    pi: ExtensionAPI,
    configRef: { current: PiDevConfig },
): void {
    let needles: string[] = [];

    const refresh = (ctx: { cwd: string }) => {
        const cfg = configRef.current.secretGuard ?? {};
        const minLen = cfg.minSecretLen ?? DEFAULT_MIN_SECRET_LEN;
        needles = buildNeedles(loadSecretValues(ctx.cwd, cfg), minLen);
    };

    pi.on("session_start", async (_event, ctx) => refresh(ctx));
    refresh({ cwd: process.cwd() });

    const patterns = () => [
        ...DEFAULT_SECRET_PATTERNS,
        ...(configRef.current.secretGuard?.paths ?? []),
    ];

    // Layers 1 + 2: pre-execution gate.
    pi.on("tool_call", async (event, ctx: ExtensionContext) => {
        const cfg = configRef.current.secretGuard ?? {};
        if (cfg.mode === "off") return undefined;

        if (event.toolName === "bash") {
            const command = typeof event.input?.command === "string" ? event.input.command : "";
            const reason = classifySecretBashCommand(command, patterns());
            if (reason) return warnOrBlock(cfg.mode, reason, ctx);
            return undefined;
        }

        if (FILE_TOOLS.has(event.toolName)) {
            const path =
                typeof (event.input as { path?: unknown })?.path === "string"
                    ? (event.input as { path: string }).path
                    : "";
            if (path && isSecretPath(path, patterns())) {
                return warnOrBlock(
                    cfg.mode,
                    `Blocked: ${event.toolName} of a secret file (${path}). Its contents must not enter context; pass it by path to the consuming command instead.`,
                    ctx,
                );
            }
        }
        return undefined;
    });

    // Layer 3: post-execution scrubber. Runs even when the gate is bypassed
    // (renamed file, unforeseen dumper) because it matches on value, not path.
    pi.on("tool_result", async (event) => {
        if ((configRef.current.secretGuard?.mode ?? "block") === "off") return undefined;
        if (needles.length === 0) return undefined;
        let changed = false;
        const content = event.content.map((part) => {
            if (!isTextPart(part)) return part;
            const scrubbed = scrubSecrets(part.text, needles);
            if (scrubbed === part.text) return part;
            changed = true;
            return { ...part, text: scrubbed };
        });
        return changed ? { content } : undefined;
    });
}

function warnOrBlock(
    mode: string | undefined,
    reason: string,
    ctx: ExtensionContext,
): { block: boolean; reason: string } | undefined {
    if (mode === "warn") {
        if (ctx.hasUI) ctx.ui.notify(reason, "warning");
        return undefined;
    }
    return { block: true, reason };
}
