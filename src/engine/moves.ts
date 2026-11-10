import type { FormatConfig, SpeechId } from "../config/types";
import type { Op } from "./ops";
import { byOrder, keyBetween, thesesOf } from "./order";
import type { RowLayout } from "./rows";
import { columnState, effectiveZone, hasTheses, speechById } from "./stages";
import type { Card, FlowState } from "./types";

/**
 * Drag and drop (spec 02 requirement 3), pure: where a dragged card / thesis / point may land and the
 * ops for landing there. Mouse, touch and keyboard (Alt+↑/↓ = previous / next slot) share these.
 * Moves change only `order` / `thesisId` (and a point's card), which merge safely between devices.
 * A card never changes its zone or lane. A linked answer stays inside its row's stack (its row is set
 * by its target; Link changes the target).
 */

export interface CardSlot {
  key: string;
  /** Thesis after the move (own zone with theses), otherwise the card's current one. */
  thesisId: string | null;
  /** Lands right before this card; null = at the end of the group. */
  before: string | null;
  order: string;
  /** For pointer hit-testing: the edge of a card, or the header of an empty thesis. */
  anchor: { cardId: string; edge: "top" | "bottom" } | { thesisId: string } | null;
}

export interface CardDrag {
  cardId: string;
  speech: SpeechId;
  /** row = linked answer, only inside its row; lane = anywhere in its zone of the lane. */
  mode: "row" | "lane";
  row: number;
  slots: CardSlot[];
  /** Slot equal to where the card is now. */
  current: number;
}

export function cardDrag(f: FormatConfig, state: FlowState, layout: RowLayout, cardId: string): CardDrag | null {
  const byId = new Map(state.cards.map((c) => [c.id, c]));
  const c = byId.get(cardId);
  const sp = c ? speechById(f, c.ownerSpeech) : null;
  const ln = sp ? layout.lanes.get(sp.id) : null;
  if (!c || !sp || !ln) return null;
  const persp = state.perspective;
  const zone = effectiveZone(persp, sp, c);
  const row = layout.rowOf.get(c.id) ?? 0;
  const thesisZone = hasTheses(state, sp, zone);
  const theses = thesesOf(state, persp);
  const known = new Set(theses.map((t) => t.id));
  const tOf = (x: Card) => (thesisZone && x.thesisId && known.has(x.thesisId) ? x.thesisId : null);

  if (layout.parent.get(c.id)) {
    // linked answer: reorder inside the stack of its row (same zone and thesis)
    const stack = (layout.rows[row]?.cells.get(sp.id) ?? []).map((id) => byId.get(id)!);
    const sib = stack.filter((x) => x.id !== c.id && effectiveZone(persp, sp, x) === zone && tOf(x) === tOf(c));
    const slots: CardSlot[] = sib.map((x, i) => ({
      key: `before:${x.id}`,
      thesisId: c.thesisId,
      before: x.id,
      order: keyBetween(sib[i - 1]?.order ?? null, x.order),
      anchor: { cardId: x.id, edge: "top" },
    }));
    const last = sib[sib.length - 1];
    slots.push({ key: "end", thesisId: c.thesisId, before: null, order: keyBetween(last?.order ?? null, null), anchor: last ? { cardId: last.id, edge: "bottom" } : null });
    const all = stack.filter((x) => effectiveZone(persp, sp, x) === zone && tOf(x) === tOf(c));
    const next = all[all.findIndex((x) => x.id === c.id) + 1];
    const current = next ? slots.findIndex((s) => s.before === next.id) : slots.length - 1;
    return { cardId, speech: sp.id, mode: "row", row, slots, current };
  }

  // row starter: anywhere among the lane's starters of the same origin and zone (between theses too)
  const origin = layout.origin.get(c.id)!;
  const originSp = speechById(f, origin)!;
  const isStarter = (x: Card) => !layout.parent.get(x.id) && layout.origin.get(x.id) === origin;
  const sameZone = (x: Card) => effectiveZone(persp, originSp, x) === effectiveZone(persp, originSp, c);
  const cand = ln.cards.map((id) => byId.get(id)!).filter((x) => x.id !== c.id && isStarter(x) && effectiveZone(persp, sp, x) === zone);
  // row order of the origin lane = (zone, thesis, order) over these "virtual groups", whatever lane a card is in now
  const vg = (t: string | null) => state.cards.filter((x) => x.id !== c.id && isStarter(x) && sameZone(x) && tOf(x) === t).sort(byOrder);

  const groups: (string | null)[] = [];
  if (thesisZone) {
    const live = columnState(f, persp, sp, state.stage) === "live" && origin === sp.id;
    for (const t of theses) if (live || t.id === tOf(c) || cand.some((x) => tOf(x) === t.id)) groups.push(t.id);
    if (tOf(c) === null || cand.some((x) => tOf(x) === null)) groups.push(null);
  } else {
    groups.push(null);
  }
  const slots: CardSlot[] = [];
  for (const t of groups) {
    const inG = cand.filter((x) => tOf(x) === t);
    const v = vg(t);
    for (const x of inG) {
      const i = v.findIndex((y) => y.id === x.id);
      slots.push({ key: `before:${x.id}`, thesisId: thesisZone ? t : c.thesisId, before: x.id, order: keyBetween(v[i - 1]?.order ?? null, x.order), anchor: { cardId: x.id, edge: "top" } });
    }
    const last = inG[inG.length - 1];
    slots.push({
      key: `end:${t ?? ""}`,
      thesisId: thesisZone ? t : c.thesisId,
      before: null,
      order: keyBetween(v[v.length - 1]?.order ?? null, null),
      anchor: last ? { cardId: last.id, edge: "bottom" } : t ? { thesisId: t } : null,
    });
  }
  const mine = ln.cards.map((id) => byId.get(id)!).filter((x) => x.id === c.id || cand.includes(x));
  const next = mine.slice(mine.findIndex((x) => x.id === c.id) + 1).find((x) => tOf(x) === tOf(c));
  const current = next ? slots.findIndex((s) => s.before === next.id) : slots.findIndex((s) => s.key === `end:${tOf(c) ?? ""}`);
  return { cardId, speech: sp.id, mode: "lane", row, slots, current };
}

