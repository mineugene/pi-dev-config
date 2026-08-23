import { expect, test } from "vitest";

import { buildNeedles, parseValues, scrubSecrets } from "./secret-guard.ts";

test("a non-credential dotenv value never becomes a redaction needle", () => {
    const values = parseValues("LOGNAME=arcmin60\nEDITOR=vim\n", "/app/.env");
    const needles = buildNeedles(values, 6);
    expect(needles).toEqual([]);
    expect(scrubSecrets("/home/arcmin60/.config", needles)).toBe("/home/arcmin60/.config");
});

test("a credential-named dotenv value is scrubbed", () => {
    const values = parseValues("API_KEY=abc123456\nLOGNAME=arcmin60\n", "/app/.env");
    const needles = buildNeedles(values, 6);
    expect(scrubSecrets("key abc123456 host arcmin60", needles)).toBe(
        "key ***REDACTED*** host arcmin60",
    );
});

test("export-prefixed credential keys are recognized", () => {
    const values = parseValues("export AWS_SECRET_ACCESS_KEY=abcd1234\n", "/app/.envrc");
    expect(buildNeedles(values, 6)).toContain("abcd1234");
});

test("JSON configs still contribute every string", () => {
    const values = parseValues('{"user":"arcmin60","note":"hello there"}', "/app/creds.json");
    expect(values).toEqual(["arcmin60", "hello there"]);
});

test("common credential key names are recognized", () => {
    const values = parseValues(
        "DB_PASSWORD=hunter2xyz\nGH_TOKEN=ghp_abcd1234\nOPENAI_API_KEY=sk-abcd1234\n",
        "/app/.env",
    );
    const needles = buildNeedles(values, 6);
    expect(needles).toContain("hunter2xyz");
    expect(needles).toContain("ghp_abcd1234");
    expect(needles).toContain("sk-abcd1234");
});

test("values shorter than minSecretLen are dropped", () => {
    const values = parseValues("TOKEN=true\nTOKEN=abcd1234\n", "/app/.env");
    expect(buildNeedles(values, 6)).toContain("abcd1234");
    expect(buildNeedles(values, 6)).not.toContain("true");
});
