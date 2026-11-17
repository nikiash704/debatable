import { afterEach, describe, expect, it, vi } from "vitest";
import { cachedSuggestion, clearSuggestionCache, requestSuggestion } from "./client";
import type { SuggestRequest } from "../../shared/suggest";

const req: SuggestRequest = {
  room: "ABCDE",
  device: "dev-1",
  field: "card",
  before: "Ocean exploration is",
  context: { format: "apda", side: "gov", speech: "PMC" },
};

const reply = (status: number, body: unknown) =>
  vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })) as unknown as typeof fetch;

afterEach(() => clearSuggestionCache());

describe("requestSuggestion", () => {
  it("posts the request and returns the continuation", async () => {
    const f = reply(200, { text: " cheaper than space.", model: "m" });
    expect(await requestSuggestion(req, new AbortController().signal, f)).toBe(" cheaper than space.");
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("/api/suggest");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual(req);
  });
  it("caches the answer by context and text", async () => {
    expect(cachedSuggestion(req)).toBeUndefined();
    await requestSuggestion(req, new AbortController().signal, reply(200, { text: " x." }));
    expect(cachedSuggestion({ ...req, device: "other" })).toBe(" x.");
  });
  it("is silent on errors, non-200, bad bodies and aborts (and caches none of them)", async () => {
    const s = () => new AbortController().signal;
    expect(await requestSuggestion(req, s(), reply(500, { text: "no" }))).toBe("");
    expect(await requestSuggestion(req, s(), reply(429, { text: "no" }))).toBe("");
    expect(await requestSuggestion(req, s(), reply(200, "not json"))).toBe("");
    const boom = vi.fn(async () => {
      throw new TypeError("network");
    }) as unknown as typeof fetch;
    expect(await requestSuggestion(req, s(), boom)).toBe("");
    const ctrl = new AbortController();
    const slow = vi.fn(
      (_u: unknown, init: RequestInit) =>
        new Promise<Response>((_res, rej) => init.signal!.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))),
    ) as unknown as typeof fetch;
    const p = requestSuggestion(req, ctrl.signal, slow);
    ctrl.abort();
    expect(await p).toBe("");
    expect(cachedSuggestion(req)).toBeUndefined();
  });
  it("does not send an oversized body", async () => {
    const f = reply(200, { text: " x." });
    const big = { ...req, context: { ...req.context, siblings: Array.from({ length: 50 }, () => "y".repeat(300)) } };
    expect(await requestSuggestion(big, new AbortController().signal, f)).toBe("");
    expect(f).not.toHaveBeenCalled();
  });
});
