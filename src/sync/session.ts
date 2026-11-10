import YProvider from "y-partyserver/provider";
import { IndexeddbPersistence } from "y-indexeddb";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { FORMATS } from "../config/formats";
import { PARTICIPANT_COLORS, PARTICIPANT_NAMES } from "../config/names";
import type { Op } from "../engine/ops";
import { ROOM_PARTY } from "../shared/api";
import { applyOpsToDoc, LOCAL, readSnapshot, undoScope, type RoomSnapshot } from "./doc";
import { getDeviceId, requestPersistentStorage } from "./storage";

export type SyncStatus = "loading" | "local" | "connecting" | "synced" | "offline";

export interface Identity {
  name: string;
  /** Colour name shown in brackets: "Ohio Enjoyer (orange)". */
  color: string;
  hex: string;
}

/** What a device shares with its partner through Yjs awareness. */
export interface PresenceState {
  user: Identity & { deviceId: string };
  role: string | null;
  /** The card / point / thesis being typed in (partner highlight). */
  editing: { kind: "card" | "point" | "thesis"; id: string; cardId?: string } | null;
}

export interface Peer extends PresenceState {
  clientId: number;
}

type Listener = () => void;

/**
 * One open room on this device: the Yjs document, its IndexedDB copy (offline-first),
 * the live WebSocket provider (when the code is verified), presence and undo history.
 */
export class RoomSession {
  readonly doc = new Y.Doc();
  readonly awareness: Awareness;
  readonly undo: Y.UndoManager;
  readonly idb: IndexeddbPersistence;
  provider: YProvider | null = null;
  status: SyncStatus = "loading";
  loaded = false;

  private snapshot: RoomSnapshot;
  private listeners = new Set<Listener>();
  private presenceListeners = new Set<Listener>();
  private peers: Peer[] = [];
  private scheduled = false;
  private destroyed = false;

  constructor(
    readonly code: string,
    identity: Identity,
    private onIdentityChange?: (id: Identity) => void,
  ) {
    requestPersistentStorage();
    this.awareness = new Awareness(this.doc);
    this.awareness.setLocalState({
      user: { ...identity, deviceId: getDeviceId() },
      role: null,
      editing: null,
    } satisfies PresenceState);
    this.snapshot = readSnapshot(this.doc);
    this.undo = new Y.UndoManager(undoScope(this.doc, { sides: Object.values(FORMATS).flatMap((f) => f.sides) }), {
      trackedOrigins: new Set([LOCAL]),
      captureTimeout: 600,
    });
    this.doc.on("update", this.schedule);
    this.awareness.on("change", this.onAwareness);
    this.idb = new IndexeddbPersistence(`debatable:${code}`, this.doc);
    void this.idb.whenSynced.then(() => {
      if (this.destroyed) return;
      this.loaded = true;
      if (this.status === "loading") this.status = "local";
      this.emit();
    });
  }

  /** Start live sync (only once the code is known to belong to this room). */
  connect() {
    if (this.provider || this.destroyed) return;
    this.status = "connecting";
    const provider = new YProvider(window.location.host, this.code, this.doc, {
      party: ROOM_PARTY,
      awareness: this.awareness,
      params: { device: getDeviceId() },
      maxBackoffTime: 4000,
    });
    provider.on("status", (e: { status: string }) => {
      if (e.status === "connected") this.status = provider.synced ? "synced" : "connecting";
      else if (e.status === "disconnected") this.status = "offline";
      this.emit();
    });
    provider.on("sync", (synced: boolean) => {
      if (synced) this.status = "synced";
      this.emit();
    });
    this.provider = provider;
    this.emit();
  }

  destroy() {
    this.destroyed = true;
    this.doc.off("update", this.schedule);
    this.awareness.off("change", this.onAwareness);
    this.provider?.destroy();
    this.awareness.destroy();
    void this.idb.destroy();
    this.undo.destroy();
    this.doc.destroy();
  }

  // ----- document -----

