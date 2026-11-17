/**
 * Benchmark for AI sentence suggestions against the deployed Worker (`POST /api/suggest`).
 * Method, shortlist and results: docs/plans/ai-suggestions-bench.md.
 *
 *   node scripts/bench-suggest.ts --dry [--n 10]                 # prints the prompts, no network
 *   node scripts/bench-suggest.ts --base https://debatable.nikiash704.workers.dev [--room CODE]
 *        [--models a,b] [--n 20] [--rounds 1] [--budget 300] [--rpm 14] [--ids x,y] [--tags card,edge] [--out DIR]
 *
 * Runs on Node 26 as is (built-in type stripping; a resolve hook below adds the ".ts" the shared
 * sources leave out). `npx tsx scripts/bench-suggest.ts …` works too.
 *
 * Each request names one model (`model`, must be in SUGGEST_CONFIG.benchModels on the deployed
 * Worker), so it skips the Worker's cache and counts against the shared OpenRouter quota (the same one
 * users draw from). The script paces itself under the Worker's soft limits (15/min per IP, 6/min per
 * device, 20/min global) and stops at --budget requests. Prompt and post-processing are the Worker's
 * (src/shared/suggest-prompt.ts): what is measured is exactly what ships.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SuggestRequest } from "../src/shared/suggest";
import type { BenchItem, FormatFailure } from "./bench-corpus";

// The app's sources import without extensions (bundler style); plain Node needs them.
registerHooks({
  resolve(spec, ctx, next) {
    try {
      return next(spec, ctx);
    } catch (e) {
      if (!/^\.\.?\//.test(spec) || /\.[cm]?[jt]sx?$/.test(spec)) throw e;
      try {
        return next(`${spec}.ts`, ctx);
      } catch {
        return next(`${spec}/index.ts`, ctx);
      }
    }
  },
});

const { buildMessages } = await import("../src/shared/suggest-prompt.ts");
const { SUGGEST_CONFIG } = await import("../src/config/suggest.ts");
const { generateCode, normalizeCode } = await import("../src/shared/code.ts");
const { BENCH_CORPUS, checkFormat } = await import("./bench-corpus.ts");

// ---------------------------------------------------------------------------------------------
// Arguments

interface Args {
  base: string;
  room: string | null;
  models: string[];
  n: number;
  rounds: number;
  budget: number;
  rpm: number;
  ids: string[];
  tags: string[];
  out: string;
  dry: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const list = (v: string | undefined) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);
  const num = (v: string | undefined, d: number) => (v === undefined ? d : Number(v));
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(readmeLines().join("\n"));
    process.exit(0);
  }
  const a: Args = {
    base: (get("base") ?? "").replace(/\/+$/, ""),
    room: get("room") ?? null,
    models: list(get("models")),
    n: num(get("n"), Infinity),
    rounds: num(get("rounds"), 1),
    budget: num(get("budget"), 300),
    rpm: num(get("rpm"), 14),
    ids: list(get("ids")),
    tags: list(get("tags")),
    out: get("out") ?? join(tmpdir(), `debatable-bench-${new Date().toISOString().replace(/[:.]/g, "-")}`),
    dry: argv.includes("--dry"),
  };
  for (const [k, v] of Object.entries({ n: a.n, rounds: a.rounds, budget: a.budget, rpm: a.rpm }))
    if (!(v > 0)) fail(`--${k} must be a positive number`);
  // stay under the Worker's per-IP (15/min) and global (20/min) soft limits
  if (a.rpm > 14) fail("--rpm above 14 would hit the Worker's per-IP limit (15/min)");
  if (!a.dry && !/^https?:\/\//.test(a.base)) fail("--base https://… is required (or --dry)");
  return a;
}

function readmeLines(): string[] {
  return [
    "Usage:",
    "  node scripts/bench-suggest.ts --dry [--n 10] [--ids a,b] [--tags card]",
    "  node scripts/bench-suggest.ts --base <worker url> [--room CODE] [--models a,b] [--n 20] [--rounds 1]",
    "                                [--budget 300] [--rpm 14] [--ids a,b] [--tags card,edge] [--out DIR]",
    "Defaults: all bench models, the whole corpus, 1 round, budget 300 requests, 14 requests/min.",
  ];
}

function fail(msg: string): never {
  console.error(`bench-suggest: ${msg}`);
  process.exit(2);
}

// ---------------------------------------------------------------------------------------------
// Selection

/** `n` items spread evenly over the list (keeps every kind of item in a short run). */
function spread<T>(items: T[], n: number): T[] {
  if (n >= items.length) return items;
  return Array.from({ length: n }, (_, i) => items[Math.floor((i * items.length) / n)]);
}

