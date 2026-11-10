import * as Y from "yjs";
import { DEFAULT_FORMAT_ID, getFormat } from "../config/formats";
import type { SideId } from "../config/types";
import type { Op } from "../engine/ops";
import { normalizeStage } from "../engine/stages";
import type { Card, FlowState, Point, Tag, Thesis } from "../engine/types";

/**
 * Yjs document layout: room → side → flow (spec 01). One document per room (= per team in v1).
 *
 *   room   (Map)   format, stage, side (our side), prepMinutes, v
 *   times  (Map)   speechId → minutes (overrides of the format defaults)
 *   motion (Text)
 *   cards:<side>  (Map) cardId → Map { …Card fields, text: Text, points: Array<Map{id, text: Text}>,
 *                                     respondsTo: Array<string> }
 *   room.prepTimer  { runId, endsAt, remainingMs, totalMs } (plain value, last write wins per action)
 *   room.prepAdvanced  runId of the prep run that already moved the round to the first speech
 *   theses:<side> (Map) thesisId → Map { id, side, title: Text, order }
 *
 * Every shared container is top-level (or created together with its parent card), so two devices
 * never race to create the same nested type. Card and thesis text are Y.Text (character merge).
 * `respondsTo` is a Y.Array so two devices can link / unlink the same card at once (stage 2); rooms from
 * stage 1 stored a plain array, which is still read and turned into a Y.Array on its first link.
 */
export const LOCAL = Symbol("local-edit");
/** Timer actions and the automatic end of prep: synced, but not part of Cmd+Z undo. */
export const TIMER = Symbol("timer");
export const SCHEMA_VERSION = 1;

export interface RoomSnapshot {
  formatId: string;
  side: SideId;
  stage: string;
  motion: string;
  times: Record<string, number>;
  prepMinutes: number | null;
  /** Raw prep timer value (see engine/timer.ts) and the run that already ended prep. */
  prepTimer: unknown;
  prepAdvanced: string | null;
  /** Changes every time the timer ends prep (devices show "Prep over — board" once per change). */
  prepEnded: string | null;
  flow: FlowState;
  /** Nothing has been written to the document yet. */
  empty: boolean;
}

export const roomMap = (doc: Y.Doc) => doc.getMap<unknown>("room");
export const timesMap = (doc: Y.Doc) => doc.getMap<number>("times");
export const motionText = (doc: Y.Doc) => doc.getText("motion");
export const cardsMap = (doc: Y.Doc, side: SideId) => doc.getMap<Y.Map<unknown>>(`cards:${side}`);
export const thesesMap = (doc: Y.Doc, side: SideId) => doc.getMap<Y.Map<unknown>>(`theses:${side}`);

export function readSide(doc: Y.Doc): SideId {
  const f = getFormat(readFormatId(doc));
  const side = roomMap(doc).get("side");
  return typeof side === "string" && f.sides.some((s) => s.id === side) ? side : f.defaults.side;
}

export function readFormatId(doc: Y.Doc): string {
  const id = roomMap(doc).get("format");
  return typeof id === "string" ? id : DEFAULT_FORMAT_ID;
}

function str(v: unknown): string {
  return v instanceof Y.Text ? v.toString() : typeof v === "string" ? v : "";
}

/** Targets in link order, without duplicates (two devices may link the same target at once). */
function readTargets(v: unknown): string[] {
  const list = v instanceof Y.Array ? (v.toArray() as unknown[]) : Array.isArray(v) ? v : [];
  return [...new Set(list.filter((x): x is string => typeof x === "string"))];
}

function readCard(m: Y.Map<unknown>): Card | null {
  const id = m.get("id");
  if (typeof id !== "string") return null;
  const points = m.get("points");
  return {
    id,
    side: String(m.get("side") ?? ""),
    ownerSpeech: String(m.get("ownerSpeech") ?? ""),
    zone: m.get("zone") === "clash" ? "clash" : "own",
    series: String(m.get("series") ?? ""),
    displayNumber: typeof m.get("displayNumber") === "number" ? (m.get("displayNumber") as number) : null,
    numberLocked: m.get("numberLocked") === true,
    thesisId: typeof m.get("thesisId") === "string" ? (m.get("thesisId") as string) : null,
    text: str(m.get("text")),
    points:
      points instanceof Y.Array
        ? (points.toArray() as Y.Map<unknown>[]).map((p) => ({ id: String(p.get("id")), text: str(p.get("text")) }))
        : [],
    strong: m.get("strong") === true,
    tags: Array.isArray(m.get("tags")) ? (m.get("tags") as Tag[]) : [],
    saidIn: typeof m.get("saidIn") === "string" ? (m.get("saidIn") as string) : null,
    carriedFrom: typeof m.get("carriedFrom") === "string" ? (m.get("carriedFrom") as string) : null,
    respondsTo: readTargets(m.get("respondsTo")),
    groupId: typeof m.get("groupId") === "string" ? (m.get("groupId") as string) : null,
    order: String(m.get("order") ?? "a0"),
  };
}

