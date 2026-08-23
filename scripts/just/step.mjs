#!/usr/bin/env node
const [message] = process.argv.slice(2);
const index = process.env.JUST_STEP_INDEX ?? "1";
const total = process.env.JUST_STEP_TOTAL ?? "1";

if (!message) {
    console.error("Usage: step.mjs <message>");
    process.exit(2);
}

process.stdout.write(`\x1b[36m==> \x1b[0m(${index}/${total}) ${message}\n`);
