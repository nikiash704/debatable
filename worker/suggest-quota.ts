import { DurableObject } from "cloudflare:workers";
import { QuotaCounter, quotaLimits, type QuotaSnapshot, type QuotaVerdict } from "./suggest";

/**
 * The single global counter for AI suggestions (one instance, name "global"): every user shares one
 * OpenRouter key, so the free-tier limits (20/min, 1000/UTC day) are counted in one place.
 * A Durable Object is the only Cloudflare primitive that is both global and strongly consistent:
 * KV is eventually consistent (counts would be lost between data centers), the Rate Limiting
 * binding is per location and has no daily window, and isolate memory is per instance.
 * The day count and the 429 back-off are stored in SQLite; minute windows live in memory.
 * Logic: QuotaCounter in worker/suggest.ts (unit-tested there).
 */
export class SuggestQuota extends DurableObject<Env> {
  readonly #counter: QuotaCounter;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    sql.exec(
      "CREATE TABLE IF NOT EXISTS quota (id INTEGER PRIMARY KEY CHECK (id = 1), day TEXT NOT NULL, count INTEGER NOT NULL, backoff_until INTEGER NOT NULL)",
    );
    this.#counter = new QuotaCounter(
      {
        load(): QuotaSnapshot | null {
          const row = sql
            .exec<{ day: string; count: number; backoff_until: number }>("SELECT day, count, backoff_until FROM quota WHERE id = 1")
            .toArray()[0];
          return row ? { day: row.day, count: row.count, backoffUntil: row.backoff_until } : null;
        },
        save(s: QuotaSnapshot) {
          sql.exec(
            "INSERT INTO quota (id, day, count, backoff_until) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET day = excluded.day, count = excluded.count, backoff_until = excluded.backoff_until",
            s.day,
            s.count,
            s.backoffUntil,
          );
        },
      },
      quotaLimits(),
    );
  }

  /** Reserves one upstream call, or says which limit stops it. */
  take(device: string, ip: string): QuotaVerdict {
    return this.#counter.take(Date.now(), device, ip);
  }

  /** Pauses all upstream calls until `until` (ms since epoch), after an upstream 429. */
  backoff(until: number): void {
    this.#counter.backoff(until);
  }

  /** Today's state, for diagnostics. */
  status(): QuotaSnapshot {
    return this.#counter.snapshot();
  }
}
