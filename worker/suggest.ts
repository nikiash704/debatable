/**
 * `POST /api/suggest`: AI sentence suggestions (ghost text) through OpenRouter's free models.
 * Plan: docs/plans/ai-suggestions.md (Phase 1a). Contract: src/shared/suggest.ts.
 *
 * Pure and runtime-free on purpose: the Worker wires in the real fetch, room lookup, quota
 * Durable Object and Cache API (worker/index.ts); the unit tests inject fakes and run in Node.
 *
 * Rules: the client sends structured context, never a prompt; every failure (no key, quota used up,
 * upstream error, timeout) is a quiet `200 { text: "" }`; the key, the user's text and upstream error
 * bodies are never logged or returned.
 */
import { SUGGEST_CONFIG } from "../src/config/suggest";
import { isValidCode } from "../src/shared/code";
import { SUGGEST_LIMITS, type SuggestField, type SuggestRequest, type SuggestResponse } from "../src/shared/suggest";
import { buildMessages, postProcess, type ChatMessage } from "../src/shared/suggest-prompt";

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** Soft per-device limit (device ids are client-chosen, so this is only a brake on one busy tab). */
export const DEVICE_PER_MINUTE = 6;
/** Soft per-IP limit (catches a script that rotates device ids). Two partners behind one NAT fit. */
export const IP_PER_MINUTE = 15;
/** How long a positive "room exists" answer is trusted in this isolate. */
const ROOM_CACHE_MS = 10 * 60_000;
const ROOM_CACHE_ITEMS = 1000;
/** Answers cache: Cache API TTL and the per-isolate memory copy. */
export const ANSWER_TTL_S = 24 * 60 * 60;
const MEMORY_CACHE_ITEMS = 500;
/** Upstream 429 without an account-limit reset time (provider congestion): short global pause. */
const PROVIDER_BACKOFF_MS = 15_000;
const MAX_PROVIDER_BACKOFF_MS = 5 * 60_000;
/** Upstream 429 for the account limit (has X-RateLimit-Reset): pause until then, at most this long. */
const MAX_ACCOUNT_BACKOFF_MS = 25 * 60 * 60_000;

/** Benchmark requests may name one model, only from this free list. */
const isBenchModel = (id: string) => (SUGGEST_CONFIG.benchModels as readonly string[]).includes(id) && isFreeModel(id);

const FIELDS: readonly SuggestField[] = ["card", "point", "thesis", "motion", "doc-thesis", "doc-card", "doc-point"];
const DEVICE_RE = /^[\w-]{8,64}$/;
/** Short identifiers in the context (format id, side id, speech id). */
const SHORT_ITEM = 64;

// ---------------------------------------------------------------------------------------------
// Validation

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const onlyKeys = (o: Record<string, unknown>, allowed: readonly string[]) => Object.keys(o).every((k) => allowed.includes(k));
const str = (v: unknown, max: number, min = 0): v is string => typeof v === "string" && v.length >= min && v.length <= max;
const optStr = (v: unknown, max: number) => v === undefined || str(v, max);
const optList = (v: unknown) =>
  v === undefined ||
  (Array.isArray(v) && v.length <= SUGGEST_LIMITS.listItems && v.every((x) => str(x, SUGGEST_LIMITS.contextItem)));

/** Strictly checks a parsed body against the contract. Returns null when anything is off. */
export function parseSuggestRequest(raw: unknown): SuggestRequest | null {
  if (!isObject(raw) || !onlyKeys(raw, ["room", "device", "field", "before", "context", "model"])) return null;
  const { room, device, field, before, context: c, model } = raw;
  if (model !== undefined && !(typeof model === "string" && isBenchModel(model))) return null;
  if (!str(room, 16) || !isValidCode(room.toUpperCase())) return null;
  if (!str(device, 64) || !DEVICE_RE.test(device)) return null;
  if (typeof field !== "string" || !FIELDS.includes(field as SuggestField)) return null;
  if (!str(before, SUGGEST_LIMITS.before)) return null;
  if (!isObject(c)) return null;
  if (!onlyKeys(c, ["format", "side", "speech", "motion", "thesis", "card", "answers", "siblings"])) return null;
  if (!str(c.format, SHORT_ITEM, 1) || !str(c.side, SHORT_ITEM, 1) || !optStr(c.speech, SHORT_ITEM)) return null;
  const item = SUGGEST_LIMITS.contextItem;
  if (!optStr(c.motion, item) || !optStr(c.thesis, item) || !optStr(c.card, item)) return null;
  if (!optList(c.answers) || !optList(c.siblings)) return null;
  return {
    room: room.toUpperCase(),
    device,
    field: field as SuggestField,
    before,
    context: {
      format: c.format,
      side: c.side,
      ...(c.speech !== undefined && { speech: c.speech as string }),
      ...(c.motion !== undefined && { motion: c.motion as string }),
      ...(c.thesis !== undefined && { thesis: c.thesis as string }),
      ...(c.card !== undefined && { card: c.card as string }),
      ...(c.answers !== undefined && { answers: c.answers as string[] }),
      ...(c.siblings !== undefined && { siblings: c.siblings as string[] }),
    },
    ...(model !== undefined && { model: model as string }),
  };
}

