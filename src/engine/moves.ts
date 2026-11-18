import type { FormatConfig, SpeechId } from "../config/types";
import { isBlank } from "./auto";
import { canLink } from "./clash";
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
  /** Row slot: the card answers the argument directly to its left in that row (see `relinkOps`). */
  ops?: Op[];
  row?: number;
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

/**
 * Card drag slots. An answer (a linked card, or an unlinked card in our responses / rebuttal) can also be
 * dropped into any other row that has an argument it can answer directly to its left: it then answers
 * that argument, and the answers below shift down one row each (see `relinkOps`).
 */
export function cardDrag(f: FormatConfig, state: FlowState, layout: RowLayout, cardId: string): CardDrag | null {
  const base = baseCardDrag(f, state, layout, cardId);
  if (!base) return null;
  const rows = answerRows(f, state, layout, cardId);
  if (!rows) return base;
  const curRow = layout.parent.get(cardId) ? (layout.rowOf.get(cardId) ?? -1) : -1;
  const rowSlots: CardSlot[] = rows.slots
    .filter((x) => x.row !== curRow)
    .map((x) => ({
      key: `row:${x.row}`,
      thesisId: null,
      before: null,
      order: "",
      anchor: { cardId: x.target, edge: "top" },
      ops: relinkOps(state, rows, cardId, rows.slots.indexOf(x)),
      row: x.row,
    }));
  const cur = base.slots[base.current];
  let slots: CardSlot[];
  if (base.mode === "row") {
    // rows above, this row's stack, rows below
    const above = rowSlots.filter((x) => x.row! < curRow);
    const below = rowSlots.filter((x) => x.row! > curRow);
    slots = [...above, ...base.slots, ...below];
  } else {
    slots = [...rowSlots, ...base.slots];
  }
  return { ...base, slots, current: slots.indexOf(cur) };
}

interface AnswerRows {
  speech: SpeechId;
  /** Rows (top to bottom) with an argument directly to the left that the card can answer. */
  slots: { row: number; target: string }[];
  /** Index of the card's current row in `slots`, or -1. */
  current: number;
}

function answerRows(f: FormatConfig, state: FlowState, layout: RowLayout, cardId: string): AnswerRows | null {
  const c = state.cards.find((x) => x.id === cardId);
  const sp = c ? speechById(f, c.ownerSpeech) : null;
  if (!c || !sp) return null;
  const linked = !!layout.parent.get(cardId);
  const answerZone = c.side === state.perspective && effectiveZone(state.perspective, sp, c) === "clash";
  if (!linked && !answerZone) return null;
  const laneIdx = f.speeches.findIndex((s) => s.id === sp.id);
  const slots: { row: number; target: string }[] = [];
  layout.rows.forEach((r, i) => {
    for (let k = laneIdx - 1; k >= 0; k--) {
      const cell = r.cells.get(f.speeches[k].id) ?? [];
      const t = cell.find((id) => canLink(f, state, cardId, id));
      if (t) {
        slots.push({ row: i, target: t });
        return;
      }
      if (cell.length) return; // something else stands directly to the left
    }
  });
  if (!slots.length) return null;
  const row = linked ? layout.rowOf.get(cardId) : -1;
  return { speech: sp.id, slots, current: slots.findIndex((x) => x.row === row) };
}

/**
 * Dropping answer `cardId` into row slot `to`: it now answers that row's argument (its first target).
 * Moving up (or dropping an unlinked card): real answers of this lane already there shift down a row
 * each, until a row whose answer is only an empty slot (that slot moves into the row the card left, or is
 * removed) or the row the card left. Moving down: the answers in between move up one row (list order).
 */
export function relinkOps(state: FlowState, rows: AnswerRows, cardId: string, to: number): Op[] {
  const byId = new Map(state.cards.map((c) => [c.id, c]));
  const occupants = (i: number) =>
    state.cards.filter((c) => c.id !== cardId && c.ownerSpeech === rows.speech && c.respondsTo[0] === rows.slots[i].target);
  const ops: Op[] = [];
  const retarget = (id: string, target: string) => {
    const c = byId.get(id)!;
    const old = c.respondsTo[0];
    if (old === target) return;
    if (old) ops.push({ t: "card.unlink", id, target: old });
    if (c.respondsTo.includes(target)) ops.push({ t: "card.unlink", id, target });
    ops.push({ t: "card.link", id, target, first: true });
  };
  const from = rows.current;
  if (from >= 0 && to > from) {
    // moving down: the answers in between move up one row each (list order), the card lands at `to`
    for (let i = from + 1; i <= to; i++) for (const c of occupants(i)) retarget(c.id, rows.slots[i - 1].target);
    retarget(cardId, rows.slots[to].target);
    return ops;
  }
  // moving up (or an unlinked card): the answers from `to` shift down a row each
  let carry = [cardId];
  for (let i = to; ; i++) {
    if (i >= rows.slots.length) {
      for (const id of carry) {
        const old = byId.get(id)!.respondsTo[0];
        if (old) ops.push({ t: "card.unlink", id, target: old });
      }
      break;
    }
    const occ = occupants(i);
    const real = occ.filter((c) => !isBlank(c) && !carry.includes(c.id));
    const blanks = occ.filter((c) => isBlank(c) && !carry.includes(c.id));
    for (const id of carry) retarget(id, rows.slots[i].target);
    if (i === from) break;
    if (!real.length) {
      for (const b of blanks) {
        if (from >= 0) retarget(b.id, rows.slots[from].target);
        else ops.push({ t: "card.delete", id: b.id });
      }
      break;
    }
    carry = real.map((c) => c.id);
  }
  return ops;
}

function baseCardDrag(f: FormatConfig, state: FlowState, layout: RowLayout, cardId: string): CardDrag | null {
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
  if (slot.ops) return slot.ops;
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
