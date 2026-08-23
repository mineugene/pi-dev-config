#!/usr/bin/env node
import { TrackerClient } from "./client.ts";

const [command, first, second] = process.argv.slice(2);
const client = new TrackerClient();

async function main(): Promise<number> {
    switch (command) {
        case "focus-next": {
            const response = await client.focusNext(first || undefined, second || undefined);
            if (response?.ok) return 0;
            process.stderr.write(`${response?.error ?? "Session tracker is unavailable."}\n`);
            return 1;
        }
        case "focus-pane": {
            if (!first) {
                process.stderr.write("Usage: pi-session-tracker focus-pane <pane-id> [client]\n");
                return 2;
            }
            const response = await client.focusPane(first, second || undefined);
            if (response?.ok) return 0;
            process.stderr.write(`${response?.error ?? "Session tracker is unavailable."}\n`);
            return 1;
        }
        case "snapshot": {
            const records = await client.snapshot();
            if (!records) return 1;
            process.stdout.write(`${JSON.stringify(records)}\n`);
            return 0;
        }
        case "shutdown":
            return (await client.shutdown()) ? 0 : 1;
        default:
            process.stderr.write(
                "Usage: pi-session-tracker <focus-next|focus-pane|snapshot|shutdown> [args]\n",
            );
            return 2;
    }
}

process.exitCode = await main();
