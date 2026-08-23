import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolveSearchScope } from "./search-scope.ts";

const root = mkdtempSync(path.join(tmpdir(), "pi-search-scope-"));
const workspace = path.join(root, "workspace");
const external = path.join(root, "external");

beforeAll(() => {
    mkdirSync(path.join(workspace, "src"), { recursive: true });
    mkdirSync(external, { recursive: true });
    writeFileSync(path.join(external, "flake.nix"), "");
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("resolveSearchScope", () => {
    it("keeps workspace-relative constraints on the workspace index", () => {
        expect(resolveSearchScope("src", workspace)).toEqual({
            root: workspace,
            path: "src",
        });
    });

    it("relativizes absolute paths inside the workspace", () => {
        expect(resolveSearchScope(path.join(workspace, "src"), workspace)).toEqual({
            root: workspace,
            path: "src",
        });
    });

    it("uses an external directory as its own index root", () => {
        expect(resolveSearchScope(external, workspace)).toEqual({
            root: external,
            path: undefined,
        });
    });

    it("keeps external files and globs as constraints below an existing root", () => {
        expect(resolveSearchScope(path.join(external, "flake.nix"), workspace)).toEqual({
            root: external,
            path: "flake.nix",
        });
        expect(resolveSearchScope(path.join(external, "**", "*.nix"), workspace)).toEqual({
            root: external,
            path: "**/*.nix",
        });
    });

    it("expands home-relative paths", () => {
        expect(resolveSearchScope("~/external", workspace, root)).toEqual({
            root: external,
            path: undefined,
        });
    });
});