function selectItems(a: Args): BenchItem[] {
  let items = BENCH_CORPUS;
  if (a.ids.length) items = items.filter((c) => a.ids.includes(c.id));
  if (a.tags.length) items = items.filter((c) => c.tags.some((t) => a.tags.includes(t)) || a.tags.includes(c.field));
  if (!items.length) fail("no corpus item matches --ids / --tags");
  return spread(items, a.n);
}

function selectModels(a: Args): string[] {
  const allowed: readonly string[] = SUGGEST_CONFIG.benchModels;
  if (!a.models.length) return [...allowed];
  const bad = a.models.filter((m) => !allowed.includes(m));
  if (bad.length) fail(`not in SUGGEST_CONFIG.benchModels (the Worker would reject them): ${bad.join(", ")}`);
  return a.models;
}

// ---------------------------------------------------------------------------------------------
// Dry run

function dry(a: Args, items: BenchItem[], models: string[]) {
  const [system, ...rest] = buildMessages(items[0]);
  console.log("# Prompt (shared by every request)\n");
  console.log(`## system\n${system.content}\n`);
  for (const m of rest.slice(0, -1)) console.log(`## ${m.role} (example)\n${m.content}\n`);
  let maxChars = 0;
  for (const it of items) {
    const msgs = buildMessages(it);
    const chars = msgs.reduce((s, m) => s + m.content.length, 0);
    maxChars = Math.max(maxChars, chars);
    console.log(`## ${it.id}  [${it.field}; ${it.tags.join(", ")}]  ~${Math.ceil(chars / 4)} tokens in`);
    console.log(msgs.at(-1)!.content.replace(/ $/, "␠"));
    if (it.reference !== undefined) console.log(`(reference: ${JSON.stringify(it.reference)})`);
    console.log();
  }
  const total = Math.min(items.length * models.length * a.rounds, a.budget);
  console.log("# Plan");
  console.log(`items ${items.length} × models ${models.length} × rounds ${a.rounds} = ${items.length * models.length * a.rounds} requests; budget ${a.budget} → ${total} sent`);
  console.log(`at ${a.rpm}/min ≈ ${Math.ceil(total / a.rpm)} min; largest prompt ≈ ${Math.ceil(maxChars / 4)} tokens; max_tokens ${SUGGEST_CONFIG.maxTokens}`);
  console.log(`models: ${models.join(", ")}`);
}

// ---------------------------------------------------------------------------------------------
// Live run

type Outcome = "ok" | "empty" | "timeout" | "rate-limited" | "error";

