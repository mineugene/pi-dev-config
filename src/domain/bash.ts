/** Pure Bash authorization policy. Parsing lives in infra/bash-parser.ts. */

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

function commandRules(
    idPrefix: string,
    commands: readonly string[],
    reason: string,
): BashGateRule[] {
    return commands.map((cmd) => ({ id: `${idPrefix}.${cmd}`, cmd, reason }));
}

function subcommandRules(
    idPrefix: string,
    cmd: OneOrMany<string>,
    subcommands: readonly string[],
    reason: string,
): BashGateRule[] {
    return subcommands.map((subcommand) => ({
        id: `${idPrefix}.${subcommand}`,
        cmd,
        subcommands: subcommand,
        reason,
    }));
}

export const DEFAULT_BASH_PROTECTED_RULES: BashGateRule[] = [
    {
        id: "filesystem.delete.rm",
        cmd: ["rm", "rmdir"],
        reason: "Deletes files or directories.",
    },
    {
        id: "filesystem.delete.shred",
        cmd: "shred",
        reason: "Permanently overwrites file contents.",
    },
    ...commandRules(
        "filesystem.permissions",
        ["chmod", "chown", "chgrp"],
        "Changes file ownership or permissions.",
    ),
    ...commandRules(
        "filesystem.modify",
        ["ln", "tee", "truncate", "dd"],
        "Changes files or filesystem links.",
    ),
    ...commandRules("host.privilege", ["sudo", "su"], "Runs with elevated privileges."),
    ...commandRules(
        "host.process.signal",
        ["kill", "pkill", "killall"],
        "Stops or signals running processes.",
    ),
    ...commandRules("host.power", ["reboot", "shutdown"], "Changes the host's power state."),
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
    ).map((rule) =>
        ["reset", "checkout", "stash", "tag"].includes(String(rule.subcommands))
            ? { ...rule, sessionScope: "command" as const }
            : rule,
    ),
    {
        id: "git.commit.amend",
        cmd: "git",
        subcommands: "commit",
        flagAny: "--amend",
        reason: "Rewrites the current Git commit.",
    },
    {
        id: "git.output.write",
        cmd: "git",
        flagAny: "--output",
        reason: "Writes Git output to a file.",
    },
    {
        id: "git.remote.push",
        cmd: "git",
        subcommands: "push",
        reason: "Changes a remote Git repository.",
    },
    {
        id: "git.branch.delete",
        cmd: "git",
        subcommands: "branch",
        flagAny: ["-d", "-D", "--delete"],
        clusteredShortFlags: true,
        reason: "Deletes a Git branch.",
    },
    {
        id: "gh.pr.merge",
        cmd: "gh",
        args: ["pr", "merge"],
        reason: "Merges a pull request on GitHub.",
    },
    {
        id: "gh.issue.close",
        cmd: "gh",
        args: ["issue", "close"],
        reason: "Closes an issue on GitHub.",
    },
    {
        id: "docker.remove",
        cmd: "docker",
        subcommands: ["rm", "rmi"],
        reason: "Removes Docker containers or images.",
    },
    {
        id: "docker.remote.push",
        cmd: "docker",
        subcommands: "push",
        reason: "Publishes a Docker image to a remote registry.",
    },
    ...subcommandRules(
        "kubectl.remote",
        "kubectl",
        ["apply", "delete"],
        "Changes resources in a Kubernetes cluster.",
    ),
    {
        id: "source.autofix.ruff",
        cmd: "ruff",
        flagAny: ["--fix", "--fix-only", "--unsafe-fixes"],
        reason: "Automatically changes source files.",
    },
    {
        id: "source.autofix.rubocop",
        cmd: "rubocop",
        flagAny: ["-a", "-A", "--autocorrect", "--autocorrect-all"],
        reason: "Automatically changes source files.",
    },
    {
        id: "source.autofix.golangci-lint",
        cmd: "golangci-lint",
        flagAny: "--fix",
        reason: "Automatically changes source files.",
    },
    ...commandRules(
        "source.autofix.script",
        ["npm", "pnpm", "yarn", "bun"],
        "Automatically changes source files.",
    ).map((rule) => ({ ...rule, flagAny: ["--fix", "--write"] })),
    ...commandRules("test.snapshots", ["jest", "vitest"], "Updates test snapshots.").map(
        (rule) => ({ ...rule, flagAny: ["-u", "--update", "--updateSnapshot"] }),
    ),
    ...commandRules(
        "test.snapshots.script",
        ["npm", "pnpm", "yarn", "bun"],
        "Updates test snapshots.",
    ).map((rule) => ({ ...rule, flagAny: ["-u", "--update", "--updateSnapshot"] })),
    ...subcommandRules(
        "package.npm",
        "npm",
        ["install", "uninstall", "update", "ci", "link"],
        "Installs or changes project dependencies.",
    ),
    ...subcommandRules(
        "package.yarn",
        "yarn",
        ["add", "remove", "install"],
        "Installs or changes project dependencies.",
    ),
    ...subcommandRules(
        "package.bun",
        "bun",
        ["add", "remove", "install"],
        "Installs or changes project dependencies.",
    ),
    ...subcommandRules(
        "package.pnpm",
        "pnpm",
        ["add", "remove", "install"],
        "Installs or changes project dependencies.",
    ),
    ...subcommandRules(
        "package.npm",
        "npm",
        ["publish"],
        "Publishes a package to a remote registry.",
    ),
    ...subcommandRules(
        "package.yarn",
        "yarn",
        ["publish"],
        "Publishes a package to a remote registry.",
    ),
    ...subcommandRules(
        "package.bun",
        "bun",
        ["publish"],
        "Publishes a package to a remote registry.",
    ),
    ...subcommandRules(
        "package.pnpm",
        "pnpm",
        ["publish"],
        "Publishes a package to a remote registry.",
    ),
    ...subcommandRules(
        "package.pip",
        ["pip", "pip3"],
        ["install", "uninstall"],
        "Installs or changes Python packages.",
    ),
    ...subcommandRules(
        "package.system",
        ["apt", "apt-get"],
        ["install", "remove", "purge", "update", "upgrade"],
        "Changes system packages.",
    ),
    ...subcommandRules(
        "package.brew",
        "brew",
        ["install", "uninstall", "upgrade"],
        "Changes system packages.",
    ),
    ...subcommandRules(
        "service.systemctl",
        "systemctl",
        ["start", "stop", "restart", "enable", "disable"],
        "Changes a system service.",
    ),
    ...subcommandRules(
        "service.service",
        "service",
        ["start", "stop", "restart"],
        "Changes a system service.",
    ),
    ...commandRules(
        "editor.open",
        ["vim", "vi", "nano", "emacs", "code", "subl"],
        "Opens an interactive editor.",
    ),
    {
        id: "rg.execute",
        cmd: "rg",
        flagAny: ["--pre", "--hostname-bin"],
        sessionScope: "command",
        reason: "Executes an external command while searching.",
    },
    {
        id: "find.delete",
        cmd: "find",
        flagAny: "-delete",
        reason: "Deletes discovered files or directories.",
    },
    {
        id: "find.execute",
        cmd: "find",
        flagAny: ["-exec", "-execdir", "-ok", "-okdir"],
        sessionScope: "command",
        reason: "Executes a command for discovered paths.",
    },
    {
        id: "find.write",
        cmd: "find",
        flagAny: ["-fprint", "-fprint0", "-fprintf", "-fls"],
        reason: "Writes search results to a file.",
    },
    {
        id: "fd.execute",
        cmd: "fd",
        flagAny: ["-x", "--exec", "-X", "--exec-batch"],
        sessionScope: "command",
        reason: "Executes a command for discovered paths.",
    },
    {
        id: "sort.write",
        cmd: "sort",
        flagAny: ["-o", "--output"],
        clusteredShortFlags: true,
        reason: "Writes sorted output to a file.",
    },
    ...commandRules(
        "shell.dynamic",
        ["sh", "bash", "zsh", "fish"],
        "Executes commands through a shell.",
    ).map((rule) => ({ ...rule, sessionScope: "command" as const })),
    {
        id: "shell.eval",
        cmd: "eval",
        sessionScope: "command",
        reason: "Executes a dynamically supplied command.",
    },
    {
        id: "shell.source",
        cmd: ["source", "."],
        sessionScope: "command",
        reason: "Executes commands from another file.",
    },
    {
        id: "shell.xargs",
        cmd: "xargs",
        sessionScope: "command",
        reason: "Constructs and executes commands from input.",
    },
    {
        id: "shell.command-substitution",
        constructAny: "command-substitution",
        sessionScope: "expression",
        reason: "Executes a command to construct shell input.",
    },
    {
        id: "shell.process-substitution",
        constructAny: "process-substitution",
        sessionScope: "expression",
        reason: "Executes a command through process substitution.",
    },
    {
        id: "shell.heredoc",
        constructAny: "heredoc",
        sessionScope: "expression",
        reason: "May expand inline shell input before execution.",
    },
    {
        id: "shell.dynamic-command-name",
        constructAny: "dynamic-command-name",
        sessionScope: "expression",
        reason: "Resolves the executable command dynamically.",
    },
    {
        id: "shell.path-assignment",
        constructAny: "path-assignment",
        sessionScope: "expression",
        reason: "Changes how executable commands are resolved.",
    },
    {
        id: "shell.redirect.write",
        redirects: "any-write",
        sessionScope: "command-names",
        reason: "Writes command output to a file.",
    },
];

