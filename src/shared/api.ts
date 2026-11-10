/** Shapes of the small HTTP API served by the Worker (`/api/*`). */
export interface RoomInfo {
  code: string;
  /** True once the room has content or a fresh claim (someone is about to use it). */
  exists: boolean;
}

export interface ClaimRequest {
  roomId: string;
  deviceId: string;
}

export type ClaimResponse = { ok: true } | { ok: false; reason: "taken" | "invalid" };

/** The PartyServer namespace for rooms (kebab-case of the `Room` binding). */
export const ROOM_PARTY = "room";
