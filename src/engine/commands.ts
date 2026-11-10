import type { FormatConfig, SpeechId, TagType } from "../config/types";
import { nextNumber, thesesOf } from "./numbering";
import type { Op } from "./ops";
import { byOrder, keyBetween, keysBetween } from "./order";
import { columnState, currentSpeech, rebuttalInProgress, seriesFor, speechById, zonesFor } from "./stages";
import type { Card, FlowState, Tag, Thesis, Zone } from "./types";

/** Pure commands: (config, state, args) → ops. Ids come from the caller so commands stay deterministic. */
export type IdGen = () => string;

/** Where a new card goes: a column, a zone, a thesis group, and a position in that group. */
export interface Slot {
  speech: SpeechId;
  zone: Zone;
  thesisId: string | null;
  /** Insert after this card (null + before null = at the end). */
  after?: string | null;
  /** Insert before this card. */
  before?: string | null;
  /** Insert at the start of the group. */
  atStart?: boolean;
}

export interface Result {
  ops: Op[];
  /** What should be selected / edited next. */
  focus?: Focus;
}

export type Focus =
  | { kind: "card"; id: string; edit?: boolean }
  | { kind: "point"; cardId: string; pointId: string; edit?: boolean }
  | { kind: "thesis"; id: string; edit?: boolean };

const find = (state: FlowState, id: string) => state.cards.find((c) => c.id === id) ?? null;

/** Cards of the same group (column + zone + thesis), sorted. */
export function groupOf(f: FormatConfig, state: FlowState, speech: SpeechId, zone: Zone, thesisId: string | null): Card[] {
  const sp = speechById(f, speech);
  if (!sp) return [];
  const zones = zonesFor(state.perspective, sp);
  const single = zones.length === 1;
  const known = new Set(state.theses.map((t) => t.id));
  return state.cards
    .filter(
      (c) =>
        c.ownerSpeech === speech &&
        (single || c.zone === zone) &&
        (zone === "own" && sp.side === state.perspective && !single
          ? (thesisId ? c.thesisId === thesisId : !c.thesisId || !known.has(c.thesisId))
          : true),
    )
    .sort(byOrder);
}

export function groupOfCard(f: FormatConfig, state: FlowState, card: Card): Card[] {
  return groupOf(f, state, card.ownerSpeech, card.zone, card.thesisId);
}

function orderKeyFor(group: Card[], slot: Slot): string {
  if (slot.atStart) return keyBetween(null, group[0]?.order ?? null);
  if (slot.before) {
    const i = group.findIndex((c) => c.id === slot.before);
    if (i >= 0) return keyBetween(group[i - 1]?.order ?? null, group[i].order);
  }
  if (slot.after) {
    const i = group.findIndex((c) => c.id === slot.after);
    if (i >= 0) return keyBetween(group[i].order, group[i + 1]?.order ?? null);
  }
  return keyBetween(group[group.length - 1]?.order ?? null, null);
}

/** Builds a new card for a slot. Our columns use the speech's series; the opponent's use its label. */
export function newCard(f: FormatConfig, state: FlowState, slot: Slot, id: string, text = "", points: Card["points"] = []): Card | null {
  const sp = speechById(f, slot.speech);
  if (!sp) return null;
  const ours = sp.side === state.perspective;
  const zones = zonesFor(state.perspective, sp);
  const zone: Zone = zones.includes(slot.zone) ? slot.zone : zones[0];
  const series = seriesFor(f, state.perspective, sp, zone);
  const thesisId = ours && zone === "own" && zones.includes("own") && zones.length > 1 ? slot.thesisId : null;
  const group = groupOf(f, state, sp.id, zone, thesisId);
  const locked = columnState(f, state.perspective, sp, state.stage) === "locked";
  return {
    id,
    side: sp.side,
    ownerSpeech: sp.id,
    zone,
    series,
    displayNumber: locked ? nextNumber(f, state, sp.side, series) : null,
    numberLocked: locked,
    thesisId,
    text,
    points,
    strong: false,
    tags: [],
    saidIn: null,
    carriedFrom: null,
    respondsTo: [],
    groupId: null,
    order: orderKeyFor(group, { ...slot, zone, thesisId }),
  };
}

