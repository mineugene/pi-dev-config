#!/usr/bin/env node
import { spawnSync } from "node:child_process";

function printUsageAndExit() {
    console.error("Usage: run-if-present.mjs <command> [args...]");
    process.exit(2);
}

const [command, ...args] = process.argv.slice(2);
if (!command) {
    printUsageAndExit();
}

const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
});

if (result.error) {
    const code = result.error.code;
    if (code === "ENOENT") {
        console.log("    Skipped");
        process.exit(0);
    }

    throw result.error;
}

if (typeof result.status === "number") {
    process.exit(result.status);
}

if (result.signal) {
    console.error(`${command} terminated by signal ${result.signal}.`);
}

process.exit(1);