function readThesis(m: Y.Map<unknown>): Thesis | null {
  const id = m.get("id");
  if (typeof id !== "string") return null;
  return { id, side: String(m.get("side") ?? ""), title: str(m.get("title")), order: String(m.get("order") ?? "a0") };
}

export function readSnapshot(doc: Y.Doc): RoomSnapshot {
  const room = roomMap(doc);
  const formatId = readFormatId(doc);
  const f = getFormat(formatId);
  const side = readSide(doc);
  const cards: Card[] = [];
  cardsMap(doc, side).forEach((m) => {
    const c = m instanceof Y.Map ? readCard(m) : null;
    if (c) cards.push(c);
  });
  const theses: Thesis[] = [];
  thesesMap(doc, side).forEach((m) => {
    const t = m instanceof Y.Map ? readThesis(m) : null;
    if (t) theses.push(t);
  });
  const times: Record<string, number> = {};
  timesMap(doc).forEach((v, k) => {
    if (typeof v === "number" && v > 0) times[k] = v;
  });
  const prep = room.get("prepMinutes");
  const stage = normalizeStage(f, typeof room.get("stage") === "string" ? (room.get("stage") as string) : null);
  return {
    formatId,
    side,
    stage,
    motion: motionText(doc).toString(),
    times,
    prepMinutes: typeof prep === "number" ? prep : null,
    prepTimer: room.get("prepTimer") ?? null,
    prepAdvanced: typeof room.get("prepAdvanced") === "string" ? (room.get("prepAdvanced") as string) : null,
    prepEnded: typeof room.get("prepEnded") === "string" ? (room.get("prepEnded") as string) : null,
    flow: { stage, perspective: side, cards, theses },
    empty: doc.store.clients.size === 0,
  };
}

function textOf(s: string): Y.Text {
  const t = new Y.Text();
  if (s) t.insert(0, s);
  return t;
}

function pointMap(p: Point): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  m.set("id", p.id);
  m.set("text", textOf(p.text));
  return m;
}

function cardMap(c: Card): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(c)) {
    if (k === "text" || k === "points" || k === "respondsTo") continue;
    m.set(k, v as unknown);
  }
  const targets = new Y.Array<string>();
  if (c.respondsTo.length) targets.push([...new Set(c.respondsTo)]);
  m.set("respondsTo", targets);
  m.set("text", textOf(c.text));
  const points = new Y.Array<Y.Map<unknown>>();
  points.push(c.points.map(pointMap));
  m.set("points", points);
  return m;
}

/** Applies engine ops to the document in one transaction (one undo step). */
export function applyOpsToDoc(doc: Y.Doc, side: SideId, ops: Op[], origin: unknown = LOCAL) {
  if (!ops.length) return;
  doc.transact(() => {
    const room = roomMap(doc);
    if (room.get("v") !== SCHEMA_VERSION) room.set("v", SCHEMA_VERSION);
    const cards = cardsMap(doc, side);
    const theses = thesesMap(doc, side);
    for (const op of ops) {
      switch (op.t) {
        case "card.create":
          cards.set(op.card.id, cardMap(op.card));
          break;
        case "card.update": {
          const m = cards.get(op.id);
          if (!m) break;
          for (const [k, v] of Object.entries(op.patch)) {
            if (JSON.stringify(m.get(k)) !== JSON.stringify(v)) m.set(k, v as unknown);
          }
          break;
        }
        case "card.delete":
          cards.delete(op.id);
          break;
        case "card.link": {
          const m = cards.get(op.id);
          if (!m) break;
          const cur = m.get("respondsTo");
          if (cur instanceof Y.Array) {
            if (!(cur.toArray() as string[]).includes(op.target)) cur.push([op.target]);
          } else {
            // stage-1 room: plain array → Y.Array (once)
            const arr = new Y.Array<string>();
            arr.push([...new Set([...readTargets(cur), op.target])]);
            m.set("respondsTo", arr);
          }
          break;
        }
        case "card.unlink": {
          const m = cards.get(op.id);
          if (!m) break;
          const cur = m.get("respondsTo");
          if (cur instanceof Y.Array) {
            const list = cur.toArray() as string[];
            for (let i = list.length - 1; i >= 0; i--) if (list[i] === op.target) cur.delete(i, 1);
          } else if (Array.isArray(cur)) {
            const arr = new Y.Array<string>();
            arr.push(readTargets(cur).filter((t) => t !== op.target));
            m.set("respondsTo", arr);
          }
          break;
        }
        case "point.insert": {
          const pts = cards.get(op.cardId)?.get("points");
          if (pts instanceof Y.Array) pts.insert(Math.max(0, Math.min(op.index, pts.length)), [pointMap(op.point)]);
          break;
        }
        case "point.delete": {
          const pts = cards.get(op.cardId)?.get("points");
          if (pts instanceof Y.Array) {
            const i = (pts.toArray() as Y.Map<unknown>[]).findIndex((p) => p.get("id") === op.pointId);
            if (i >= 0) pts.delete(i, 1);
          }
          break;
        }
        case "thesis.create": {
          const m = new Y.Map<unknown>();
          m.set("id", op.thesis.id);
          m.set("side", op.thesis.side);
          m.set("order", op.thesis.order);
          m.set("title", textOf(op.thesis.title));
          theses.set(op.thesis.id, m);
          break;
        }
        case "thesis.update": {
          const m = theses.get(op.id);
          if (m) for (const [k, v] of Object.entries(op.patch)) m.set(k, v as unknown);
          break;
        }
        case "thesis.delete":
          theses.delete(op.id);
          break;
        case "stage.set":
          if (room.get("stage") !== op.stage) room.set("stage", op.stage);
          break;
      }
    }
  }, origin);
}

