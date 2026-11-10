import type { ClaimResponse, RoomInfo } from "../shared/api";
import { generateCode } from "../shared/code";
import { getDeviceId, randomId, readJSON, writeJSON } from "./storage";

/** What this device remembers about a round (spec 01: rounds list on the device, no login). */
export interface RoomEntry {
  code: string;
  /** Random id of the room, created with it; used to reserve the code on the server. */
  roomId: string | null;
  /** Created on this device (then the device reserves the code). */
  createdHere: boolean;
  /** The server confirmed the code belongs to this room (claimed or joined). */
  verified: boolean;
  /** Something was edited (the room is then stored for good). */
  edited: boolean;
  motion: string;
  side: string | null;
  role: string | null;
  setupDismissed: boolean;
  inviteDismissed: boolean;
  identity: { name: string; color: string; hex: string } | null;
  createdAt: number;
  openedAt: number;
}

const ROOMS_KEY = "debatable.rooms";
const LAST_KEY = "debatable.lastRoom";

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeRooms(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function listRooms(): RoomEntry[] {
  return readJSON<RoomEntry[]>(ROOMS_KEY, []).sort((a, b) => b.openedAt - a.openedAt);
}

export function getRoom(code: string): RoomEntry | null {
  return listRooms().find((r) => r.code === code) ?? null;
}

export function saveRoom(entry: RoomEntry) {
  const all = readJSON<RoomEntry[]>(ROOMS_KEY, []).filter((r) => r.code !== entry.code);
  all.push(entry);
  writeJSON(ROOMS_KEY, all);
  listeners.forEach((l) => l());
}

export function updateRoom(code: string, patch: Partial<RoomEntry>): RoomEntry | null {
  const cur = getRoom(code);
  if (!cur) return null;
  const changed = (Object.keys(patch) as (keyof RoomEntry)[]).some((k) => JSON.stringify(cur[k]) !== JSON.stringify(patch[k]));
  if (!changed) return cur;
  const next = { ...cur, ...patch };
  saveRoom(next);
  return next;
}

export function removeRoom(code: string) {
  writeJSON(
    ROOMS_KEY,
    readJSON<RoomEntry[]>(ROOMS_KEY, []).filter((r) => r.code !== code),
  );
  listeners.forEach((l) => l());
}

export function getLastRoom(): string | null {
  return readJSON<string | null>(LAST_KEY, null);
}

export function setLastRoom(code: string) {
  writeJSON(LAST_KEY, code);
}

export function blankEntry(code: string, createdHere: boolean): RoomEntry {
  const now = Date.now();
  return {
    code,
    roomId: createdHere ? `room-${randomId(18)}` : null,
    createdHere,
    verified: false,
    edited: false,
    motion: "",
    side: null,
    role: null,
    setupDismissed: false,
    inviteDismissed: false,
    identity: null,
    createdAt: now,
    openedAt: now,
  };
}

/** A new room: a fresh code generated on the device and reserved on the server when online. */
export function createRoomEntry(): RoomEntry {
  let code = generateCode();
  while (getRoom(code)) code = generateCode();
  const entry = blankEntry(code, true);
  saveRoom(entry);
  return entry;
}

export type ClaimResult = "ok" | "taken" | "offline";

/** Reserve the code on the server (the server is the one that checks uniqueness). */
export async function claimRoom(entry: RoomEntry, timeoutMs = 6000): Promise<ClaimResult> {
  if (!entry.roomId) return "ok";
  try {
    const res = await fetch(`/api/rooms/${entry.code}/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roomId: entry.roomId, deviceId: getDeviceId() }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 409) return "taken";
    if (!res.ok) return "offline";
    const body = (await res.json()) as ClaimResponse;
    return body.ok ? "ok" : body.reason === "taken" ? "taken" : "offline";
  } catch {
    return "offline";
  }
}

export type ExistsResult = "exists" | "missing" | "offline";

export async function roomExists(code: string, timeoutMs = 6000): Promise<ExistsResult> {
  try {
    const res = await fetch(`/api/rooms/${code}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return res.status === 400 ? "missing" : "offline";
    const info = (await res.json()) as RoomInfo;
    return info.exists ? "exists" : "missing";
  } catch {
    return "offline";
  }
}
