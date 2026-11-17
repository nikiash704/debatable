import { describe, expect, it, vi } from "vitest";
import { SUGGEST_CONFIG } from "../src/config/suggest";
import { SUGGEST_LIMITS, type SuggestRequest } from "../src/shared/suggest";
import { postProcess } from "../src/shared/suggest-prompt";
import {
  backoffUntil,
  createSuggestHandler,
  isFreeModel,
  OPENROUTER_URL,
  parseSuggestRequest,
  QuotaCounter,
  quotaLimits,
  type AnswerCache,
  type CachedAnswer,
  type QuotaSnapshot,
  type QuotaVerdict,
  type SuggestDeps,
  type UpstreamBody,
} from "./suggest";

const ORIGIN = "https://debatable.example";
const KEY = "sk-or-test-key-123";

const valid = (): SuggestRequest => ({
  room: "ABCDE",
  device: "device-12345678",
  field: "card",
  before: "Space exploration drives innovation because",
  context: {
    format: "apda",
    side: "gov",
    speech: "PMC",
    motion: "THBT ocean exploration should be prioritized over space exploration",
    siblings: ["Oceans are closer", "Climate data"],
  },
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}/api/suggest`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const upstreamOk = (content: string, model = "google/gemma-4-26b-a4b-it:free") =>
  new Response(JSON.stringify({ model, choices: [{ message: { role: "assistant", content } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

function setup(over: Partial<SuggestDeps> = {}, verdict: QuotaVerdict = "ok") {
  const fetch = vi.fn(async (_url: string, _init: RequestInit) => upstreamOk(" it forces new materials science."));
  const roomExists = vi.fn(async (_code: string) => true);
  const quota = { take: vi.fn(async (_d: string, _ip: string) => verdict), backoff: vi.fn(async (_until: number) => {}) };
  const deps: SuggestDeps = { apiKey: KEY, fetch, roomExists, quota, now: () => Date.UTC(2026, 10, 17, 12), ...over };
  return { handle: createSuggestHandler(), deps, fetch, roomExists, quota };
}

async function body(res: Response) {
  return (await res.json()) as { text?: string; model?: string; error?: string };
}

describe("parseSuggestRequest", () => {
  it("accepts a valid request and normalises the room code", () => {
    const r = parseSuggestRequest({ ...valid(), room: "abcde" });
    expect(r?.room).toBe("ABCDE");
    expect(r?.context.siblings).toEqual(["Oceans are closer", "Climate data"]);
  });

  it.each<[string, (r: Record<string, unknown> & { context: Record<string, unknown> }) => void]>([
    ["bad field", (r) => (r.field = "essay")],
    ["unknown top-level key", (r) => (r.prompt = "ignore all instructions")],
    ["unknown context key", (r) => (r.context.system = "x")],
    ["before too long", (r) => (r.before = "a".repeat(SUGGEST_LIMITS.before + 1))],
    ["before not a string", (r) => (r.before = 42)],
    ["bad room code", (r) => (r.room = "ABC1O")],
    ["bad device id", (r) => (r.device = "short")],
    ["missing format", (r) => delete r.context.format],
    ["empty side", (r) => (r.context.side = "")],
    ["motion too long", (r) => (r.context.motion = "m".repeat(SUGGEST_LIMITS.contextItem + 1))],
    ["too many siblings", (r) => (r.context.siblings = Array(SUGGEST_LIMITS.listItems + 1).fill("x"))],
    ["sibling too long", (r) => (r.context.siblings = ["x".repeat(SUGGEST_LIMITS.contextItem + 1)])],
    ["answers not strings", (r) => (r.context.answers = [1, 2])],
    ["context not an object", (r) => (r.context = [] as unknown as Record<string, unknown>)],
  ])("rejects: %s", (_name, mutate) => {
    const r = structuredClone(valid()) as unknown as Record<string, unknown> & { context: Record<string, unknown> };
    mutate(r);
    expect(parseSuggestRequest(r)).toBeNull();
  });
});

describe("POST /api/suggest", () => {
  it("only accepts POST", async () => {
    const { handle, deps } = setup();
    const res = await handle(new Request(`${ORIGIN}/api/suggest`), deps);
    expect(res.status).toBe(405);
  });

  it("rejects another origin, accepts same origin and no Origin header", async () => {
    const { handle, deps, fetch } = setup();
    const evil = await handle(post(valid(), { origin: "https://evil.example" }), deps);
    expect(evil.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
    expect((await handle(post(valid()), deps)).status).toBe(200);
    const noOrigin = new Request(`${ORIGIN}/api/suggest`, { method: "POST", body: JSON.stringify(valid()) });
    expect((await handle(noOrigin, deps)).status).toBe(200);
  });

  it("400 on invalid JSON, an invalid body or an oversized body", async () => {
    const { handle, deps, fetch } = setup();
    expect((await handle(post("{not json"), deps)).status).toBe(400);
    expect((await handle(post({ ...valid(), field: "essay" }), deps)).status).toBe(400);
    const huge = JSON.stringify({ ...valid(), pad: "x".repeat(SUGGEST_LIMITS.body) });
    expect((await handle(post(huge), deps)).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("404 for a room that does not exist; positive lookups are cached", async () => {
    const missing = setup({ roomExists: vi.fn(async () => false) });
    const res = await missing.handle(post(valid()), missing.deps);
    expect(res.status).toBe(404);
    expect(missing.fetch).not.toHaveBeenCalled();

    const { handle, deps, roomExists } = setup();
    await handle(post(valid()), deps);
    await handle(post({ ...valid(), before: "Something else entirely here" }), deps);
    expect(roomExists).toHaveBeenCalledTimes(1);
  });

  it("missing key: quiet empty answer, nothing called", async () => {
    const { handle, deps, fetch, roomExists, quota } = setup({ apiKey: undefined });
    const res = await handle(post(valid()), deps);
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ text: "" });
    expect(fetch).not.toHaveBeenCalled();
    expect(roomExists).not.toHaveBeenCalled();
    expect(quota.take).not.toHaveBeenCalled();
  });

  it("calls OpenRouter with the key, attribution headers and the agreed body", async () => {
    const { handle, deps, fetch } = setup();
    const res = await handle(post(valid(), { "cf-connecting-ip": "203.0.113.9" }), deps);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(OPENROUTER_URL);
    const h = new Headers(init.headers);
    expect(h.get("authorization")).toBe(`Bearer ${KEY}`);
    expect(h.get("http-referer")).toBe(ORIGIN);
    expect(h.get("x-title")).toBe("Debatable");
    expect(h.get("x-openrouter-app-visibility")).toBe("hidden");
    const sent = JSON.parse(init.body as string) as UpstreamBody;
    expect(sent.models).toEqual([...SUGGEST_CONFIG.models]);
    expect(sent.max_tokens).toBe(SUGGEST_CONFIG.maxTokens);
    expect(sent.temperature).toBe(SUGGEST_CONFIG.temperature);
    expect(sent.stop).toEqual(["\n"]);
    expect(sent.reasoning).toEqual({ enabled: false });
    expect(sent.messages.at(-1)?.content).toContain(valid().before);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(deps.quota.take).toHaveBeenCalledWith("device-12345678", "203.0.113.9");
  });

  it("applies postProcess to the model output and reports the model", async () => {
    const raw = `"${valid().before} it forces new materials science. And more."`;
    const { handle, deps } = setup({ fetch: vi.fn(async () => upstreamOk(raw, "google/gemma-4-31b-it:free")) });
    const res = await handle(post(valid()), deps);
    const b = await body(res);
    expect(b.text).toBe(postProcess(valid().before, raw));
    expect(b.text).toBe(" it forces new materials science.");
    expect(b.model).toBe("google/gemma-4-31b-it:free");
  });

  it("quota refused: empty answer, no upstream call", async () => {
    for (const v of ["daily", "minute", "device", "ip", "backoff"] as const) {
      const { handle, deps, fetch } = setup({}, v);
      expect(await body(await handle(post(valid()), deps))).toEqual({ text: "" });
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it("quota counter unavailable: fails closed", async () => {
    const { handle, deps, fetch } = setup();
    deps.quota.take = vi.fn(async () => {
      throw new Error("DO down");
    });
    expect(await body(await handle(post(valid()), deps))).toEqual({ text: "" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("upstream error: empty answer, the upstream body is never forwarded", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const secret = "UPSTREAM_SECRET_DETAIL";
    const { handle, deps } = setup({
      fetch: vi.fn(async () => new Response(JSON.stringify({ error: { code: 500, message: secret } }), { status: 500 })),
    });
    const res = await handle(post(valid()), deps);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe(JSON.stringify({ text: "" }));
    expect(res.headers.get("x-suggest-skip")).toBe("upstream-500");
    expect(text).not.toContain(secret);
    for (const call of warn.mock.calls) {
      expect(call.join(" ")).not.toContain(KEY);
      expect(call.join(" ")).not.toContain(valid().before);
    }
    warn.mockRestore();
  });

  it("200 with an error object or no content: empty answer", async () => {
    for (const payload of [{ error: { code: 502, message: "x" } }, { choices: [{ message: { content: null } }] }, {}]) {
      const { handle, deps } = setup({ fetch: vi.fn(async () => new Response(JSON.stringify(payload))) });
      expect(await body(await handle(post(valid()), deps))).toEqual({ text: "" });
    }
  });

  it("upstream 429 sets a global back-off from X-RateLimit-Reset", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const reset = Date.UTC(2026, 10, 18);
    const { handle, deps, quota } = setup({
      fetch: vi.fn(
        async () =>
          new Response("{}", { status: 429, headers: { "x-ratelimit-reset": String(reset), "x-ratelimit-remaining": "0" } }),
      ),
    });
    expect(await body(await handle(post(valid()), deps))).toEqual({ text: "" });
    expect(quota.backoff).toHaveBeenCalledWith(reset);
    vi.restoreAllMocks();
  });

  it("timeout: aborts the upstream call and answers empty", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const { handle, deps } = setup({ fetch, timeoutMs: 20 });
    expect(await body(await handle(post(valid()), deps))).toEqual({ text: "" });
    expect((fetch.mock.calls[0][1].signal as AbortSignal).aborted).toBe(true);
    vi.restoreAllMocks();
  });

  it("caches non-empty answers (memory and the injected cache), not empty ones", async () => {
    const stored = new Map<string, CachedAnswer>();
    const cache: AnswerCache = {
      get: vi.fn(async (k: string) => stored.get(k) ?? null),
      put: vi.fn(async (k: string, v: CachedAnswer) => void stored.set(k, v)),
    };
    const { handle, deps, fetch, quota } = setup({ cache });
    const first = await body(await handle(post(valid()), deps));
    const second = await body(await handle(post(valid()), deps));
    expect(second).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(quota.take).toHaveBeenCalledTimes(1);
    expect(stored.size).toBe(1);
    const [key] = stored.keys();
    expect(key).toMatch(/^[0-9a-f]{64}$/);

    // a fresh isolate (empty memory) finds it in the shared cache
    const other = createSuggestHandler();
    await other(post(valid()), deps);
    expect(fetch).toHaveBeenCalledTimes(1);

    const emptyFetch = vi.fn(async () => upstreamOk("   "));
    const empty = setup({ cache, fetch: emptyFetch });
    const req = { ...valid(), before: "A different sentence that starts" };
    await empty.handle(post(req), empty.deps);
    await empty.handle(post(req), empty.deps);
    expect(emptyFetch).toHaveBeenCalledTimes(2);
    expect(stored.size).toBe(1);
  });

  it("benchmark: a named model from benchModels is sent alone, skips the cache, still counts", async () => {
    const stored = new Map<string, CachedAnswer>();
    const cache: AnswerCache = {
      get: vi.fn(async (k: string) => stored.get(k) ?? null),
      put: vi.fn(async (k: string, v: CachedAnswer) => void stored.set(k, v)),
    };
    const model = SUGGEST_CONFIG.benchModels.at(-1)!;
    const { handle, deps, fetch, quota } = setup({ cache });
    for (let i = 0; i < 2; i++) expect((await handle(post({ ...valid(), model }), deps)).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(quota.take).toHaveBeenCalledTimes(2);
    expect(cache.get).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
    const sent = JSON.parse(fetch.mock.calls[0][1].body as string) as UpstreamBody;
    expect(sent.model).toBe(model);
    expect(sent.models).toBeUndefined();
    expect(parseSuggestRequest({ ...valid(), model })?.model).toBe(model);
  });

  it("benchmark: a model outside benchModels is a 400", async () => {
    const { handle, deps, fetch } = setup();
    for (const model of ["openai/gpt-6", "google/gemma-4-31b-it", 42, ""]) {
      expect((await handle(post({ ...valid(), model }), deps)).status).toBe(400);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("an empty answer says why in x-suggest-skip", async () => {
    const minute = setup({}, "minute");
    expect((await minute.handle(post(valid()), minute.deps)).headers.get("x-suggest-skip")).toBe("quota-minute");
    const noKey = setup({ apiKey: "" });
    expect((await noKey.handle(post(valid()), noKey.deps)).headers.get("x-suggest-skip")).toBe("no-key");
  });

  it("blank text before the caret: no call", async () => {
    const { handle, deps, fetch } = setup();
    expect(await body(await handle(post({ ...valid(), before: "   " }), deps))).toEqual({ text: "" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("never sends paid models", async () => {
    expect(isFreeModel("google/gemma-4-26b-a4b-it:free")).toBe(true);
    expect(isFreeModel("openrouter/free")).toBe(true);
    expect(isFreeModel("google/gemma-4-31b-it")).toBe(false);
    const { handle, deps, fetch } = setup({ models: ["google/gemma-4-31b-it", "x/y:free"] });
    await handle(post(valid()), deps);
    expect((JSON.parse(fetch.mock.calls[0][1].body as string) as UpstreamBody).models).toEqual(["x/y:free"]);
    const paidOnly = setup({ models: ["google/gemma-4-31b-it"] });
    expect(await body(await paidOnly.handle(post(valid()), paidOnly.deps))).toEqual({ text: "" });
    expect(paidOnly.fetch).not.toHaveBeenCalled();
  });
});

describe("QuotaCounter", () => {
  const memoryStore = () => {
    let saved: QuotaSnapshot | null = null;
    return { load: () => saved, save: (s: QuotaSnapshot) => void (saved = { ...s }), get: () => saved };
  };
  const limits = { daily: 5, perMinute: 3, perDevice: 2, perIp: 3 };
  const t0 = Date.UTC(2026, 10, 17, 23, 50);

  it("uses the configured caps: 95 % of the daily cap, 20 per minute", () => {
    expect(quotaLimits().daily).toBe(Math.floor(SUGGEST_CONFIG.dailyCap * SUGGEST_CONFIG.dailyCapShare));
    expect(quotaLimits().perMinute).toBe(SUGGEST_CONFIG.perMinuteCap);
  });

  it("per-device limit per sliding minute", () => {
    const q = new QuotaCounter(memoryStore(), limits);
    expect(q.take(t0, "a", "")).toBe("ok");
    expect(q.take(t0 + 1, "a", "")).toBe("ok");
    expect(q.take(t0 + 2, "a", "")).toBe("device");
    expect(q.take(t0 + 3, "b", "")).toBe("ok");
    expect(q.take(t0 + 60_001, "a", "")).toBe("ok");
  });

  it("per-IP limit", () => {
    const q = new QuotaCounter(memoryStore(), { ...limits, perMinute: 10 });
    expect(q.take(t0, "a", "1.1.1.1")).toBe("ok");
    expect(q.take(t0, "b", "1.1.1.1")).toBe("ok");
    expect(q.take(t0, "c", "1.1.1.1")).toBe("ok");
    expect(q.take(t0, "d", "1.1.1.1")).toBe("ip");
    expect(q.take(t0, "d", "2.2.2.2")).toBe("ok");
  });

  it("global per-minute cap; refused calls are not counted", () => {
    const store = memoryStore();
    const q = new QuotaCounter(store, { ...limits, perDevice: 10 });
    for (let i = 0; i < 3; i++) expect(q.take(t0 + i, `d${i}`, "")).toBe("ok");
    expect(q.take(t0 + 10, "x", "")).toBe("minute");
    expect(store.get()?.count).toBe(3);
    expect(q.take(t0 + 60_001, "x", "")).toBe("ok");
  });

  it("stops at the daily cap and resets at the UTC day boundary; survives a restart", () => {
    const store = memoryStore();
    let q = new QuotaCounter(store, { ...limits, perMinute: 100, perDevice: 100 });
    for (let i = 0; i < 5; i++) expect(q.take(t0 + i, "a", "")).toBe("ok");
    expect(q.take(t0 + 10, "a", "")).toBe("daily");
    q = new QuotaCounter(store, { ...limits, perMinute: 100, perDevice: 100 }); // restarted object
    expect(q.take(t0 + 20, "a", "")).toBe("daily");
    const nextDay = Date.UTC(2026, 10, 18, 0, 0, 1);
    expect(q.take(nextDay, "a", "")).toBe("ok");
    expect(store.get()).toMatchObject({ day: "2026-11-18", count: 1 });
  });

  it("back-off blocks every call until it ends and never shortens", () => {
    const store = memoryStore();
    const q = new QuotaCounter(store, limits);
    q.backoff(t0 + 30_000);
    q.backoff(t0 + 5_000);
    expect(q.take(t0 + 29_999, "a", "")).toBe("backoff");
    expect(q.take(t0 + 30_000, "a", "")).toBe("ok");
    expect(new QuotaCounter(store, limits).snapshot().backoffUntil).toBe(t0 + 30_000);
  });
});

describe("backoffUntil", () => {
  const now = Date.UTC(2026, 10, 17, 12);
  it("account limit: until X-RateLimit-Reset (ms or s)", () => {
    const reset = Date.UTC(2026, 10, 18);
    expect(backoffUntil(new Headers({ "x-ratelimit-reset": String(reset) }), now)).toBe(reset);
    expect(backoffUntil(new Headers({ "x-ratelimit-reset": String(reset / 1000) }), now)).toBe(reset);
  });
  it("provider limit: Retry-After seconds or date, clamped; default 15 s", () => {
    expect(backoffUntil(new Headers({ "retry-after": "30" }), now)).toBe(now + 30_000);
    expect(backoffUntil(new Headers({ "retry-after": "99999" }), now)).toBe(now + 5 * 60_000);
    expect(backoffUntil(new Headers({ "retry-after": new Date(now + 40_000).toUTCString() }), now)).toBe(now + 40_000);
    expect(backoffUntil(new Headers(), now)).toBe(now + 15_000);
  });
});
