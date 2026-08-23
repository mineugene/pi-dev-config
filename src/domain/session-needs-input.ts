const OPTIONAL_OFFER =
    /\b(?:want me to|would you like me to|shall i|let me know if|if you(?:'d| would) like)\b/iu;

const REQUIRED_INPUT = [
    /\b(?:i|we) need .{1,160}\bbefore (?:i|we) can (?:continue|proceed|finish|start)\b/iu,
    /\b(?:cannot|can't) (?:continue|proceed|finish|start) (?:until|without)\b/iu,
    /\bplease (?:choose|select|provide|confirm|reply with)\b/iu,
    /\b(?:which|what) .{1,160}\bshould (?:i|we) (?:use|choose|target|implement|do)\?/iu,
    /\bmissing (?:required )?(?:information|details|credentials|configuration)\b/iu,
];

/** Conservatively flag only explicit statements that useful work is blocked on the user. */
export function needsUserInput(text: string | undefined): boolean {
    if (!text) return false;
    const tail = text.trim().slice(-1_000);
    if (!tail || OPTIONAL_OFFER.test(tail)) return false;
    return REQUIRED_INPUT.some((pattern) => pattern.test(tail));
}
