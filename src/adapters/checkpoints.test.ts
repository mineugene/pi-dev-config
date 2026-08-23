import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { cwdRelative, ensureGit, parseCheckpointStore } from "./checkpoints.ts";

const checkpoint = {
    id: "1",
    createdAt: "2026-07-15T00:00:00.000Z",
    label: "after edit",
    files: { "src/index.ts": { exists: true, blob: "abc123" } },
};

async function tempGitDir() {
    const dir = await mkdtemp(join(tmpdir(), "pidev-checkpoints-"));
    return join(dir, "objects.git");
}

test("ensureGit inits one valid repo under concurrent calls", async () => {
    const gitDir = await tempGitDir();
    await Promise.all(Array.from({ length: 8 }, () => ensureGit(gitDir)));
    expect(existsSync(join(gitDir, "HEAD"))).toBe(true);
    expect(existsSync(join(gitDir, "objects"))).toBe(true);
});

test("ensureGit recovers from a partially initialized directory", async () => {
    const gitDir = await tempGitDir();
    await mkdir(gitDir, { recursive: true });
    await ensureGit(gitDir);
    expect(existsSync(join(gitDir, "HEAD"))).toBe(true);
});

test("ensureGit reports git stderr when init fails and leaves nothing behind", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pidev-checkpoints-"));
    const gitDir = join(dir, "objects.git");
    await writeFile(gitDir, "not a directory");
    await expect(ensureGit(gitDir)).rejects.toThrow(/git init failed \(128\):/);
    expect(existsSync(gitDir)).toBe(false);
});

test("cwdRelative expands home-relative tool paths", () => {
    const home = homedir();
    expect(cwdRelative(home, "~/notes.md")).toBe("notes.md");
    expect(cwdRelative("/repo", "src/index.ts")).toBe(join("src", "index.ts"));
    expect(cwdRelative("/repo", "/outside/file.ts")).toBeNull();
    expect(cwdRelative("/repo", "~/../outside.md")).toBeNull();
});

test("parses valid checkpoint stores and rejects malformed file state", () => {
    expect(parseCheckpointStore({ version: 1, checkpoints: [checkpoint] })).toEqual({
        version: 1,
        checkpoints: [checkpoint],
    });
    expect(
        parseCheckpointStore({
            version: 1,
            checkpoints: [{ ...checkpoint, files: { "src/index.ts": { exists: true } } }],
        }),
    ).toBeUndefined();
});