/** Routine developer commands. Installed tools and normal project code are trusted. */
/** Legacy name retained for config/matcher callers. */
export const DEFAULT_BASH_GATE_RULES = DEFAULT_BASH_PROTECTED_RULES;

export const DEFAULT_BASH_ALLOW_RULES: BashGateRule[] = [
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
            "echo",
            "printf",
            "true",
            "false",
        ],
    },
    { cmd: ["grep", "rg", "fd", "cut", "sort", "uniq", "tr", "diff", "cmp", "jq"] },
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
            "update",
        ],
    },
    { cmd: "graphify", args: ["hook", "status"] },
    { cmd: "graphify", args: ["global", "list"] },
    { cmd: "graphify", args: ["global", "path"] },
    { cmd: "graphify", subcommands: "cluster-only", flagAny: "--no-label" },
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
            "tsc",
            "golangci-lint",
        ],
    },
    { cmd: "ruff", subcommands: "check" },
    { cmd: "cargo", subcommands: ["check", "test", "build"] },
    { cmd: "go", subcommands: ["test", "vet", "build"] },
    { cmd: "dotnet", subcommands: ["test", "build"] },
    { cmd: ["npm", "pnpm", "yarn", "bun"], subcommands: "test" },
    ...["npm", "pnpm", "yarn", "bun"].flatMap((cmd) =>
        ["test", "check", "lint", "typecheck", "build"].map((script) => ({
            cmd,
            args: ["run", script],
        })),
    ),
    {
        cmd: "git",
        subcommands: [
            "status",
            "diff",
            "log",
            "show",
            "blame",
            "rev-parse",
            "ls-files",
            "add",
            "commit",
        ],
    },
    { cmd: "gh", args: ["pr", "view"] },
    { cmd: "gh", args: ["pr", "diff"] },
    { cmd: "gh", args: ["pr", "checks"] },
    { cmd: "gh", args: ["issue", "view"] },
    { cmd: "gh", args: ["run", "view"] },
    { cmd: "docker", subcommands: ["ps", "images", "logs", "inspect"] },
    { cmd: "kubectl", subcommands: ["get", "describe", "logs", "explain", "diff"] },
    { cmd: "kubectl", args: ["auth", "can-i"] },
];

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
        name === "service"
            ? normalizeToken(command.argv.at(-1))
            : normalizeToken(command.subcommand);
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
            const subcommand = normalizeToken(command.argv[1]);
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