/** Prep timer actions (synced room state, not part of undo). */
export function setPrepTimer(doc: Y.Doc, value: unknown) {
  doc.transact(() => {
    const room = roomMap(doc);
    if (room.get("v") !== SCHEMA_VERSION) room.set("v", SCHEMA_VERSION);
    room.set("prepTimer", value);
  }, TIMER);
}

/**
 * Ends prep for one timer run, at most once: inside one transaction it checks that the room is still in
 * Prep and that this run has not ended prep before, then marks the run and applies the stage change.
 * Two devices (or a reconnect) may both call it; the second finds the run marked / the stage moved, and
 * if both run it offline they write the same values, so the merged room is in the first speech once.
 */
export function advancePrepOnce(doc: Y.Doc, side: SideId, runId: string, prepStage: string, ops: Op[]): boolean {
  let done = false;
  doc.transact(() => {
    const room = roomMap(doc);
    const stage = typeof room.get("stage") === "string" ? room.get("stage") : prepStage;
    if (stage !== prepStage || room.get("prepAdvanced") === runId) return;
    room.set("prepAdvanced", runId);
    room.set("prepEnded", `${runId}:${doc.clientID}`);
    applyOpsToDoc(doc, side, ops, TIMER);
    done = true;
  }, TIMER);
  return done;
}

/** Room-level settings (round setup). */
export function setRoomField(doc: Y.Doc, key: "side" | "format" | "prepMinutes", value: unknown) {
  doc.transact(() => {
    const room = roomMap(doc);
    if (room.get("v") !== SCHEMA_VERSION) room.set("v", SCHEMA_VERSION);
    if (room.get(key) !== value) room.set(key, value);
  }, LOCAL);
}

export function setSpeechTime(doc: Y.Doc, speechId: string, minutes: number | null) {
  doc.transact(() => {
    const t = timesMap(doc);
    if (minutes == null) t.delete(speechId);
    else if (t.get(speechId) !== minutes) t.set(speechId, minutes);
  }, LOCAL);
}

export function getCardText(doc: Y.Doc, side: SideId, cardId: string): Y.Text | null {
  const t = cardsMap(doc, side).get(cardId)?.get("text");
  return t instanceof Y.Text ? t : null;
}

export function getPointText(doc: Y.Doc, side: SideId, cardId: string, pointId: string): Y.Text | null {
  const pts = cardsMap(doc, side).get(cardId)?.get("points");
  if (!(pts instanceof Y.Array)) return null;
  const p = (pts.toArray() as Y.Map<unknown>[]).find((x) => x.get("id") === pointId);
  const t = p?.get("text");
  return t instanceof Y.Text ? t : null;
}

export function getThesisTitle(doc: Y.Doc, side: SideId, thesisId: string): Y.Text | null {
  const t = thesesMap(doc, side).get(thesisId)?.get("title");
  return t instanceof Y.Text ? t : null;
}

/** Shared types tracked by undo/redo. */
export function undoScope(doc: Y.Doc, f: { sides: { id: string }[] }) {
  return [roomMap(doc), timesMap(doc), motionText(doc), ...f.sides.flatMap((s) => [cardsMap(doc, s.id), thesesMap(doc, s.id)])];
}
