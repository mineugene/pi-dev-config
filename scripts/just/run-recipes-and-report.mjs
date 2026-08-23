#!/usr/bin/env node
import { spawnSync } from "node:child_process";

function printUsageAndExit() {
    console.error("Usage: run-recipes-and-report.mjs <label> <recipe> [recipe...]");
    process.exit(2);
}

const [label, ...recipes] = process.argv.slice(2);
if (!label || recipes.length === 0) {
    printUsageAndExit();
}

let status = 0;
for (const [offset, recipe] of recipes.entries()) {
    const result = spawnSync("just", [recipe], {
        env: {
            ...process.env,
            JUST_STEP_INDEX: String(offset + 1),
            JUST_STEP_TOTAL: String(recipes.length),
        },
        stdio: "inherit",
    });

    status = result.status ?? 1;
    if (status !== 0) {
        break;
    }
}

const outcome = status === 0 ? "OK" : "FAIL";
const colour = status === 0 ? 32 : 31;
process.stdout.write(`\x1b[36m==> \x1b[0m[${label}] \x1b[${colour}m${outcome}\x1b[0m\n`);
if (status !== 0) {
    process.stdout.write(`exited with status code ${status}\n`);
}

process.exit(status);