interface Row {
  ts: string;
  round: number;
  id: string;
  tags: string[];
  field: string;
  context: SuggestRequest["context"];
  model: string;
  servedModel: string | null;
  before: string;
  text: string;
  joined: string;
  reference: string | null;
  outcome: Outcome;
  skip: string | null;
  status: number;
  ms: number;
  fails: FormatFailure[];
  pass: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (n = 8) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");

/** Uses `--room` if it exists, else claims it (or a fresh code): a claimed room counts as existing for 24 h. */
async function ensureRoom(base: string, wanted: string | null): Promise<string> {
  const code = wanted ? normalizeCode(wanted) : generateCode();
  if (!code) fail(`invalid room code: ${wanted}`);
  const info = await fetch(`${base}/api/rooms/${code}`).then((r) => r.json() as Promise<{ exists?: boolean }>);
  if (info.exists) return code;
  const res = await fetch(`${base}/api/rooms/${code}/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ roomId: `bench-${rand()}`, deviceId: `bench-${rand()}` }),
  });
  if (!res.ok) fail(`could not claim room ${code} (HTTP ${res.status}); pass an existing one with --room`);
  return code;
}

interface Sent {
  status: number;
  skip: string | null;
  text: string;
  servedModel: string | null;
  ms: number;
}

async function send(base: string, body: SuggestRequest): Promise<Sent> {
  const t0 = performance.now();
  try {
    const res = await fetch(`${base}/api/suggest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const skip = res.headers.get("x-suggest-skip");
    const data = (await res.json().catch(() => ({}))) as { text?: unknown; model?: unknown };
    return {
      status: res.status,
      skip,
      text: typeof data.text === "string" ? data.text : "",
      servedModel: typeof data.model === "string" ? data.model : null,
      ms: Math.round(performance.now() - t0),
    };
  } catch {
    return { status: 0, skip: "network", text: "", servedModel: null, ms: Math.round(performance.now() - t0) };
  }
}

/** Skips that are about our own limits or the deployment, not the model: wait (ms) and retry, or stop. */
function infraSkip(skip: string | null, status: number): { wait: number } | { stop: string } | null {
  if (status === 404) return { stop: "room not found (claim expired?)" };
  if (status === 400) return { stop: "request rejected (400): is the model in the deployed Worker's benchModels?" };
  if (status === 403) return { stop: "forbidden (403)" };
  if (!skip) return null;
  if (skip === "quota-daily") return { stop: "shared daily quota reached (quota-daily)" };
  if (skip === "no-key" || skip === "no-model") return { stop: `Worker not configured (${skip})` };
  if (skip === "quota-minute" || skip === "quota-device" || skip === "quota-ip") return { wait: 61_000 };
  if (skip === "quota-backoff") return { wait: 20_000 };
  if (skip === "quota-unavailable" || skip === "room-lookup" || skip === "network") return { wait: 5_000 };
  return null;
}

function outcomeOf(s: Sent): Outcome {
  if (s.skip === "upstream-timeout") return "timeout";
  if (s.skip === "upstream-429") return "rate-limited";
  if (s.skip) return "error";
  return s.text ? "ok" : "empty";
}

async function live(a: Args, items: BenchItem[], models: string[]) {
  mkdirSync(a.out, { recursive: true });
  const jsonl = join(a.out, "answers.jsonl");
  const room = await ensureRoom(a.base, a.room);
  // one device id per ~5 requests/min keeps every device under the Worker's 6/min
  const devices = Array.from({ length: Math.ceil(a.rpm / 5) }, () => `bench-${rand(6)}`);
  const interval = 60_000 / a.rpm;
  const jobs: { round: number; item: BenchItem; model: string }[] = [];
  // item-major, models interleaved: a run cut short by the budget still compares models on the same items
  for (let round = 1; round <= a.rounds; round++) for (const item of items) for (const model of models) jobs.push({ round, item, model });
  const planned = Math.min(jobs.length, a.budget);
  console.error(`room ${room}; ${planned} requests at ${a.rpm}/min ≈ ${Math.ceil(planned / a.rpm)} min; answers → ${jsonl}`);

  const rows: Row[] = [];
  let sent = 0;
  let infra = 0;
  let backoffs = 0;
  let next = 0;
  let stopped: string | null = null;
  const onInt = () => {
    stopped = "interrupted";
  };
  process.on("SIGINT", onInt);

  for (const job of jobs) {
    if (stopped || sent >= a.budget) break;
    for (let attempt = 0; attempt < 3 && !stopped && sent < a.budget; attempt++) {
      const wait = next - performance.now();
      if (wait > 0) await sleep(wait);
      next = performance.now() + interval;
      const { id: _id, tags: _tags, reference: _ref, ...req } = job.item;
      const body: SuggestRequest = { ...req, room, device: devices[sent % devices.length], model: job.model };
      const s = await send(a.base, body);
      sent++;
      const inf = infraSkip(s.skip, s.status);
      if (inf && "stop" in inf) {
        stopped = inf.stop;
        break;
      }
      if (inf) {
        infra++;
        backoffs = s.skip === "quota-backoff" ? backoffs + 1 : 0;
        if (backoffs >= 6) {
          stopped = "the Worker keeps pausing upstream (quota-backoff): OpenRouter's account limit is probably used up";
          break;
        }
        console.error(`  ${s.skip}: waiting ${Math.round(inf.wait / 1000)} s`);
        next = performance.now() + inf.wait;
        continue;
      }
      backoffs = 0;
      const outcome = outcomeOf(s);
      const fails = outcome === "ok" ? checkFormat(job.item.before, s.text, job.item.tags) : [];
      const row: Row = {
        ts: new Date().toISOString(),
        round: job.round,
        id: job.item.id,
        tags: job.item.tags,
        field: job.item.field,
        context: job.item.context,
        model: job.model,
        servedModel: s.servedModel,
        before: job.item.before,
        text: s.text,
        joined: job.item.before + s.text,
        reference: job.item.reference ?? null,
        outcome,
        skip: s.skip,
        status: s.status,
        ms: s.ms,
        fails,
        pass: outcome === "ok" && fails.length === 0,
      };
      rows.push(row);
      appendFileSync(jsonl, `${JSON.stringify(row)}\n`);
      const shown = outcome === "ok" ? JSON.stringify(row.joined) : outcome + (s.skip ? ` (${s.skip})` : "");
      console.error(`${String(sent).padStart(4)} ${job.model.padEnd(40)} ${String(s.ms).padStart(5)} ms  ${job.item.id.padEnd(22)} ${shown}${fails.length ? `  ✗ ${fails.join(",")}` : ""}`);
      if (outcome === "rate-limited") next = performance.now() + 20_000; // the Worker pauses upstream after a 429
      break;
    }
  }
  process.off("SIGINT", onInt);

  const md = summary(rows, models, { room, sent, infra, stopped, budget: a.budget });
  writeFileSync(join(a.out, "summary.md"), md);
  console.log(md);
  console.error(`written: ${join(a.out, "summary.md")}, ${jsonl}`);
}

// ---------------------------------------------------------------------------------------------
// Summary

function pct(n: number, d: number): string {
  return d ? `${Math.round((100 * n) / d)} %` : "–";
}

function quantile(xs: number[], q: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)];
}