/** Reads the body as UTF-8 text, giving up (null) past `cap` bytes or on invalid UTF-8. */
export async function readCappedText(request: Request, cap: number): Promise<string | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null && !(Number(declared) <= cap)) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Quota: one global counter (lives in the SuggestQuota Durable Object, worker/suggest-quota.ts)

export type QuotaVerdict = "ok" | "backoff" | "daily" | "minute" | "device" | "ip";

export interface QuotaLimits {
  /** Upstream calls per UTC day. */
  daily: number;
  /** Upstream calls per sliding minute, all users together. */
  perMinute: number;
  perDevice: number;
  perIp: number;
}

/** What survives a Durable Object restart. Minute windows are kept in memory only. */
export interface QuotaSnapshot {
  /** UTC day, "YYYY-MM-DD". */
  day: string;
  count: number;
  /** No upstream calls before this time (ms), after an upstream 429. */
  backoffUntil: number;
}

export interface QuotaStore {
  load(): QuotaSnapshot | null;
  save(s: QuotaSnapshot): void;
}

export function quotaLimits(): QuotaLimits {
  return {
    daily: Math.floor(SUGGEST_CONFIG.dailyCap * SUGGEST_CONFIG.dailyCapShare),
    perMinute: SUGGEST_CONFIG.perMinuteCap,
    perDevice: DEVICE_PER_MINUTE,
    perIp: IP_PER_MINUTE,
  };
}

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const MINUTE = 60_000;

/**
 * Counts upstream calls. Single-threaded by construction (one Durable Object), so `take` is atomic:
 * it either reserves one call against every limit or reserves nothing.
 */
export class QuotaCounter {
  readonly #store: QuotaStore;
  readonly #limits: QuotaLimits;
  #state: QuotaSnapshot;
  #recent: number[] = [];
  #perKey = new Map<string, number[]>();

  constructor(store: QuotaStore, limits: QuotaLimits) {
    this.#store = store;
    this.#limits = limits;
    this.#state = store.load() ?? { day: "", count: 0, backoffUntil: 0 };
  }

