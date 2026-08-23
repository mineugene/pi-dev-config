/** Pure Bash authorization policy. Parsing lives in infra/bash-parser.ts. */

import type { PermissionDecision, PermissionEffect } from "./permissions.ts";

export interface BashSimpleCommand {
    name?: string;
    subcommand?: string;
    argv: string[];
    flags: string[];
}

export interface BashRedirect {
    operator: string;
    target?: string;
}

export const BASH_SHELL_CONSTRUCTS = [
    "command-substitution",
    "process-substitution",
    "heredoc",
    "path-assignment",
    "dynamic-command-name",
] as const;
export type BashShellConstruct = (typeof BASH_SHELL_CONSTRUCTS)[number];

export interface BashFacts {
    /** Original expression, used only to keep dynamic session permissions narrow. */
    text: string;
    commands: BashSimpleCommand[];
    redirects: BashRedirect[];
    pathCandidates: string[];
    constructs: BashShellConstruct[];
    hasPipe: boolean;
    hasParseError: boolean;
}

/** Permission-relevant facts derived from BashFacts without reparsing shell text. */
export interface BashAnalysis {
    readonly effects: ReadonlySet<PermissionEffect>;
    readonly unknown: boolean;
}

export type OneOrMany<T> = T | T[];

export const BASH_GATE_REDIRECT_RULES = ["any-write", "append", "truncate"] as const;
export type BashGateRedirectRule = (typeof BASH_GATE_REDIRECT_RULES)[number];

/** All present constraints must match. `id` is an internal authorization identifier. */
export interface BashGateRule {
    id?: string;
    cmd?: OneOrMany<string>;
    subcommands?: OneOrMany<string>;
    /** Required argv prefix after the executable, for nested CLI subcommands. */
    args?: string[];
    flagAny?: OneOrMany<string>;
    /** Treat short options as combinable, for CLIs that support flag clusters. */
    clusteredShortFlags?: boolean;
    redirects?: BashGateRedirectRule;
    constructAny?: OneOrMany<BashShellConstruct>;
    /** Add command context when a stable rule ID alone would authorize unrelated effects. */
    sessionScope?: "rule" | "command" | "command-names" | "expression";
    /** Concise user-facing description of the command's effect. */
    reason?: string;
    /** Built-in normalized-effect metadata. */
    effects?: readonly PermissionEffect[];
    /** A matching built-in rule leaves behaviour too ambiguous to auto-approve. */
    ambiguous?: boolean;
}

export interface BashGateConfig {
    /** Extra protected rules. Project configuration can only make policy stricter. */
    rules?: BashGateRule[];
}

export interface BashPolicy {
    protectedRules: readonly BashGateRule[];
    configuredProtectedRules: readonly BashGateRule[];
    allowRules: readonly BashGateRule[];
}

const PROCESS = ["process"] as const;
const READ_PROCESS = ["read", "process"] as const;
const WRITE_PROCESS = ["write", "process"] as const;
const DELETE_PROCESS = ["delete", "process"] as const;
const NETWORK_PROCESS = ["network", "process"] as const;
const NETWORK_WRITE_PROCESS = ["network", "write", "process"] as const;
const PRIVILEGED_PROCESS = ["privileged", "process"] as const;
const PRIVILEGED_WRITE_PROCESS = ["privileged", "write", "process"] as const;
const NETWORK_PRIVILEGED_WRITE_PROCESS = ["network", "privileged", "write", "process"] as const;

function commandRules(
    idPrefix: string,
    commands: readonly string[],
    reason: string,
    effects: readonly PermissionEffect[] = PROCESS,
    ambiguous = false,
): BashGateRule[] {
    return commands.map((cmd) => ({
        id: `${idPrefix}.${cmd}`,
        cmd,
        reason,
        effects,
        ...(ambiguous ? { ambiguous: true } : {}),
    }));
}

function subcommandRules(
    idPrefix: string,
    cmd: OneOrMany<string>,
    subcommands: readonly string[],
    reason: string,
    effects: readonly PermissionEffect[] = PROCESS,
    ambiguous = false,
): BashGateRule[] {
    return subcommands.map((subcommand) => ({
        id: `${idPrefix}.${subcommand}`,
        cmd,
        subcommands: subcommand,
        reason,
        effects,
        ...(ambiguous ? { ambiguous: true } : {}),
    }));
}

