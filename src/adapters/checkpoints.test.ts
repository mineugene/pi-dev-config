import { expect, test } from "vitest";
import { parseCheckpointStore } from "./checkpoints.ts";

const checkpoint = {
    id: "1",
    createdAt: "2026-07-15T00:00:00.000Z",
    label: "after edit",
    files: { "src/index.ts": { exists: true, blob: "abc123" } },
};

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
