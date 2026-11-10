import type { Connection, ConnectionContext } from "partyserver";
import { YServer } from "y-partyserver";
import * as Y from "yjs";
import type { ClaimResponse } from "../src/shared/api";

/** A claim on an empty room expires after this long, so empty visits never use up codes. */
const CLAIM_TTL_MS = 24 * 60 * 60 * 1000;
/** SQLite rows hold the Yjs state in chunks below the per-value limit. */
const CHUNK_BYTES = 512 * 1024;

/**
 * One Durable Object per room (code = object name).
 * Holds the live Yjs document, syncs it to connected devices and stores it in SQLite.
 * Data is written only after the first edit (an empty document is never saved).
 */
export class Room extends YServer<Env> {
  static callbackOptions = { debounceWait: 800, debounceMaxWait: 4000, timeout: 5000 };

  #schemaReady = false;

  private get db() {
    return this.ctx.storage.sql;
  }

  private ensureSchema() {
    if (this.#schemaReady) return;
    this.db.exec("CREATE TABLE IF NOT EXISTS doc_chunks (idx INTEGER PRIMARY KEY, data BLOB NOT NULL)");
    this.db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS devices (device_id TEXT PRIMARY KEY, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL)",
    );
    this.#schemaReady = true;
  }

  private getMeta(key: string): string | null {
    const row = this.db.exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", key).toArray()[0];
    return row ? row.value : null;
  }

  private setMeta(key: string, value: string) {
    this.db.exec("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value);
  }

  private hasDoc(): boolean {
    this.ensureSchema();
    return this.db.exec("SELECT 1 FROM doc_chunks LIMIT 1").toArray().length > 0;
  }

  async onLoad() {
    this.ensureSchema();
    const rows = this.db.exec<{ data: ArrayBuffer }>("SELECT data FROM doc_chunks ORDER BY idx").toArray();
    if (rows.length === 0) return;
    const parts = rows.map((r) => new Uint8Array(r.data));
    const total = parts.reduce((n, p) => n + p.length, 0);
    const update = new Uint8Array(total);
    let offset = 0;
    for (const p of parts) {
      update.set(p, offset);
      offset += p.length;
    }
    Y.applyUpdate(this.document, update);
  }

  async onSave() {
    this.ensureSchema();
    const update = Y.encodeStateAsUpdate(this.document);
    if (this.document.store.clients.size === 0) return; // nothing edited yet: keep the code free
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      this.db.exec("DELETE FROM doc_chunks");
      for (let i = 0, idx = 0; i < update.length; i += CHUNK_BYTES, idx++) {
        this.db.exec("INSERT INTO doc_chunks (idx, data) VALUES (?, ?)", idx, update.slice(i, i + CHUNK_BYTES));
      }
      this.setMeta("savedAt", String(now));
      if (!this.getMeta("createdAt")) this.setMeta("createdAt", String(now));
      for (const conn of this.getConnections<{ deviceId?: string }>()) {
        const deviceId = conn.state?.deviceId;
        if (!deviceId) continue;
        this.db.exec(
          "INSERT INTO devices (device_id, first_seen, last_seen) VALUES (?, ?, ?) ON CONFLICT(device_id) DO UPDATE SET last_seen = excluded.last_seen",
          deviceId,
          now,
          now,
        );
      }
    });
  }

  onConnect(conn: Connection<{ deviceId?: string }>, ctx: ConnectionContext) {
    const deviceId = new URL(ctx.request.url).searchParams.get("device");
    if (deviceId && /^[\w-]{8,64}$/.test(deviceId)) conn.setState({ deviceId });
    super.onConnect(conn, ctx);
  }

  /** Whether this code is in use: it has saved content or a fresh claim. */
  async info(): Promise<{ exists: boolean }> {
    this.ensureSchema();
    if (this.hasDoc()) return { exists: true };
    const claimedAt = Number(this.getMeta("claimedAt") ?? 0);
    return { exists: claimedAt > 0 && Date.now() - claimedAt < CLAIM_TTL_MS };
  }

  /**
   * Reserve this code for a room created on a device. Idempotent for the same roomId.
   * The server is the one that checks uniqueness (spec 01).
   */
  async claim(roomId: string, deviceId: string): Promise<ClaimResponse> {
    this.ensureSchema();
    if (!/^[\w-]{8,64}$/.test(roomId) || !/^[\w-]{8,64}$/.test(deviceId)) return { ok: false, reason: "invalid" };
    const owner = this.getMeta("roomId");
    const claimedAt = Number(this.getMeta("claimedAt") ?? 0);
    if (owner && owner !== roomId) {
      const stale = !this.hasDoc() && Date.now() - claimedAt >= CLAIM_TTL_MS;
      if (!stale) return { ok: false, reason: "taken" };
    }
    if (!owner && this.hasDoc()) return { ok: false, reason: "taken" };
    this.setMeta("roomId", roomId);
    this.setMeta("claimedAt", String(Date.now()));
    if (!this.getMeta("creatorDevice") || owner !== roomId) this.setMeta("creatorDevice", deviceId);
    return { ok: true };
  }
}