export function createCard(f: FormatConfig, state: FlowState, slot: Slot, newId: IdGen, text = ""): Result {
  const sp = speechById(f, slot.speech);
  if (!sp || columnState(f, state.perspective, sp, state.stage) === "future") return { ops: [] };
  const card = newCard(f, state, slot, newId(), text);
  if (!card) return { ops: [] };
  return { ops: [{ t: "card.create", card }], focus: { kind: "card", id: card.id, edit: true } };
}

/** Enter: a new card right below this one, in the same group. */
export function createCardBelow(f: FormatConfig, state: FlowState, cardId: string, newId: IdGen): Result {
  const c = find(state, cardId);
  if (!c) return { ops: [] };
  return createCard(f, state, { speech: c.ownerSpeech, zone: c.zone, thesisId: c.thesisId, after: c.id }, newId);
}

export function deleteCard(state: FlowState, cardId: string): Result {
  const c = find(state, cardId);
  if (!c) return { ops: [] };
  const ops: Op[] = [{ t: "card.delete", id: cardId }];
  for (const other of state.cards) {
    if (other.id === cardId) continue;
    if (other.tags.some((t) => t.refCardId === cardId)) {
      ops.push({ t: "card.update", id: other.id, patch: { tags: other.tags.filter((t) => t.refCardId !== cardId) } });
    }
  }
  return { ops };
}

/** Click in speech mode / Cmd+Enter: said ↔ not said, in the current speech. Only our cards. */
export function toggleSaid(f: FormatConfig, state: FlowState, cardId: string): Result {
  const c = find(state, cardId);
  const sp = currentSpeech(f, state.stage);
  if (!c || c.side !== state.perspective) return { ops: [] };
  if (c.saidIn) return { ops: [{ t: "card.update", id: c.id, patch: { saidIn: null } }] };
  if (!sp) return { ops: [] };
  return { ops: [{ t: "card.update", id: c.id, patch: { saidIn: sp.id } }] };
}

export function toggleStrong(state: FlowState, cardId: string): Result {
  const c = find(state, cardId);
  if (!c) return { ops: [] };
  return { ops: [{ t: "card.update", id: c.id, patch: { strong: !c.strong } }] };
}

/** Whether a tag can be offered now (POO only during rebuttals). */
export function tagAvailable(f: FormatConfig, state: FlowState, type: TagType): boolean {
  const cfg = f.tags.find((t) => t.type === type);
  if (!cfg) return false;
  return !cfg.rebuttalOnly || rebuttalInProgress(f, state.stage);
}

/**
 * Toggles a tag. Tags that need a card (same-as, contradicts) take `refCardId`; choosing the same
 * reference again removes the tag, a different one replaces it.
 */
export function toggleTag(f: FormatConfig, state: FlowState, cardId: string, type: TagType, refCardId?: string | null): Result {
  const c = find(state, cardId);
  const cfg = f.tags.find((t) => t.type === type);
  if (!c || !cfg || !tagAvailable(f, state, type)) return { ops: [] };
  let tags: Tag[];
  if (cfg.needsRef) {
    if (!refCardId || refCardId === cardId) {
      tags = c.tags.filter((t) => t.type !== type);
    } else {
      const same = c.tags.some((t) => t.type === type && t.refCardId === refCardId);
      tags = c.tags.filter((t) => t.type !== type);
      if (!same) tags.push({ type, refCardId });
    }
  } else {
    tags = c.tags.some((t) => t.type === type) ? c.tags.filter((t) => t.type !== type) : [...c.tags, { type }];
  }
  return { ops: [{ t: "card.update", id: c.id, patch: { tags } }] };
}

