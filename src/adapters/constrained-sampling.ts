/**
 * Constrained-sampling preference shared by the config's own tools.
 *
 * Mirrors what pi's built-in tools advertise since 0.86: ask providers that
 * support it to sample strictly against the tool's JSON schema, and fall back
 * silently where they do not.
 */

import type { ConstrainedSamplingConfig } from "@earendil-works/pi-ai";

export const STRICT_PREFER_SAMPLING: ConstrainedSamplingConfig = {
    type: "json_schema",
    strict: "prefer",
};
