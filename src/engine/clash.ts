import type { FormatConfig, SpeechId } from "../config/types";
import { newCard, type IdGen, type Result, type Slot } from "./commands";
import type { Op } from "./ops";
import type { RowLayout } from "./rows";
import { columnState, sideOf, speechById, speechIndex, zonesFor } from "./stages";
import type { Card, FlowState } from "./types";

/**
 * Answer links (spec 02 stage 2): a card answers one or more cards of the other side from an earlier
 * speech. Targets are stored by internal id in `respondsTo`; the UI shows their current numbers.
 */

const find = (state: FlowState, id: string) => state.cards.find((c) => c.id === id) ?? null;

/** Can `cardId` answer `targetId`? Other side, strictly earlier speech, both exist. */
export function canLink(f: FormatConfig, state: FlowState, cardId: string, targetId: string): boolean {
  const a = find(state, cardId);
  const t = find(state, targetId);
  if (!a || !t || a.id === t.id || a.side === t.side) return false;
  const ia = speechIndex(f, a.ownerSpeech);
  const it = speechIndex(f, t.ownerSpeech);
  return ia >= 0 && it >= 0 && it < ia;
}

/** Cards `cardId` may link to (eligible targets of the Link pick mode). */
export function linkTargets(f: FormatConfig, state: FlowState, cardId: string): Set<string> {
  const out = new Set<string>();
  for (const c of state.cards) if (canLink(f, state, cardId, c.id)) out.add(c.id);
  return out;
}

export type AnswerPlace = { ok: true; slot: Slot } | { ok: false; reason: string };

/**
 * Where an answer to `targetId` goes: the earliest live column of the other side after the target's
 * speech (its clash zone when it has one). PM1 during PMC → LO; OA1 during MG → MG; PM4 during MG/MO → MO.
 */
export function answerPlace(f: FormatConfig, state: FlowState, targetId: string): AnswerPlace {
  const t = find(state, targetId);
  if (!t) return { ok: false, reason: "No card selected" };
  const from = speechIndex(f, t.ownerSpeech);
  const later = f.speeches.filter((s, i) => i > from && s.side !== t.side);
  const other = sideOf(f, later[0]?.side ?? f.sides.find((s) => s.id !== t.side)?.id ?? t.side).label;
  const own = speechById(f, t.ownerSpeech)?.label ?? t.ownerSpeech;
  if (!later.length) return { ok: false, reason: `No ${other} speech comes after ${own}` };
  const sp = later.find((s) => columnState(f, state.perspective, s, state.stage) === "live");
  if (!sp) return { ok: false, reason: `No live ${other} column after ${own} yet (${later.map((s) => s.label).join(", ")} not open)` };
  const zones = zonesFor(state.perspective, sp);
  return { ok: true, slot: { speech: sp.id, zone: zones.includes("clash") ? "clash" : zones[0], thesisId: null } };
}

/** R / "↩ Answer": a new empty card linked to the target, in the right column, ready to type. */
export function answerCard(f: FormatConfig, state: FlowState, targetId: string, newId: IdGen): Result {
  const place = answerPlace(f, state, targetId);
  if (!place.ok) return { ops: [] };
  const card = newCard(f, state, place.slot, newId());
  if (!card) return { ops: [] };
  return {
    ops: [{ t: "card.create", card: { ...card, respondsTo: [targetId] } }],
    focus: { kind: "card", id: card.id, edit: true },
  };
}

/** Link pick mode: toggles one target (link if eligible, unlink if already linked). */
export function toggleLink(f: FormatConfig, state: FlowState, cardId: string, targetId: string): Result {
  const c = find(state, cardId);
  if (!c) return { ops: [] };
  if (c.respondsTo.includes(targetId)) return { ops: [{ t: "card.unlink", id: cardId, target: targetId }] };
  if (!canLink(f, state, cardId, targetId)) return { ops: [] };
  return { ops: [{ t: "card.link", id: cardId, target: targetId }] };
}