export function addPoint(state: FlowState, cardId: string, afterPointId: string | null, newId: IdGen, text = ""): Result {
  const c = find(state, cardId);
  if (!c) return { ops: [] };
  const i = afterPointId ? c.points.findIndex((p) => p.id === afterPointId) : c.points.length - 1;
  const point = { id: newId(), text };
  return {
    ops: [{ t: "point.insert", cardId, index: i + 1, point }],
    focus: { kind: "point", cardId, pointId: point.id, edit: true },
  };
}

export function deletePoint(state: FlowState, cardId: string, pointId: string): Result {
  const c = find(state, cardId);
  if (!c) return { ops: [] };
  const i = c.points.findIndex((p) => p.id === pointId);
  const prev = c.points[i - 1];
  return {
    ops: [{ t: "point.delete", cardId, pointId }],
    focus: prev ? { kind: "point", cardId, pointId: prev.id, edit: true } : { kind: "card", id: cardId, edit: true },
  };
}

/** Tab on a card: it becomes the last point of the card above (its own points follow it). */
export function indentCard(f: FormatConfig, state: FlowState, cardId: string, newId: IdGen): Result {
  const c = find(state, cardId);
  if (!c) return { ops: [] };
  const group = groupOfCard(f, state, c);
  const i = group.findIndex((x) => x.id === c.id);
  const prev = group[i - 1];
  if (!prev) return { ops: [] };
  const first = { id: newId(), text: c.text };
  const moved = [first, ...c.points.map((p) => ({ id: newId(), text: p.text }))];
  const ops: Op[] = moved.map((p, k) => ({ t: "point.insert", cardId: prev.id, index: prev.points.length + k, point: p }));
  ops.push(...deleteCard(state, c.id).ops);
  return { ops, focus: { kind: "point", cardId: prev.id, pointId: first.id, edit: true } };
}

/**
 * Shift+Tab on our own argument: it becomes a thesis placed after the current one; the cards below it
 * in the same thesis and its own points (as cards) move into the new thesis.
 */
export function outdentCard(f: FormatConfig, state: FlowState, cardId: string, newId: IdGen): Result {
  const c = find(state, cardId);
  if (!c) return { ops: [] };
  const sp = speechById(f, c.ownerSpeech);
  if (!sp || c.side !== state.perspective || c.zone !== "own" || !zonesFor(state.perspective, sp).includes("own") || zonesFor(state.perspective, sp).length < 2) {
    return { ops: [] };
  }
  const theses = thesesOf(state, c.side);
  const cur = theses.findIndex((t) => t.id === c.thesisId);
  const after = cur >= 0 ? theses[cur] : theses[theses.length - 1];
  const nextT = cur >= 0 ? theses[cur + 1] : undefined;
  const thesis: Thesis = {
    id: newId(),
    side: c.side,
    title: c.text,
    order: keyBetween(after?.order ?? null, nextT?.order ?? null),
  };
  const ops: Op[] = [{ t: "thesis.create", thesis }];
  const group = groupOfCard(f, state, c);
  const i = group.findIndex((x) => x.id === c.id);
  const following = group.slice(i + 1);
  const keys = keysBetween(null, null, c.points.length + following.length);
  c.points.forEach((p, k) => {
    const card = newCard(f, state, { speech: c.ownerSpeech, zone: "own", thesisId: thesis.id }, newId(), p.text);
    if (card) ops.push({ t: "card.create", card: { ...card, order: keys[k], numberLocked: false, displayNumber: null } });
  });
  following.forEach((x, k) => ops.push({ t: "card.update", id: x.id, patch: { thesisId: thesis.id, order: keys[c.points.length + k] } }));
  ops.push(...deleteCard(state, c.id).ops);
  return { ops, focus: { kind: "thesis", id: thesis.id, edit: true } };
}

