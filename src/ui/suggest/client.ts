/**
 * Client for `POST /api/suggest` (contract: src/shared/suggest.ts). Silent by design: any network
 * error, non-200, bad body or being offline means "no suggestion" ("").
 */
import { SUGGEST_LIMITS, type SuggestRequest, type SuggestResponse } from "../../shared/suggest";
import { Lru } from "./cache";
import { cacheKey, cleanGhost } from "./rules";

const cache = new Lru<string>(100);

/** A cached continuation for this request, or undefined if it was never asked. */
export function cachedSuggestion(req: SuggestRequest): string | undefined {
  return cache.get(cacheKey(req));
}

/** Asks the Worker for a continuation of `req.before`; resolves to "" on any failure or abort. */
export async function requestSuggestion(req: SuggestRequest, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<string> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "";
  const body = JSON.stringify(req);
  if (new TextEncoder().encode(body).length > SUGGEST_LIMITS.body) return "";
  try {
    const res = await fetchImpl("/api/suggest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal,
    });
    if (res.status !== 200) return "";
    const data = (await res.json()) as Partial<SuggestResponse> | null;
    const text = cleanGhost(data?.text);
    if (!signal.aborted) cache.set(cacheKey(req), text);
    return text;
  } catch {
    return "";
  }
}

/** For tests. */
export function clearSuggestionCache() {
  cache.clear();
}