function summary(rows: Row[], models: string[], run: { room: string; sent: number; infra: number; stopped: string | null; budget: number }): string {
  const out: string[] = [];
  out.push(`## Bench run ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`);
  out.push("");
  out.push(
    `Room ${run.room}; ${run.sent} requests sent (budget ${run.budget}), ${run.infra} skipped by our own limits and retried` +
      (run.stopped ? `; **stopped: ${run.stopped}**` : "") +
      ".",
  );
  out.push("Latency = wall time of `POST /api/suggest` from the bench machine (Worker + OpenRouter), over answered requests (ok + empty).");
  out.push("Format pass = non-empty and passes every automatic check, over all attempts; \"of non-empty\" = over ok answers only.");
  out.push("");
  out.push("| Model | n | p50 ms | p95 ms | error % | timeout % | 429 % | empty % | format pass % | of non-empty | avg words |");
  out.push("|---|---|---|---|---|---|---|---|---|---|---|");
  const failCounts: string[] = [];
  for (const m of models) {
    const r = rows.filter((x) => x.model === m);
    if (!r.length) {
      out.push(`| \`${m}\` | 0 | | | | | | | | | |`);
      continue;
    }
    const answered = r.filter((x) => x.outcome === "ok" || x.outcome === "empty").map((x) => x.ms);
    const ok = r.filter((x) => x.outcome === "ok");
    const count = (o: Outcome) => r.filter((x) => x.outcome === o).length;
    const words = ok.map((x) => x.text.split(/\s+/).filter(Boolean).length);
    const avg = words.length ? (words.reduce((s, w) => s + w, 0) / words.length).toFixed(1) : "–";
    out.push(
      `| \`${m}\` | ${r.length} | ${quantile(answered, 0.5) ?? "–"} | ${quantile(answered, 0.95) ?? "–"} | ${pct(count("error"), r.length)} | ${pct(count("timeout"), r.length)} | ${pct(count("rate-limited"), r.length)} | ${pct(count("empty"), r.length)} | ${pct(r.filter((x) => x.pass).length, r.length)} | ${pct(ok.filter((x) => x.pass).length, ok.length)} | ${avg} |`,
    );
    const byFail = new Map<string, number>();
    for (const x of ok) for (const f of x.fails) byFail.set(f, (byFail.get(f) ?? 0) + 1);
    const errs = new Map<string, number>();
    for (const x of r.filter((y) => y.outcome === "error")) errs.set(x.skip ?? `http-${x.status}`, (errs.get(x.skip ?? `http-${x.status}`) ?? 0) + 1);
    const served = new Set(r.map((x) => x.servedModel).filter((x): x is string => !!x && x !== m));
    failCounts.push(
      `- \`${m}\`: format failures ${[...byFail].map(([k, v]) => `${k} ${v}`).join(", ") || "none"}; errors ${[...errs].map(([k, v]) => `${k} ${v}`).join(", ") || "none"}` +
        (served.size ? `; served as ${[...served].join(", ")}` : ""),
    );
  }
  out.push("");
  out.push("Failure breakdown:");
  out.push(...failCounts);
  out.push("");
  out.push("Empty answers (no `x-suggest-skip`) are model answers that post-processing emptied: blank, echo only, a preface only, or a reply that started with a newline (the Worker sends `stop: [\"\\n\"]`).");
  return out.join("\n");
}

// ---------------------------------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2));
const items = selectItems(args);
const models = selectModels(args);
if (args.dry) dry(args, items, models);
else await live(args, items, models);