export function moveCardOps(state: FlowState, cardId: string, slot: CardSlot): Op[] {
  const c = state.cards.find((x) => x.id === cardId);
  if (!c) return [];
  const patch: { order: string; thesisId?: string | null } = { order: slot.order };
  if (slot.thesisId !== c.thesisId) patch.thesisId = slot.thesisId;
  return [{ t: "card.update", id: cardId, patch }];
}

// ---------- theses ----------

export interface ThesisSlot {
  key: string;
  before: string | null;
  order: string;
}

export function thesisDrag(state: FlowState, thesisId: string): { slots: ThesisSlot[]; current: number } | null {
  const t = state.theses.find((x) => x.id === thesisId);
  if (!t) return null;
  const all = thesesOf(state, t.side);
  const others = all.filter((x) => x.id !== thesisId);
  const slots: ThesisSlot[] = others.map((x, i) => ({ key: `before:${x.id}`, before: x.id, order: keyBetween(others[i - 1]?.order ?? null, x.order) }));
  slots.push({ key: "end", before: null, order: keyBetween(others[others.length - 1]?.order ?? null, null) });
  const next = all[all.findIndex((x) => x.id === thesisId) + 1];
  return { slots, current: next ? slots.findIndex((s) => s.before === next.id) : slots.length - 1 };
}

export function moveThesisOps(thesisId: string, slot: ThesisSlot): Op[] {
  return [{ t: "thesis.update", id: thesisId, patch: { order: slot.order } }];
}

// ---------- points ----------

export interface PointSlot {
  key: string;
  cardId: string;
  /** Index in the target card's points once the moving point is taken out. */
  index: number;
  anchor: { pointId: string; edge: "top" } | { cardId: string; edge: "bottom" };
}

/** A point moves inside its card and between the cards of its lane. */
export function pointDrag(state: FlowState, layout: RowLayout, cardId: string, pointId: string): { slots: PointSlot[]; current: number } | null {
  const byId = new Map(state.cards.map((c) => [c.id, c]));
  const src = byId.get(cardId);
  if (!src || !src.points.some((p) => p.id === pointId)) return null;
  const ln = layout.lanes.get(src.ownerSpeech);
  if (!ln) return null;
  const slots: PointSlot[] = [];
  let current = -1;
  for (const id of ln.cards) {
    const k = byId.get(id)!;
    const pts = k.points.filter((p) => p.id !== pointId);
    pts.forEach((p, i) => slots.push({ key: `${k.id}:${i}`, cardId: k.id, index: i, anchor: { pointId: p.id, edge: "top" } }));
    slots.push({ key: `${k.id}:${pts.length}`, cardId: k.id, index: pts.length, anchor: { cardId: k.id, edge: "bottom" } });
    if (k.id === cardId) {
      const i = k.points.findIndex((p) => p.id === pointId);
      current = slots.findIndex((s) => s.cardId === k.id && s.index === i);
    }
  }
  return { slots, current };
}

export function movePointOps(state: FlowState, cardId: string, pointId: string, slot: PointSlot): Op[] {
  const src = state.cards.find((c) => c.id === cardId);
  const p = src?.points.find((x) => x.id === pointId);
  if (!src || !p) return [];
  if (slot.cardId === cardId && slot.index === src.points.indexOf(p)) return [];
  return [
    { t: "point.delete", cardId, pointId },
    { t: "point.insert", cardId: slot.cardId, index: slot.index, point: { id: p.id, text: p.text } },
  ];
}

/** Keyboard step (Alt+↑/↓): the neighbouring slot, or null at the edge. */
export function stepSlot(current: number, count: number, dir: -1 | 1): number | null {
  const n = current + dir;
  return current >= 0 && n >= 0 && n < count ? n : null;
}
