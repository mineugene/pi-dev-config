/**
 * Bash command parser. Loads the tree-sitter-bash wasm grammar and walks the
 * parse tree into the structured `BashFacts` the domain matcher consumes. This
 * is the one I/O edge of the bash gate (wasm resolution + load), which is why it
 * lives in infra rather than domain.
 */

import { createRequire } from "node:module";
import { basename } from "node:path";
import type { Node, Parser as TreeSitterParser } from "web-tree-sitter";

import type { BashFacts, BashRedirect, BashShellConstruct } from "../domain/bash.ts";

const SKIP_SUBTREE_TYPES = new Set(["comment", "heredoc_body", "heredoc_end"]);
const SHELL_CONSTRUCT_TYPES: Readonly<Record<string, BashShellConstruct>> = {
    command_substitution: "command-substitution",
    process_substitution: "process-substitution",
    heredoc_redirect: "heredoc",
};
const ARG_NODE_TYPES = new Set(["word", "concatenation", "string", "raw_string"]);
const URL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;
const REGEX_METACHAR_PATTERN = /\.\*|\.\+|\\\||\\\(|\\\)|\[.*?\]|\^\//;

let parserPromise: Promise<TreeSitterParser> | null = null;

async function initParser(): Promise<TreeSitterParser> {
    const { Parser, Language } = await import("web-tree-sitter");
    const req = createRequire(import.meta.url);

    const treeSitterWasm = req.resolve("web-tree-sitter/web-tree-sitter.wasm");
    await Parser.init({ locateFile: () => treeSitterWasm });

    const parser = new Parser();
    const bashWasm = req.resolve("tree-sitter-bash/tree-sitter-bash.wasm");
    const bash = await Language.load(bashWasm);
    parser.setLanguage(bash);
    return parser;
}

function getParser(): Promise<TreeSitterParser> {
    parserPromise ??= initParser();
    return parserPromise;
}

function resolveNodeText(node: Node): string {
    switch (node.type) {
        case "word":
        case "string_content":
        case "simple_expansion":
        case "expansion":
            return node.text;
        case "raw_string": {
            const text = node.text;
            if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
                return text.slice(1, -1);
            }
            return text;
        }
        case "string":
        case "concatenation": {
            let result = "";
            for (let i = 0; i < node.childCount; i++) {
                const child = node.child(i);
                if (!child || child.type === '"') continue;
                result += resolveNodeText(child);
            }
            return result;
        }
        default:
            return node.text;
    }
}

function extractArgv(node: Node): string[] {
    const argv: string[] = [];
    let consumedImplicitCommandName = false;

    for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (!child) continue;

        if (child.type === "command_name") {
            argv.push(resolveNodeText(child));
            consumedImplicitCommandName = true;
            continue;
        }

        if (child.type === "variable_assignment") continue;

        if (ARG_NODE_TYPES.has(child.type)) {
            if (!consumedImplicitCommandName) {
                argv.push(resolveNodeText(child));
                consumedImplicitCommandName = true;
                continue;
            }

            argv.push(resolveNodeText(child));
        }
    }

    return argv.filter(Boolean);
}

function extractCommandName(argv: string[]): string | undefined {
    const first = argv[0];
    return first ? basename(first) : undefined;
}

function extractRedirect(node: Node): BashRedirect {
    let operator = node.text.trim();
    let target: string | undefined;

    for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (!child) continue;

        if (ARG_NODE_TYPES.has(child.type)) {
            target = resolveNodeText(child);
            continue;
        }

        if (
            child.type.includes("redirect") ||
            child.type === ">" ||
            child.type === ">>" ||
            child.type === "<&" ||
            child.type === ">&" ||
            child.type === "<"
        ) {
            operator = child.text;
        }
    }

    if (target && operator.includes(target)) {
        operator = operator.slice(0, operator.indexOf(target)).trim();
    }

    return {
        operator: operator || node.text.trim(),
        ...(target === undefined ? {} : { target }),
    };
}

function classifyTokenAsPathCandidate(token: string): string | null {
    if (!token) return null;
    if (token.startsWith("-")) return null;

    const eqIndex = token.indexOf("=");
    const slashIndex = token.indexOf("/");
    if (eqIndex !== -1 && (slashIndex === -1 || eqIndex < slashIndex)) {
        return null;
    }

    if (URL_PATTERN.test(token)) return null;
    if (token.startsWith("@") && !token.startsWith("@/")) return null;
    if (/^\/+$/u.test(token)) return null;
    if (REGEX_METACHAR_PATTERN.test(token)) return null;

    if (token.startsWith(".")) return token;
    if (token.includes("/")) return token;
    if (token.startsWith("~/")) return token;
    if (token.includes("..")) return token;

    return null;
}

function walk(node: Node, facts: BashFacts): void {
    if (SKIP_SUBTREE_TYPES.has(node.type)) return;

    const construct = SHELL_CONSTRUCT_TYPES[node.type];
    if (construct) facts.constructs.push(construct);
    if (node.type === "variable_assignment" && /^PATH\s*=/u.test(node.text)) {
        facts.constructs.push("path-assignment");
    }

    if (node.type === "pipeline") {
        facts.hasPipe = true;
    }

    if (node.type === "command") {
        const argv = extractArgv(node);
        if (argv[0]?.includes("$") || argv[0]?.includes("`")) {
            facts.constructs.push("dynamic-command-name");
        }
        const name = extractCommandName(argv);
        const subcommand = argv[1];
        facts.commands.push({
            ...(name === undefined ? {} : { name }),
            ...(subcommand === undefined ? {} : { subcommand }),
            argv,
            flags: argv.filter((arg, index) => index > 0 && arg.startsWith("-")),
        });

        for (const arg of argv.slice(1)) {
            const pathCandidate = classifyTokenAsPathCandidate(arg);
            if (pathCandidate) facts.pathCandidates.push(pathCandidate);
        }
    }

    if (node.type === "file_redirect") {
        const redirect = extractRedirect(node);
        facts.redirects.push(redirect);
        if (redirect.target) {
            const pathCandidate = classifyTokenAsPathCandidate(redirect.target);
            if (pathCandidate) facts.pathCandidates.push(pathCandidate);
        }
    }

    for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) walk(child, facts);
    }
}

export async function extractBashFacts(command: string): Promise<BashFacts> {
    const parser = await getParser();
    const tree = parser.parse(command);
    if (!tree) {
        return {
            text: command,
            commands: [],
            redirects: [],
            pathCandidates: [],
            constructs: [],
            hasPipe: false,
            hasParseError: true,
        };
    }

    const facts: BashFacts = {
        text: command,
        commands: [],
        redirects: [],
        pathCandidates: [],
        constructs: [],
        hasPipe: false,
        hasParseError: tree.rootNode.hasError,
    };

    try {
        walk(tree.rootNode, facts);
    } finally {
        tree.delete();
    }

    facts.pathCandidates = [...new Set(facts.pathCandidates)];
    facts.constructs = [...new Set(facts.constructs)];
    return facts;
}