export function unlinkCard(state: FlowState, cardId: string, targetId: string): Result {
  const c = find(state, cardId);
  if (!c || !c.respondsTo.includes(targetId)) return { ops: [] };
  return { ops: [{ t: "card.unlink", id: cardId, target: targetId }] };
}

/** Removes a deleted card from every `respondsTo`. */
export function unlinkEverywhere(state: FlowState, cardId: string): Op[] {
  return state.cards.filter((c) => c.id !== cardId && c.respondsTo.includes(cardId)).map((c) => ({ t: "card.unlink", id: c.id, target: cardId }) as Op);
}

/** Existing targets of a card, in link order (dangling ids from a concurrent delete are skipped). */
export function targetsOf(state: FlowState, card: Card): string[] {
  const ids = new Set(state.cards.map((c) => c.id));
  return card.respondsTo.filter((t) => ids.has(t) && t !== card.id);
}

/** Cards that answer `cardId`. */
export function answersTo(state: FlowState, cardId: string): string[] {
  return state.cards.filter((c) => c.id !== cardId && c.respondsTo.includes(cardId)).map((c) => c.id);
}

// ---------- answered status, counters, the unanswered list ----------

export type AnswerStatus = "answered" | "unanswered" | "unanswerable";

/**
 * Status of every opponent card: answered when at least one of our cards links to it (said or not);
 * unanswerable when the format has no speech of ours after its speech (Opposition: PMR cards).
 */
export function answerStatus(f: FormatConfig, state: FlowState): Map<string, AnswerStatus> {
  const persp = state.perspective;
  const answered = new Set<string>();
  for (const c of state.cards) if (c.side === persp) for (const t of c.respondsTo) answered.add(t);
  const lastOurs = f.speeches.reduce((m, s, i) => (s.side === persp ? i : m), -1);
  const out = new Map<string, AnswerStatus>();
  for (const c of state.cards) {
    if (c.side === persp) continue;
    const i = speechIndex(f, c.ownerSpeech);
    out.set(c.id, i < 0 || i >= lastOurs ? "unanswerable" : answered.has(c.id) ? "answered" : "unanswered");
  }
  return out;
}

export interface CounterPart {
  speech: SpeechId;
  /** Opponent label of the answered speech: "PM", "MG". */
  label: string;
  /** First default target: "MG answered x/y"; later ones: "from PM left z". */
  kind: "answered" | "left";
  answered: number;
  total: number;
  left: number;
  text: string;
}

/** Lane counter of one of our live columns, built from that speech's `defaultTargets`. */
export function laneCounter(f: FormatConfig, state: FlowState, speechId: SpeechId, status: Map<string, AnswerStatus>): CounterPart[] | null {
  const sp = speechById(f, speechId);
  if (!sp || sp.side !== state.perspective || columnState(f, state.perspective, sp, state.stage) !== "live") return null;
  const parts: CounterPart[] = [];
  sp.defaultTargets.forEach((tid, i) => {
    const t = speechById(f, tid);
    if (!t || t.side === state.perspective) return;
    const cards = state.cards.filter((c) => c.ownerSpeech === t.id && status.has(c.id) && status.get(c.id) !== "unanswerable");
    if (!cards.length) return;
    const answered = cards.filter((c) => status.get(c.id) === "answered").length;
    const kind = i === 0 ? "answered" : "left";
    const left = cards.length - answered;
    parts.push({
      speech: t.id,
      label: t.opponentLabel,
      kind,
      answered,
      total: cards.length,
      left,
      text: kind === "answered" ? `${t.opponentLabel} answered ${answered}/${cards.length}` : `from ${t.opponentLabel} left ${left}`,
    });
  });
  return parts.length ? parts : null;
}

/** Unanswered opponent cards in board order (speech order, then top to bottom). */
export function unansweredCards(f: FormatConfig, layout: RowLayout, status: Map<string, AnswerStatus>): string[] {
  const out: string[] = [];
  for (const sp of f.speeches) for (const id of layout.lanes.get(sp.id)?.cards ?? []) if (status.get(id) === "unanswered") out.push(id);
  return out;
}