/** Shift+Tab on a point: it becomes a card right below its card; the points after it move along. */
export function outdentPoint(f: FormatConfig, state: FlowState, cardId: string, pointId: string, newId: IdGen): Result {
  const c = find(state, cardId);
  if (!c) return { ops: [] };
  const i = c.points.findIndex((p) => p.id === pointId);
  if (i < 0) return { ops: [] };
  const rest = c.points.slice(i + 1);
  const card = newCard(
    f,
    state,
    { speech: c.ownerSpeech, zone: c.zone, thesisId: c.thesisId, after: c.id },
    newId(),
    c.points[i].text,
    rest.map((p) => ({ id: newId(), text: p.text })),
  );
  if (!card) return { ops: [] };
  const ops: Op[] = [{ t: "card.create", card }];
  for (const p of c.points.slice(i)) ops.push({ t: "point.delete", cardId: c.id, pointId: p.id });
  return { ops, focus: { kind: "card", id: card.id, edit: true } };
}

export function createThesis(state: FlowState, side: string, afterThesisId: string | null, newId: IdGen, title = ""): Result {
  const theses = thesesOf(state, side);
  const i = afterThesisId ? theses.findIndex((t) => t.id === afterThesisId) : theses.length - 1;
  const thesis: Thesis = {
    id: newId(),
    side,
    title,
    order: keyBetween(theses[i]?.order ?? null, theses[i + 1]?.order ?? null),
  };
  return { ops: [{ t: "thesis.create", thesis }], focus: { kind: "thesis", id: thesis.id, edit: true } };
}

/**
 * Tab on a thesis: its title becomes a card at the end of the previous thesis (in the given column),
 * and its cards move to the previous thesis, after that thesis's cards.
 */
export function indentThesis(f: FormatConfig, state: FlowState, thesisId: string, speech: SpeechId, newId: IdGen): Result {
  const t = state.theses.find((x) => x.id === thesisId);
  if (!t) return { ops: [] };
  const theses = thesesOf(state, t.side);
  const i = theses.findIndex((x) => x.id === thesisId);
  const prev = theses[i - 1];
  if (!prev) return { ops: [] };
  const ops: Op[] = [];
  const sp = speechById(f, speech);
  let focus: Focus | undefined;
  const columns = new Set(state.cards.filter((c) => c.thesisId === thesisId).map((c) => c.ownerSpeech));
  if (sp && sp.side === t.side) columns.add(sp.id);
  for (const col of columns) {
    const target = groupOf(f, state, col, "own", prev.id);
    const moving = groupOf(f, state, col, "own", thesisId);
    const titleCard = col === speech && t.title.trim() ? 1 : 0;
    const keys = keysBetween(target[target.length - 1]?.order ?? null, null, titleCard + moving.length);
    if (titleCard) {
      const card = newCard(f, state, { speech: col, zone: "own", thesisId: prev.id }, newId(), t.title);
      if (card) {
        ops.push({ t: "card.create", card: { ...card, order: keys[0] } });
        focus = { kind: "card", id: card.id, edit: true };
      }
    }
    moving.forEach((c, k) => ops.push({ t: "card.update", id: c.id, patch: { thesisId: prev.id, order: keys[titleCard + k] } }));
  }
  ops.push({ t: "thesis.delete", id: thesisId });
  return { ops, focus: focus ?? { kind: "thesis", id: prev.id } };
}

/** Deleting a thesis keeps its cards: they move to the previous thesis (or become ungrouped). */
export function deleteThesis(f: FormatConfig, state: FlowState, thesisId: string): Result {
  const t = state.theses.find((x) => x.id === thesisId);
  if (!t) return { ops: [] };
  const theses = thesesOf(state, t.side);
  const prev = theses[theses.findIndex((x) => x.id === thesisId) - 1] ?? null;
  const ops: Op[] = [];
  const columns = new Set(state.cards.filter((c) => c.thesisId === thesisId).map((c) => c.ownerSpeech));
  for (const col of columns) {
    const target = groupOf(f, state, col, "own", prev?.id ?? null);
    const moving = groupOf(f, state, col, "own", thesisId);
    const keys = keysBetween(target[target.length - 1]?.order ?? null, null, moving.length);
    moving.forEach((c, k) => ops.push({ t: "card.update", id: c.id, patch: { thesisId: prev?.id ?? null, order: keys[k] } }));
  }
  ops.push({ t: "thesis.delete", id: thesisId });
  return { ops, focus: prev ? { kind: "thesis", id: prev.id } : undefined };
}
