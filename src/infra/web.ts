import { extractWebContent, selectWebContent } from "../domain/web-content.ts";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 10_000;

export interface WebSearchResult {
    title: string;
    url: string;
    snippet: string;
    published?: string;
    source?: string;
}

function privateHost(hostname: string): boolean {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return (
        host === "localhost" ||
        host === "::1" ||
        /^127\./.test(host) ||
        /^10\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^169\.254\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
        /^fc|^fd|^fe80:/i.test(host)
    );
}

export function safeWebUrl(value: string): URL {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Error("web_read: invalid URL");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:")
        throw new Error("web_read: only http and https URLs are supported");
    if (privateHost(url.hostname)) throw new Error("web_read: blocked private-network destination");
    return url;
}

function requestSignal(signal?: AbortSignal, timeoutMs = TIMEOUT_MS): AbortSignal {
    return signal
        ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs);
}

export async function searchBrave(
    query: string,
    limit: number,
    signal?: AbortSignal,
): Promise<WebSearchResult[]> {
    const key = process.env.WEB_SEARCH_API_KEY;
    if (!key) throw new Error("web_search: missing API credential WEB_SEARCH_API_KEY");
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(limit));
    let response: Response;
    try {
        response = await fetch(url.toString(), {
            headers: { Accept: "application/json", "X-Subscription-Token": key },
            signal: requestSignal(signal, 8_000),
        });
    } catch (error) {
        if (signal?.aborted) throw error;
        throw new Error("web_search: request timed out or failed");
    }
    if (!response.ok) throw new Error(`web_search: provider returned HTTP ${response.status}`);
    const body = (await response.json()) as {
        web?: {
            results?: Array<{
                title?: unknown;
                url?: unknown;
                description?: unknown;
                age?: unknown;
            }>;
        };
    };
    return (body.web?.results ?? []).flatMap((item) =>
        typeof item.title === "string" && typeof item.url === "string"
            ? [
                  {
                      title: item.title,
                      url: item.url,
                      snippet:
                          typeof item.description === "string"
                              ? item.description.slice(0, 600)
                              : "",
                      ...(typeof item.age === "string" ? { published: item.age } : {}),
                  },
              ]
            : [],
    );
}

export async function readWebPage(
    value: string,
    options: { query?: string; maxTokens: number; maxResponseBytes?: number; timeoutMs?: number },
    signal?: AbortSignal,
): Promise<{
    title?: string;
    url: string;
    content: string;
    truncated: boolean;
    estimatedTokens: number;
}> {
    let url = safeWebUrl(value);
    let response: Response;
    try {
        const request = {
            headers: {
                Accept: "text/html,text/markdown,text/plain,application/xhtml+xml",
                "User-Agent": "pi-dev-config-web/1.0",
            },
            redirect: "manual" as const,
            signal: requestSignal(signal, options.timeoutMs),
        };
        for (let redirects = 0; ; redirects++) {
            response = await fetch(url, request);
            if (![301, 302, 303, 307, 308].includes(response.status)) break;
            if (redirects >= 3) throw new Error("web_read: too many redirects");
            const location = response.headers.get("location");
            if (!location) throw new Error("web_read: redirect missing location");
            url = safeWebUrl(new URL(location, url).toString());
        }
    } catch (error) {
        if (signal?.aborted) throw error;
        throw new Error(
            `web_read: request timed out after ${(options.timeoutMs ?? TIMEOUT_MS) / 1000}s`,
        );
    }
    if (!response.ok) throw new Error(`web_read: request failed with HTTP ${response.status}`);
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase() ?? "";
    if (!/^(text\/(html|plain|markdown)|application\/xhtml\+xml)$/.test(contentType))
        throw new Error(`web_read: unsupported content type ${contentType || "unknown"}`);
    const maximum = options.maxResponseBytes ?? MAX_RESPONSE_BYTES;
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > maximum)
        throw new Error("web_read: response exceeds size limit");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maximum) throw new Error("web_read: response exceeds size limit");
    const extracted = extractWebContent(new TextDecoder().decode(bytes), contentType);
    if (!extracted.markdown)
        throw new Error(
            "web_read: page fetched successfully but no readable main content was found",
        );
    const selected = selectWebContent(extracted.markdown, options.query, options.maxTokens);
    return {
        ...selected,
        ...(extracted.title ? { title: extracted.title } : {}),
        url: url.toString(),
    };
}