export const DEFAULT_BASH_PROTECTED_RULES: BashGateRule[] = [
    {
        id: "filesystem.delete.rm",
        cmd: ["rm", "rmdir"],
        reason: "Deletes files or directories.",
        effects: DELETE_PROCESS,
    },
    {
        id: "filesystem.delete.shred",
        cmd: "shred",
        reason: "Permanently overwrites file contents.",
        effects: DELETE_PROCESS,
    },
    ...commandRules(
        "filesystem.permissions",
        ["chmod", "chown", "chgrp"],
        "Changes file ownership or permissions.",
        WRITE_PROCESS,
        true,
    ),
    ...commandRules(
        "filesystem.modify",
        ["ln", "tee", "truncate", "dd"],
        "Changes files or filesystem links.",
        WRITE_PROCESS,
        true,
    ),
    ...commandRules(
        "host.privilege",
        ["sudo", "su"],
        "Runs with elevated privileges.",
        PRIVILEGED_PROCESS,
    ),
    ...commandRules(
        "host.process.signal",
        ["kill", "pkill", "killall"],
        "Stops or signals running processes.",
        DELETE_PROCESS,
        true,
    ),
    ...commandRules(
        "host.power",
        ["reboot", "shutdown"],
        "Changes the host's power state.",
        PRIVILEGED_PROCESS,
    ),
    ...subcommandRules(
        "git.local",
        "git",
        [
            "pull",
            "merge",
            "rebase",
            "reset",
            "checkout",
            "stash",
            "cherry-pick",
            "revert",
            "tag",
            "init",
            "clone",
        ],
        "Changes Git history or the working tree.",
        WRITE_PROCESS,
        true,
    ).map((rule) => ({
        ...rule,
        ...(["pull", "clone"].includes(String(rule.subcommands))
            ? { effects: NETWORK_WRITE_PROCESS }
            : {}),
        ...(["reset", "checkout", "stash", "tag"].includes(String(rule.subcommands))
            ? { sessionScope: "command" as const }
            : {}),
    })),
    {
        id: "git.commit.amend",
        cmd: "git",
        subcommands: "commit",
        flagAny: "--amend",
        reason: "Rewrites the current Git commit.",
        effects: WRITE_PROCESS,
        ambiguous: true,
    },
    {
        id: "git.output.write",
        cmd: "git",
        flagAny: "--output",
        reason: "Writes Git output to a file.",
        effects: WRITE_PROCESS,
    },
    {
        id: "git.remote.push",
        cmd: "git",
        subcommands: "push",
        reason: "Changes a remote Git repository.",
        effects: NETWORK_WRITE_PROCESS,
    },
    {
        id: "git.branch.delete",
        cmd: "git",
        subcommands: "branch",
        flagAny: ["-d", "-D", "--delete"],
        clusteredShortFlags: true,
        reason: "Deletes a Git branch.",
        effects: DELETE_PROCESS,
    },
    {
        id: "gh.pr.merge",
        cmd: "gh",
        args: ["pr", "merge"],
        reason: "Merges a pull request on GitHub.",
        effects: NETWORK_WRITE_PROCESS,
        ambiguous: true,
    },
    {
        id: "gh.issue.close",
        cmd: "gh",
        args: ["issue", "close"],
        reason: "Closes an issue on GitHub.",
        effects: NETWORK_WRITE_PROCESS,
        ambiguous: true,
    },
    {
        id: "docker.remove",
        cmd: "docker",
        subcommands: ["rm", "rmi"],
        reason: "Removes Docker containers or images.",
        effects: DELETE_PROCESS,
        ambiguous: true,
    },
    {
        id: "docker.remote.push",
        cmd: "docker",
        subcommands: "push",
        reason: "Publishes a Docker image to a remote registry.",
        effects: NETWORK_WRITE_PROCESS,
    },
    ...subcommandRules(
        "kubectl.remote",
        "kubectl",
        ["apply", "delete"],
        "Changes resources in a Kubernetes cluster.",
        NETWORK_WRITE_PROCESS,
        true,
    ),
    {
        id: "source.autofix.ruff",
        cmd: "ruff",
        flagAny: ["--fix", "--fix-only", "--unsafe-fixes"],
        reason: "Automatically changes source files.",
        effects: WRITE_PROCESS,
    },
    {
        id: "source.autofix.rubocop",
        cmd: "rubocop",
        flagAny: ["-a", "-A", "--autocorrect", "--autocorrect-all"],
        reason: "Automatically changes source files.",
        effects: WRITE_PROCESS,
    },
    {
        id: "source.autofix.golangci-lint",
        cmd: "golangci-lint",
        flagAny: "--fix",
        reason: "Automatically changes source files.",
        effects: WRITE_PROCESS,
    },
    ...commandRules(
        "source.autofix.script",
        ["npm", "pnpm", "yarn", "bun"],
        "Automatically changes source files.",
        WRITE_PROCESS,
    ).map((rule) => ({ ...rule, flagAny: ["--fix", "--write"] })),
    ...commandRules(
        "test.snapshots",
        ["jest", "vitest"],
        "Updates test snapshots.",
        WRITE_PROCESS,
    ).map((rule) => ({ ...rule, flagAny: ["-u", "--update", "--updateSnapshot"] })),
    ...commandRules(
        "test.snapshots.script",
        ["npm", "pnpm", "yarn", "bun"],
        "Updates test snapshots.",
        WRITE_PROCESS,
    ).map((rule) => ({ ...rule, flagAny: ["-u", "--update", "--updateSnapshot"] })),
    ...subcommandRules(
        "package.npm",
        "npm",
        ["install", "uninstall", "update", "ci", "link"],
        "Installs or changes project dependencies.",
        NETWORK_WRITE_PROCESS,
    ),
    ...subcommandRules(
        "package.yarn",
        "yarn",
        ["add", "remove", "install"],
        "Installs or changes project dependencies.",
        NETWORK_WRITE_PROCESS,
    ),
    ...subcommandRules(
        "package.bun",
        "bun",
        ["add", "remove", "install"],
        "Installs or changes project dependencies.",
        NETWORK_WRITE_PROCESS,
    ),
    ...subcommandRules(
        "package.pnpm",
        "pnpm",
        ["add", "remove", "install"],
        "Installs or changes project dependencies.",
        NETWORK_WRITE_PROCESS,
    ),
    ...subcommandRules(
        "package.npm",
        "npm",
        ["publish"],
        "Publishes a package to a remote registry.",
        NETWORK_WRITE_PROCESS,
    ),
    ...subcommandRules(
        "package.yarn",
        "yarn",
        ["publish"],
        "Publishes a package to a remote registry.",
        NETWORK_WRITE_PROCESS,
    ),
    ...subcommandRules(
        "package.bun",
        "bun",
        ["publish"],
        "Publishes a package to a remote registry.",
        NETWORK_WRITE_PROCESS,
    ),
    ...subcommandRules(
        "package.pnpm",
        "pnpm",
        ["publish"],
        "Publishes a package to a remote registry.",
        NETWORK_WRITE_PROCESS,
    ),
    ...subcommandRules(
        "package.pip",
        ["pip", "pip3"],
        ["install", "uninstall"],
        "Installs or changes Python packages.",
        NETWORK_WRITE_PROCESS,
    ),
    ...subcommandRules(
        "package.system",
        ["apt", "apt-get"],
        ["install", "remove", "purge", "update", "upgrade"],
        "Changes system packages.",
        NETWORK_PRIVILEGED_WRITE_PROCESS,
    ),
    ...subcommandRules(
        "package.brew",
        "brew",
        ["install", "uninstall", "upgrade"],
        "Changes system packages.",
        NETWORK_WRITE_PROCESS,
    ),
    ...subcommandRules(
        "service.systemctl",
        "systemctl",
        ["start", "stop", "restart", "enable", "disable"],
        "Changes a system service.",
        PRIVILEGED_WRITE_PROCESS,
        true,
    ),
    ...subcommandRules(
        "service.service",
        "service",
        ["start", "stop", "restart"],
        "Changes a system service.",
        PRIVILEGED_WRITE_PROCESS,
        true,
    ),
    ...commandRules(
        "editor.open",
        ["vim", "vi", "nano", "emacs", "code", "subl"],
        "Opens an interactive editor.",
        WRITE_PROCESS,
        true,
    ),
    {
        id: "rg.execute",
        cmd: "rg",
        flagAny: ["--pre", "--hostname-bin"],
        sessionScope: "command",
        reason: "Executes an external command while searching.",
        effects: PROCESS,
        ambiguous: true,
    },
    {
        id: "find.delete",
        cmd: "find",
        flagAny: "-delete",
        reason: "Deletes discovered files or directories.",
        effects: DELETE_PROCESS,
    },
    {
        id: "find.execute",
        cmd: "find",
        flagAny: ["-exec", "-execdir", "-ok", "-okdir"],
        sessionScope: "command",
        reason: "Executes a command for discovered paths.",
        effects: PROCESS,
        ambiguous: true,
    },
    {
        id: "find.write",
        cmd: "find",
        flagAny: ["-fprint", "-fprint0", "-fprintf", "-fls"],
        reason: "Writes search results to a file.",
        effects: WRITE_PROCESS,
    },
    {
        id: "fd.execute",
        cmd: "fd",
        flagAny: ["-x", "--exec", "-X", "--exec-batch"],
        sessionScope: "command",
        reason: "Executes a command for discovered paths.",
        effects: PROCESS,
        ambiguous: true,
    },
    {
        id: "sort.write",
        cmd: "sort",
        flagAny: ["-o", "--output"],
        clusteredShortFlags: true,
        reason: "Writes sorted output to a file.",
        effects: WRITE_PROCESS,
    },
    ...commandRules(
        "shell.dynamic",
        ["sh", "bash", "zsh", "fish"],
        "Executes commands through a shell.",
        PROCESS,
        true,
    ).map((rule) => ({ ...rule, sessionScope: "command" as const })),
    {
        id: "shell.eval",
        cmd: "eval",
        sessionScope: "command",
        reason: "Executes a dynamically supplied command.",
        effects: PROCESS,
        ambiguous: true,
    },
    {
        id: "shell.source",
        cmd: ["source", "."],
        sessionScope: "command",
        reason: "Executes commands from another file.",
        effects: PROCESS,
        ambiguous: true,
    },
    {
        id: "shell.xargs",
        cmd: "xargs",
        sessionScope: "command",
        reason: "Constructs and executes commands from input.",
        effects: PROCESS,
        ambiguous: true,
    },
    {
        id: "shell.command-substitution",
        constructAny: "command-substitution",
        sessionScope: "expression",
        reason: "Executes a command to construct shell input.",
        effects: PROCESS,
        ambiguous: true,
    },
    {
        id: "shell.process-substitution",
        constructAny: "process-substitution",
        sessionScope: "expression",
        reason: "Executes a command through process substitution.",
        effects: PROCESS,
        ambiguous: true,
    },
    {
        id: "shell.heredoc",
        constructAny: "heredoc",
        sessionScope: "expression",
        reason: "May expand inline shell input before execution.",
        effects: PROCESS,
        ambiguous: true,
    },
    {
        id: "shell.dynamic-command-name",
        constructAny: "dynamic-command-name",
        sessionScope: "expression",
        reason: "Resolves the executable command dynamically.",
        effects: PROCESS,
        ambiguous: true,
    },
    {
        id: "shell.path-assignment",
        constructAny: "path-assignment",
        sessionScope: "expression",
        reason: "Changes how executable commands are resolved.",
        effects: PROCESS,
        ambiguous: true,
    },
    {
        id: "shell.redirect.write",
        redirects: "any-write",
        sessionScope: "command-names",
        reason: "Writes command output to a file.",
        effects: WRITE_PROCESS,
    },
];