  take(now: number, device: string, ip: string): QuotaVerdict {
    if (now < this.#state.backoffUntil) return "backoff";
    const day = utcDay(now);
    const count = this.#state.day === day ? this.#state.count : 0;
    if (count >= this.#limits.daily) return "daily";
    const since = now - MINUTE;
    this.#recent = this.#recent.filter((t) => t > since);
    if (this.#recent.length >= this.#limits.perMinute) return "minute";
    if (this.#perKey.size > 2000) {
      for (const [k, ts] of this.#perKey) if (ts.every((t) => t <= since)) this.#perKey.delete(k);
    }
    const dKey = `d:${device}`;
    const dTimes = (this.#perKey.get(dKey) ?? []).filter((t) => t > since);
    if (dTimes.length >= this.#limits.perDevice) return "device";
    const iKey = ip ? `i:${ip}` : "";
    const iTimes = iKey ? (this.#perKey.get(iKey) ?? []).filter((t) => t > since) : [];
    if (iKey && iTimes.length >= this.#limits.perIp) return "ip";

    this.#recent.push(now);
    this.#perKey.set(dKey, [...dTimes, now]);
    if (iKey) this.#perKey.set(iKey, [...iTimes, now]);
    this.#state = { ...this.#state, day, count: count + 1 };
    this.#store.save(this.#state);
    return "ok";
  }

  /** Pause all upstream calls until `until` (ms). Never shortens an existing pause. */
  backoff(until: number): void {
    if (!(until > this.#state.backoffUntil)) return;
    this.#state = { ...this.#state, backoffUntil: until };
    this.#store.save(this.#state);
  }

  snapshot(): QuotaSnapshot {
    return { ...this.#state };
  }
}

/**
 * When to resume after an upstream 429. OpenRouter's own free-model limits carry
 * `X-RateLimit-Reset` (ms since epoch): wait for it. A provider-side 429 has at most `Retry-After`
 * (seconds or an HTTP date): a short pause, since the next call may route elsewhere.
 */
export function backoffUntil(headers: Headers, now: number): number {
  const reset = Number(headers.get("x-ratelimit-reset"));
  if (Number.isFinite(reset) && reset > 0) {
    const ms = reset < 1e12 ? reset * 1000 : reset; // tolerate seconds
    return Math.min(Math.max(ms, now + 1000), now + MAX_ACCOUNT_BACKOFF_MS);
  }
  const ra = headers.get("retry-after");
  let wait = PROVIDER_BACKOFF_MS;
  if (ra !== null) {
    const secs = Number(ra);
    if (Number.isFinite(secs) && ra.trim() !== "") wait = secs * 1000;
    else if (!Number.isNaN(Date.parse(ra))) wait = Date.parse(ra) - now;
  }
  return now + Math.min(Math.max(wait, 1000), MAX_PROVIDER_BACKOFF_MS);
}

// ---------------------------------------------------------------------------------------------
// Handler

/** Raw upstream answer, cached before post-processing so a postProcess change applies at once. */
export interface CachedAnswer {
  content: string;
  model?: string;
}

export interface AnswerCache {
  get(key: string): Promise<CachedAnswer | null>;
  put(key: string, value: CachedAnswer): Promise<void>;
}

export interface QuotaClient {
  take(device: string, ip: string): Promise<QuotaVerdict>;
  backoff(until: number): Promise<void>;
}

export interface SuggestDeps {
  /** `env.API_KEY_OPENROUTER`; empty or missing = feature off, quietly. */
  apiKey: string | undefined;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  roomExists: (code: string) => Promise<boolean>;
  quota: QuotaClient;
  cache?: AnswerCache | null;
  waitUntil?: (p: Promise<unknown>) => void;
  now?: () => number;
  /** Defaults to SUGGEST_CONFIG.timeoutMs. */
  timeoutMs?: number;
  /** Defaults to SUGGEST_CONFIG.models. */
  models?: readonly string[];
}

const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
const answer = (body: SuggestResponse) => json(body);
/**
 * No suggestion. `x-suggest-skip` says why (e.g. "quota-minute", "upstream-429", "timeout"), so the
 * benchmark can tell a quota stop from an empty model answer. Never contains user text or upstream detail.
 */
const none = (why: string) => json({ text: "" } satisfies SuggestResponse, 200, { "x-suggest-skip": why });

/** Free variants only: a paid fallback would be billed (OpenRouter bills the model that answered). */
export const isFreeModel = (id: string) => id.endsWith(":free") || id === "openrouter/free";

export interface UpstreamBody {
  /** The fallback list (normal use)... */
  models?: string[];
  /** ...or exactly one model (benchmark requests). */
  model?: string;
  messages: ChatMessage[];
  max_tokens: number;
  temperature: number;
  stop: string[];
  reasoning: { enabled: false };
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function remember<K, V>(map: Map<K, V>, key: K, value: V, cap: number) {
  map.delete(key);
  map.set(key, value);
  if (map.size > cap) map.delete(map.keys().next().value as K);
}

/**
 * Creates the handler. Keeps two small per-isolate caches (positive room lookups, recent answers),
 * so create it once at module level.
 */
export function createSuggestHandler() {
  const roomsSeen = new Map<string, number>();
  const memory = new Map<string, CachedAnswer & { expires: number }>();

  async function roomOk(code: string, deps: SuggestDeps, now: number): Promise<boolean> {
    const until = roomsSeen.get(code);
    if (until !== undefined && until > now) return true;
    const exists = await deps.roomExists(code);
    if (exists) remember(roomsSeen, code, now + ROOM_CACHE_MS, ROOM_CACHE_ITEMS);
    return exists;
  }

  async function cached(key: string, deps: SuggestDeps, now: number): Promise<CachedAnswer | null> {
    const hit = memory.get(key);
    if (hit && hit.expires > now) return hit;
    if (!deps.cache) return null;
    const found = await deps.cache.get(key).catch(() => null);
    if (found) remember(memory, key, { ...found, expires: now + ANSWER_TTL_S * 1000 }, MEMORY_CACHE_ITEMS);
    return found;
  }

  function store(key: string, value: CachedAnswer, deps: SuggestDeps, now: number) {
    remember(memory, key, { ...value, expires: now + ANSWER_TTL_S * 1000 }, MEMORY_CACHE_ITEMS);
    if (!deps.cache) return;
    const p = deps.cache.put(key, value).catch(() => {});
    if (deps.waitUntil) deps.waitUntil(p);
  }

  return async function handleSuggest(request: Request, deps: SuggestDeps): Promise<Response> {
    const now = deps.now?.() ?? Date.now();
    if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    if (origin !== null && origin !== url.origin) return json({ error: "forbidden" }, 403);

    const text = await readCappedText(request, SUGGEST_LIMITS.body);
    if (text === null) return json({ error: "invalid" }, 400);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return json({ error: "invalid" }, 400);
    }
    const req = parseSuggestRequest(raw);
    if (!req) return json({ error: "invalid" }, 400);

    if (!deps.apiKey) return none("no-key");
    if (!req.before.trim()) return none("blank");
    const models = req.model ? [req.model] : (deps.models ?? SUGGEST_CONFIG.models).filter(isFreeModel);
    if (models.length === 0) return none("no-model");
    // benchmark requests (one named model) skip the answers cache, so every call is a real measurement
    const useCache = !req.model;

    try {
      if (!(await roomOk(req.room, deps, now))) return json({ error: "room not found" }, 404);
    } catch {
      return none("room-lookup"); // transient, stay quiet
    }

    const messages = buildMessages(req);
    const body: UpstreamBody = {
      ...(req.model ? { model: req.model } : { models: [...models] }),
      messages,
      max_tokens: SUGGEST_CONFIG.maxTokens,
      temperature: SUGGEST_CONFIG.temperature,
      stop: ["\n"],
      reasoning: { enabled: false },
    };
    const key = await sha256Hex(JSON.stringify(body));

    const hit = useCache ? await cached(key, deps, now) : null;
    if (hit) {
      const t = postProcess(req.before, hit.content);
      return answer(hit.model ? { text: t, model: hit.model } : { text: t });
    }

    const ip = request.headers.get("cf-connecting-ip") ?? "";
    let verdict: QuotaVerdict;
    try {
      verdict = await deps.quota.take(req.device, ip);
    } catch {
      return none("quota-unavailable"); // no counter, no call: the shared budget is protected first
    }
    if (verdict !== "ok") return none(`quota-${verdict}`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? SUGGEST_CONFIG.timeoutMs);
    let content = "";
    let model: string | undefined;
    try {
      const res = await deps.fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${deps.apiKey}`,
          "content-type": "application/json",
          "http-referer": url.origin,
          "x-openrouter-title": "Debatable",
          "x-title": "Debatable",
          // keep the OpenRouter app page out of public rankings (only honoured when the app is first created)
          "x-openrouter-app-visibility": "hidden",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        if (res.status === 429) await deps.quota.backoff(backoffUntil(res.headers, now)).catch(() => {});
        console.warn(`suggest: upstream status ${res.status}`);
        await res.body?.cancel().catch(() => {});
        return none(`upstream-${res.status}`);
      }
      const data = (await res.json()) as {
        model?: unknown;
        error?: unknown;
        choices?: { message?: { content?: unknown } }[];
      };
      const c = data.choices?.[0]?.message?.content;
      if (data.error || typeof c !== "string") return none("upstream-empty");
      content = c;
      if (typeof data.model === "string") model = data.model;
    } catch {
      const why = controller.signal.aborted ? "timeout" : "fetch-failed";
      console.warn(`suggest: upstream ${why}`);
      return none(`upstream-${why}`);
    } finally {
      clearTimeout(timer);
    }

    const t = postProcess(req.before, content);
    if (t && useCache) store(key, model ? { content, model } : { content }, deps, now);
    return answer(model ? { text: t, model } : { text: t });
  };
}

/**
 * The Workers Cache API as an AnswerCache. Keys are synthetic URLs under the app's own origin.
 * Note: on a workers.dev hostname the Cache API may not persist anything (the per-isolate memory
 * cache in the handler still works); on a custom domain it caches per data center.
 */
export function workersCache(origin: string): AnswerCache | null {
  if (typeof caches === "undefined") return null;
  const cache = caches.default;
  const keyOf = (key: string) => new Request(`${origin}/__suggest-cache/v1/${key}`);
  return {
    async get(key) {
      const res = await cache.match(keyOf(key));
      if (!res) return null;
      const v = (await res.json()) as Partial<CachedAnswer>;
      if (typeof v.content !== "string") return null;
      return typeof v.model === "string" ? { content: v.content, model: v.model } : { content: v.content };
    },
    async put(key, value) {
      await cache.put(
        keyOf(key),
        new Response(JSON.stringify(value), {
          headers: { "content-type": "application/json", "cache-control": `public, max-age=${ANSWER_TTL_S}` },
        }),
      );
    },
  };
}
