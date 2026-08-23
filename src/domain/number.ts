/** Coerce an unknown to a finite number, or 0 when it is not one. */
export function finiteNumberOrZero(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