/** Routine developer commands. Installed tools and normal project code are trusted. */
/** Legacy name retained for config/matcher callers. */
export const DEFAULT_BASH_GATE_RULES = DEFAULT_BASH_PROTECTED_RULES;

export const DEFAULT_BASH_ALLOW_RULES: BashGateRule[] = (
    [
        {
            cmd: [
                "pwd",
                "ls",
                "tree",
                "cat",
                "head",
                "tail",
                "wc",
                "stat",
                "file",
                "basename",
                "dirname",
                "readlink",
                "realpath",
                "which",
                "whoami",
                "uname",
                "du",
                "df",
                "ps",
            ],
            effects: READ_PROCESS,
        },
        { cmd: ["echo", "printf", "true", "false"], effects: PROCESS },
        // Plain find is read-only; its exec/delete/write actions are protected rules
        // that win over this allowlist (checked first).
        { cmd: ["grep", "rg", "fd", "find", "cut", "sort", "uniq", "tr", "diff", "cmp", "jq"] },
        // Local inspection, code-only updates, and unlabelled clustering do not call
        // an LLM. Full extraction, labelling, network, installation, and export
        // commands prompt.
        {
            cmd: "graphify",
            subcommands: [
                "--help",
                "--version",
                "query",
                "explain",
                "path",
                "affected",
                "god-nodes",
                "god_nodes",
                "diagnose",
                "benchmark",
                "check-update",
            ],
        },
        { cmd: "graphify", subcommands: "update", effects: WRITE_PROCESS },
        { cmd: "graphify", args: ["hook", "status"] },
        { cmd: "graphify", args: ["global", "list"] },
        { cmd: "graphify", args: ["global", "path"] },
        {
            cmd: "graphify",
            subcommands: "cluster-only",
            flagAny: "--no-label",
            effects: WRITE_PROCESS,
        },
        // `npx vitest run` resolves the project's normal test runner. Other npx
        // invocations remain unknown because they may fetch or execute another package.
        { cmd: "npx", args: ["vitest", "run"] },
        {
            cmd: [
                "pytest",
                "vitest",
                "jest",
                "phpunit",
                "rspec",
                "rubocop",
                "mypy",
                "golangci-lint",
            ],
        },
        { cmd: "ruff", subcommands: "check" },
        { cmd: "tsc", effects: WRITE_PROCESS },
        { cmd: "cargo", subcommands: ["check", "test", "build"], effects: WRITE_PROCESS },
        { cmd: "go", subcommands: ["test", "vet"] },
        { cmd: "go", subcommands: "build", effects: WRITE_PROCESS },
        { cmd: "dotnet", subcommands: ["test", "build"], effects: WRITE_PROCESS },
        { cmd: "dotnet", args: ["tool", "list", "--local"] },
        { cmd: "dotnet", args: ["ef", "--version"] },
        { cmd: ["npm", "pnpm", "yarn", "bun"], subcommands: "test" },
        ...["npm", "pnpm", "yarn", "bun"].flatMap((cmd) => [
            ...["test", "check", "lint", "typecheck"].map((script) => ({
                cmd,
                args: ["run", script],
            })),
            { cmd, args: ["run", "build"], effects: WRITE_PROCESS },
        ]),
        {
            cmd: "git",
            subcommands: ["status", "diff", "log", "show", "blame", "rev-parse", "ls-files"],
            effects: READ_PROCESS,
        },
        { cmd: "git", args: ["remote", "-v"], effects: READ_PROCESS },
        { cmd: "git", subcommands: ["add", "commit"], effects: WRITE_PROCESS },
        // sd edits files in place and has no execution primitive, so it classifies
        // as a plain write like `git add`; guarded mode and deny-policy subagents
        // still gate the write effect. stdin-to-stdout edits over-classify as
        // writes, which is safe.
        { cmd: "sd", effects: WRITE_PROCESS },
        { cmd: "gh", args: ["pr", "view"], effects: NETWORK_PROCESS },
        { cmd: "gh", args: ["pr", "diff"], effects: NETWORK_PROCESS },
        { cmd: "gh", args: ["pr", "checks"], effects: NETWORK_PROCESS },
        { cmd: "gh", args: ["issue", "view"], effects: NETWORK_PROCESS },
        { cmd: "gh", args: ["run", "view"], effects: NETWORK_PROCESS },
        { cmd: "docker", subcommands: ["ps", "images", "logs", "inspect"] },
        {
            cmd: "kubectl",
            subcommands: ["get", "describe", "logs", "explain", "diff"],
            effects: NETWORK_PROCESS,
        },
        { cmd: "kubectl", args: ["auth", "can-i"], effects: NETWORK_PROCESS },
    ] satisfies BashGateRule[]
).map((rule) => ({ ...rule, effects: rule.effects ?? READ_PROCESS }));