  getSnapshot = () => this.snapshot;

  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  /** Local ops refresh the snapshot synchronously, so the UI can select what was just created. */
  apply(ops: Op[]) {
    // every command is its own undo step (typing is grouped separately, see endUndoStep)
    this.undo.stopCapturing();
    applyOpsToDoc(this.doc, this.snapshot.side, ops, LOCAL);
    this.undo.stopCapturing();
    this.refresh();
  }

  /** Closes the current undo step (when editing starts or stops). */
  endUndoStep() {
    this.undo.stopCapturing();
  }

  private dirty = false;

  private refresh() {
    if (!this.dirty || this.destroyed) return;
    this.dirty = false;
    this.snapshot = readSnapshot(this.doc);
    this.emit();
  }

  /** Remote and text changes: recompute the plain snapshot once per burst of updates. */
  private schedule = () => {
    this.dirty = true;
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      this.refresh();
    });
  };

  private emit() {
    if (this.destroyed) return;
    // a new object so React notices status-only changes too
    this.snapshot = { ...this.snapshot };
    this.listeners.forEach((l) => l());
  }

  // ----- presence -----

  getPeers = () => this.peers;

  subscribePresence = (fn: Listener) => {
    this.presenceListeners.add(fn);
    return () => {
      this.presenceListeners.delete(fn);
    };
  };

  setPresence(patch: Partial<PresenceState>) {
    const cur = this.awareness.getLocalState() as PresenceState | null;
    if (!cur) return;
    const next = { ...cur, ...patch };
    if (JSON.stringify(next) === JSON.stringify(cur)) return;
    this.awareness.setLocalState(next);
  }

  get identity(): Identity {
    const s = this.awareness.getLocalState() as PresenceState | null;
    return s?.user ?? { name: PARTICIPANT_NAMES[0], color: PARTICIPANT_COLORS[0].name, hex: PARTICIPANT_COLORS[0].hex };
  }

  private onAwareness = () => {
    const mine = this.awareness.clientID;
    const peers: Peer[] = [];
    this.awareness.getStates().forEach((st, clientId) => {
      if (clientId === mine) return;
      const s = st as Partial<PresenceState>;
      if (s && s.user) peers.push({ clientId, user: s.user, role: s.role ?? null, editing: s.editing ?? null });
    });
    this.peers = peers;
    this.resolveIdentityClash();
    this.presenceListeners.forEach((l) => l());
  };

  /**
   * Partners in one room never share a name or a colour (spec 01). The device with the higher
   * client id gives way and picks the first free name / colour.
   */
  private resolveIdentityClash() {
    const me = this.identity;
    const mine = this.awareness.clientID;
    const others = this.peers;
    const nameTaken = others.some((p) => p.user.name === me.name && p.clientId < mine);
    const colorTaken = others.some((p) => p.user.color === me.color && p.clientId < mine);
    if (!nameTaken && !colorTaken) return;
    const usedNames = new Set(others.map((p) => p.user.name));
    const usedColors = new Set(others.map((p) => p.user.color));
    const next: Identity = { ...me };
    if (nameTaken) next.name = PARTICIPANT_NAMES.find((n) => !usedNames.has(n)) ?? `${me.name} 2`;
    if (colorTaken) {
      const c = PARTICIPANT_COLORS.find((x) => !usedColors.has(x.name)) ?? PARTICIPANT_COLORS[0];
      next.color = c.name;
      next.hex = c.hex;
    }
    const cur = this.awareness.getLocalState() as PresenceState;
    this.awareness.setLocalState({ ...cur, user: { ...cur.user, ...next } });
    this.onIdentityChange?.(next);
  }
}

/** A random name + colour for a device that has none yet. */
export function randomIdentity(): Identity {
  const bytes = new Uint8Array(2);
  crypto.getRandomValues(bytes);
  const c = PARTICIPANT_COLORS[bytes[1] % PARTICIPANT_COLORS.length];
  return { name: PARTICIPANT_NAMES[bytes[0] % PARTICIPANT_NAMES.length], color: c.name, hex: c.hex };
}
