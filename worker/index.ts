import { getServerByName, routePartykitRequest } from "partyserver";
import type { ClaimRequest, ClaimResponse, RoomInfo } from "../src/shared/api";
import { isValidCode } from "../src/shared/code";
import { Room } from "./room";
import { createSuggestHandler, workersCache } from "./suggest";
import { SuggestQuota } from "./suggest-quota";

export { Room, SuggestQuota };

/** One per isolate: keeps its small in-memory caches (known rooms, recent answers). */
const suggest = createSuggestHandler();

function handleSuggest(request: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
  const quota = () => env.SuggestQuota.get(env.SuggestQuota.idFromName("global"));
  return suggest(request, {
    apiKey: env.API_KEY_OPENROUTER,
    fetch: (input, init) => fetch(input, init),
    roomExists: async (code) => (await (await getServerByName(env.Room, code)).info()).exists,
    quota: {
      take: (device, ip) => quota().take(device, ip),
      backoff: (until) => quota().backoff(until),
    },
    cache: workersCache(url.origin),
    waitUntil: (p) => ctx.waitUntil(p),
  });
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

async function handleApi(request: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
  if (url.pathname === "/api/health") return json({ ok: true, app: "debatable" });
  if (url.pathname === "/api/suggest") return handleSuggest(request, env, ctx, url);

  const m = url.pathname.match(/^\/api\/rooms\/([^/]+)(\/claim)?$/);
  if (!m) return json({ error: "not found" }, 404);
  const code = m[1].toUpperCase();
  if (!isValidCode(code)) return json({ error: "invalid code" }, 400);
  const room = await getServerByName(env.Room, code);

  if (!m[2] && request.method === "GET") {
    const info = await room.info();
    return json({ code, exists: info.exists } satisfies RoomInfo);
  }
  if (m[2] && request.method === "POST") {
    let body: ClaimRequest;
    try {
      body = await request.json<ClaimRequest>();
    } catch {
      return json({ ok: false, reason: "invalid" } satisfies ClaimResponse, 400);
    }
    const result = await room.claim(String(body.roomId ?? ""), String(body.deviceId ?? ""));
    return json(result, result.ok ? 200 : result.reason === "taken" ? 409 : 400);
  }
  return json({ error: "method not allowed" }, 405);
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env, ctx, url);
    return (await routePartykitRequest(request, env)) ?? new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