export interface BashGateMatch {
    label: string;
    source: "builtin" | "configured" | "allowlist";
    rule: BashGateRule;
    reason?: string;
    permissionId: string;
}

export interface BashPermissionScope {
    kind: "protected" | "unknown";
    ids: string[];
}

export type BashAuthorization =
    | { decision: "allow"; source: "allowlist"; matched: BashGateMatch[] }
    | {
          decision: "prompt";
          source: "protected" | "unknown";
          matched: BashGateMatch[];
          reasons: string[];
          scope: BashPermissionScope;
      };

function normalizeToken(value?: string): string | undefined {
    return value?.toLowerCase();
}

function asArray<T>(value?: OneOrMany<T>): T[] {
    return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function isDangerousRedirect(operator: string, target?: string): boolean {
    if (!operator.includes(">") || operator.includes("<<<") || operator.includes("<&")) {
        return false;
    }
    const normalizedTarget = target?.trim();
    if (operator.includes(">&")) {
        return Boolean(
            normalizedTarget &&
                normalizedTarget !== "/dev/null" &&
                !/^(?:\d+|-)$/u.test(normalizedTarget),
        );
    }
    return normalizedTarget !== "/dev/null";
}

function matchesRedirectRule(facts: BashFacts, rule: BashGateRedirectRule): boolean {
    return facts.redirects.some((redirect) => {
        if (!isDangerousRedirect(redirect.operator, redirect.target)) return false;
        return (
            rule === "any-write" ||
            (rule === "append"
                ? redirect.operator.includes(">>")
                : !redirect.operator.includes(">>"))
        );
    });
}

function flagMatches(actual: string, expected: string, clusteredShortFlags: boolean): boolean {
    const normalizedActual = actual.toLowerCase();
    const normalizedExpected = expected.toLowerCase();
    if (normalizedActual === normalizedExpected) return true;
    if (normalizedExpected.startsWith("--"))
        return normalizedActual.startsWith(`${normalizedExpected}=`);
    if (/^-[a-z]$/i.test(normalizedExpected) && !normalizedActual.startsWith("--")) {
        return (
            normalizedActual.startsWith(normalizedExpected) ||
            (clusteredShortFlags &&
                /^-[a-z]+$/i.test(normalizedActual) &&
                normalizedActual.slice(1).includes(normalizedExpected.slice(1)))
        );
    }
    return false;
}

function commandSubcommand(command: BashSimpleCommand): string | undefined {
    const name = normalizeToken(command.name);
    if (name !== "git") return normalizeToken(command.subcommand);

    let index = 1;
    while (command.argv[index] === "-C") index += 2;
    return normalizeToken(command.argv[index]);
}

function matchCommandRule(command: BashSimpleCommand, rule: BashGateRule): string | undefined {
    const name = normalizeToken(command.name);
    const commands = asArray(rule.cmd)
        .map(normalizeToken)
        .filter((token): token is string => token !== undefined);
    const subcommands = asArray(rule.subcommands)
        .map(normalizeToken)
        .filter((token): token is string => token !== undefined);
    const flags = asArray(rule.flagAny)
        .map(normalizeToken)
        .filter((token): token is string => token !== undefined);
    if (commands.length > 0 && (!name || !commands.includes(name))) return undefined;
    if (
        rule.args &&
        !rule.args.every(
            (arg, index) => normalizeToken(command.argv[index + 1]) === normalizeToken(arg),
        )
    )
        return undefined;

    const effectiveSubcommand =
        name === "service" ? normalizeToken(command.argv.at(-1)) : commandSubcommand(command);
    if (
        subcommands.length > 0 &&
        (!effectiveSubcommand || !subcommands.includes(effectiveSubcommand))
    )
        return undefined;

    const matchedFlag = flags.find((flag) =>
        command.flags.some((actual) =>
            flagMatches(actual, flag, rule.clusteredShortFlags === true),
        ),
    );
    if (flags.length > 0 && !matchedFlag) return undefined;
    if (name === "git" && effectiveSubcommand === "branch" && matchedFlag) return "git branch -d";
    if (rule.args && name) return [name, ...rule.args].join(" ");
    if (effectiveSubcommand && subcommands.length > 0) return `${name} ${effectiveSubcommand}`;
    if (matchedFlag && name) return `${name} ${matchedFlag}`;
    return name;
}

function hasCommandConstraint(rule: BashGateRule): boolean {
    return (
        rule.cmd !== undefined ||
        rule.subcommands !== undefined ||
        rule.args !== undefined ||
        rule.flagAny !== undefined
    );
}

function matchRuleAgainstFacts(facts: BashFacts, rule: BashGateRule): string[] {
    if (rule.redirects && !matchesRedirectRule(facts, rule.redirects)) return [];
    const constructs = asArray(rule.constructAny);
    const matchedConstruct = constructs.find((construct) => facts.constructs.includes(construct));
    if (constructs.length > 0 && !matchedConstruct) return [];

    if (!hasCommandConstraint(rule)) {
        if (matchedConstruct) return [`construct:${matchedConstruct}`];
        if (!rule.redirects) return [];
        return [
            facts.redirects.some((redirect) => redirect.operator.includes(">>"))
                ? "redirect:>>"
                : "redirect:>",
        ];
    }
    return [
        ...new Set(
            facts.commands
                .map((command) => matchCommandRule(command, rule))
                .filter((label): label is string => label !== undefined),
        ),
    ];
}

function ruleIdentity(rule: BashGateRule): string {
    return JSON.stringify({
        cmd: rule.cmd,
        subcommands: rule.subcommands,
        args: rule.args,
        flagAny: rule.flagAny,
        clusteredShortFlags: rule.clusteredShortFlags,
        redirects: rule.redirects,
        constructAny: rule.constructAny,
        sessionScope: rule.sessionScope,
    });
}

function rulePermissionId(rule: BashGateRule, source: BashGateMatch["source"]): string {
    const identity = ruleIdentity(rule);
    if (source === "configured") return `configured:${rule.id ?? "rule"}:${identity}`;
    return rule.id ?? `${source}:${identity}`;
}

function matchesForRules(
    facts: BashFacts,
    rules: readonly BashGateRule[],
    source: BashGateMatch["source"],
): BashGateMatch[] {
    const matches: BashGateMatch[] = [];
    for (const rule of rules) {
        for (const label of matchRuleAgainstFacts(facts, rule)) {
            const permissionId = rulePermissionId(rule, source);
            if (
                matches.some(
                    (match) => match.label === label && match.permissionId === permissionId,
                )
            )
                continue;
            matches.push({
                label,
                source,
                rule,
                ...(rule.reason === undefined ? {} : { reason: rule.reason }),
                permissionId,
            });
        }
    }
    return matches;
}

/** Matches protected rules, preserving configured-rule precedence for legacy callers. */
export function matchRules(
    facts: BashFacts,
    configuredRules: BashGateRule[],
    builtinRules: BashGateRule[],
): BashGateMatch[] {
    return [
        ...matchesForRules(facts, configuredRules, "configured"),
        ...matchesForRules(facts, builtinRules, "builtin"),
    ];
}

function commandMatchesAnyRule(
    command: BashSimpleCommand,
    rules: readonly BashGateRule[],
): boolean {
    return rules.some(
        (rule) => hasCommandConstraint(rule) && matchCommandRule(command, rule) !== undefined,
    );
}

function commandAllowed(command: BashSimpleCommand, allowRules: readonly BashGateRule[]): boolean {
    const executable = command.argv[0];
    return Boolean(
        executable && !executable.includes("/") && commandMatchesAnyRule(command, allowRules),
    );
}

function everyCommandAllowed(facts: BashFacts, allowRules: readonly BashGateRule[]): boolean {
    return (
        !facts.hasParseError &&
        facts.commands.length > 0 &&
        facts.commands.every((command) => commandAllowed(command, allowRules))
    );
}

interface CommandEffects {
    effects: PermissionEffect[];
    known: boolean;
}

function matchingCommandRules(
    command: BashSimpleCommand,
    rules: readonly BashGateRule[],
): BashGateRule[] {
    return rules.filter(
        (rule) => hasCommandConstraint(rule) && matchCommandRule(command, rule) !== undefined,
    );
}

function hasFlag(command: BashSimpleCommand, flags: readonly string[]): boolean {
    return command.argv.slice(1).some((arg) => {
        const normalized = arg.toLowerCase();
        return flags.some(
            (flag) =>
                normalized === flag ||
                normalized.startsWith(`${flag}=`) ||
                (flag.startsWith("-") && !flag.startsWith("--") && normalized.startsWith(flag)),
        );
    });
}

const MUTATING_HTTP_METHODS = new Set(["post", "put", "patch", "delete"]);

function curlWrites(command: BashSimpleCommand): boolean {
    if (
        hasFlag(command, [
            "-d",
            "--data",
            "--form",
            "--upload-file",
            "-o",
            "--output",
            "--remote-name",
        ]) ||
        command.argv.slice(1).some((arg) => arg.startsWith("-F") || arg.startsWith("-T"))
    )
        return true;

    return command.argv.slice(1).some((arg, index, args) => {
        const normalized = arg.toLowerCase();
        if (normalized === "-x" || normalized === "--request") {
            return MUTATING_HTTP_METHODS.has(args[index + 1]?.toLowerCase() ?? "");
        }
        const method = normalized.match(/^(?:-x|--request=)(.+)$/u)?.[1];
        return method !== undefined && MUTATING_HTTP_METHODS.has(method);
    });
}

function classifyBashCommand(command: BashSimpleCommand): CommandEffects {
    const name = normalizeToken(command.name);
    const executable = command.argv[0];
    if (!name || !executable) return { effects: [...PROCESS], known: false };

    const executableIsTrusted = !executable.includes("/") && !executable.includes("$");
    if (name === "curl") {
        return {
            effects: curlWrites(command) ? [...NETWORK_WRITE_PROCESS] : ["network", "process"],
            known: executableIsTrusted,
        };
    }
    if (name === "wget") {
        return { effects: [...NETWORK_WRITE_PROCESS], known: executableIsTrusted };
    }

    const allowMatches = matchingCommandRules(command, DEFAULT_BASH_ALLOW_RULES);
    const protectedMatches = matchingCommandRules(command, DEFAULT_BASH_PROTECTED_RULES);
    const effects = new Set<PermissionEffect>(PROCESS);
    for (const rule of allowMatches) {
        for (const effect of rule.effects ?? PROCESS) effects.add(effect);
    }
    return {
        effects: [...effects],
        known: executableIsTrusted && (allowMatches.length > 0 || protectedMatches.length > 0),
    };
}

function applyProtectedRuleEffects(facts: BashFacts, effects: Set<PermissionEffect>): boolean {
    let ambiguous = false;
    for (const match of matchesForRules(facts, DEFAULT_BASH_PROTECTED_RULES, "builtin")) {
        for (const effect of match.rule.effects ?? PROCESS) effects.add(effect);
        ambiguous ||= match.rule.ambiguous === true;
    }
    return ambiguous;
}

/** Derive stable effects from parsed Bash facts. Unknown syntax remains approval-gated. */
export function analyzeBashFacts(facts: BashFacts): BashAnalysis {
    const effects = new Set<PermissionEffect>();
    let unknown = facts.hasParseError || facts.constructs.length > 0 || facts.commands.length === 0;

    for (const command of facts.commands) {
        const classification = classifyBashCommand(command);
        for (const effect of classification.effects) effects.add(effect);
        unknown ||= !classification.known;
    }
    unknown ||= applyProtectedRuleEffects(facts, effects);

    return { effects, unknown };
}

const CATASTROPHIC_COMMANDS = new Set(["mkfs"]);

function isCatastrophicCommand(command: BashSimpleCommand): boolean {
    const name = normalizeToken(command.name);
    if (!name) return false;
    if (CATASTROPHIC_COMMANDS.has(name) || name.startsWith("mkfs.")) return true;
    if (
        (name === "rm" || name === "rmdir") &&
        command.argv.slice(1).some((arg) => arg === "/" || arg === "/*")
    ) {
        return true;
    }
    return (
        name === "dd" &&
        command.argv.some((arg) => arg.startsWith("of=/dev/") && arg !== "of=/dev/null")
    );
}

/** Bash-only hard and configured protections layered over generic policy. */
export function bashGuardDecision(
    facts: BashFacts,
    configuredRules: readonly BashGateRule[],
): PermissionDecision {
    if (facts.commands.some(isCatastrophicCommand)) return "deny";
    if (analyzeBashFacts(facts).unknown) return "ask";
    return matchRules(facts, [...configuredRules], []).length > 0 ? "ask" : "allow";
}

function contextualPermissionId(match: BashGateMatch, facts: BashFacts): string {
    switch (match.rule.sessionScope) {
        case "command": {
            const commands = facts.commands
                .filter((command) => matchCommandRule(command, match.rule) === match.label)
                .map((command) => command.argv);
            return JSON.stringify({ id: match.permissionId, commands });
        }
        case "command-names":
            return JSON.stringify({
                id: match.permissionId,
                redirects: [
                    ...new Set(
                        facts.redirects
                            .filter((redirect) =>
                                isDangerousRedirect(redirect.operator, redirect.target),
                            )
                            .map((redirect) =>
                                redirect.operator.includes(">>") ? "append" : "truncate",
                            ),
                    ),
                ],
                commands: facts.commands.map((command) => normalizeToken(command.name)),
            });
        case "expression":
            return JSON.stringify({ id: match.permissionId, expression: facts.text.trim() });
        default:
            return match.permissionId;
    }
}

function unknownPermissionIds(
    facts: BashFacts,
    protectedMatches: readonly BashGateMatch[],
    allowRules: readonly BashGateRule[],
): string[] {
    const ids = facts.commands
        .filter(
            (command) =>
                !protectedMatches.some(
                    (match) =>
                        hasCommandConstraint(match.rule) &&
                        matchCommandRule(command, match.rule) === match.label,
                ) && !commandAllowed(command, allowRules),
        )
        .map((command) => {
            const executable = normalizeToken(command.argv[0]) ?? "unparsed";
            const subcommand = commandSubcommand(command);
            return subcommand
                ? `command.unknown:${executable}:${subcommand}`
                : `command.unknown:${executable}`;
        });
    if (facts.hasParseError) {
        ids.push("command.unknown:parse-error", `command.unknown-expression:${facts.text.trim()}`);
    } else if (facts.commands.length === 0) {
        ids.push(`command.unknown-expression:${facts.text.trim()}`);
    }
    return [...new Set(ids)].sort();
}

/** Protected rules win. A compound expression runs only when every command is allowlisted. */
export function authorizeBashFacts(facts: BashFacts, policy: BashPolicy): BashAuthorization {
    const protectedMatches = [
        ...matchesForRules(facts, policy.configuredProtectedRules, "configured"),
        ...matchesForRules(facts, policy.protectedRules, "builtin"),
    ];
    const unknownIds = unknownPermissionIds(facts, protectedMatches, policy.allowRules);
    if (protectedMatches.length > 0) {
        const scopeIds = [
            ...new Set([
                ...protectedMatches.map((match) => contextualPermissionId(match, facts)),
                ...unknownIds,
            ]),
        ].sort();
        const reasons = protectedMatches.map(
            (match) => match.reason ?? "This command may change project or system state.",
        );
        if (unknownIds.length > 0) {
            reasons.push("Part of this command is not in the routine command allowlist.");
        }
        return {
            decision: "prompt",
            source: "protected",
            matched: protectedMatches,
            reasons: [...new Set(reasons)],
            scope: { kind: "protected", ids: scopeIds },
        };
    }
    if (everyCommandAllowed(facts, policy.allowRules)) {
        return {
            decision: "allow",
            source: "allowlist",
            matched: matchesForRules(facts, policy.allowRules, "allowlist"),
        };
    }
    return {
        decision: "prompt",
        source: "unknown",
        matched: [],
        reasons: ["This command is not in the routine command allowlist."],
        scope: { kind: "unknown", ids: unknownIds },
    };
}
