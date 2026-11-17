/**
 * Flow context for AI sentence suggestions (plan docs/plans/ai-suggestions.md, Phase 1d).
 *
 * Given the flow state, the format config, the motion and the field being edited, builds the
 * `SuggestInput` that field sends to `POST /api/suggest` (contract: src/shared/suggest.ts).
 * Pure: reads only plain data, never the DOM or React. The call sites pass it to `YTextEditor`
 * as a lazy getter (`suggestFromSession`), so it runs only when the editor asks, on the state of
 * that moment.
 */
import { getFormat } from "../../config/formats";
import type { FormatConfig, SpeechConfig } from "../../config/types";
import { targetsOf } from "../../engine/clash";
import { thesesOf } from "../../engine/order";
import { layoutRows } from "../../engine/rows";
import { columnState, effectiveZone, speechById, speechIndex } from "../../engine/stages";
import type { Card, FlowState } from "../../engine/types";
import { SUGGEST_LIMITS, type SuggestContext, type SuggestField, type SuggestInput } from "../../shared/suggest";
import type { RoomSnapshot } from "../../sync/doc";

/** The field being edited. Same shape as the engine's `Focus` (plus the motion). */
export type SuggestTarget =
  | { kind: "card"; id: string }
  | { kind: "point"; cardId: string; pointId: string }
  /** `speech`: the column the thesis head is shown in (board); otherwise derived from its cards. */
  | { kind: "thesis"; id: string; speech?: string | null }
  | { kind: "motion" };

export interface SuggestSource {
  /** Room code. */
  room: string;
  format: FormatConfig;
  flow: FlowState;
  motion: string;
}

export interface SuggestOptions {
  /** The field is a line of the Doc view (field `doc-thesis` / `doc-card` / `doc-point`). */
  doc?: boolean;
}

/** "A few" nearby notes as a style reference (never more than the contract's list cap). */
const SIBLINGS = Math.min(4, SUGGEST_LIMITS.listItems);

/** Collapses whitespace and caps the length at `SUGGEST_LIMITS.contextItem` (ellipsis when cut). */
export function clip(s: string | null | undefined, max: number = SUGGEST_LIMITS.contextItem): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  // keep room for the ellipsis; never leave half of a surrogate pair at the cut
  return `${t.slice(0, max - 1).replace(/[\uD800-\uDBFF]$/, "").trimEnd()}…`;
}

/** Clipped, non-empty, de-duplicated, at most `n` (and the contract's list cap). */
function list(items: (string | null | undefined)[], n: number = SUGGEST_LIMITS.listItems): string[] {
  const out: string[] = [];
  for (const it of items) {
    const t = clip(it);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= Math.min(n, SUGGEST_LIMITS.listItems)) break;
  }
  return out;
}

/** Indices of `items` sorted by distance from `at` (the one above first on a tie), excluding `at`. */
function nearest<T>(items: T[], at: number): T[] {
  return items
    .map((it, i) => ({ it, i, d: Math.abs(i - at) + (i > at ? 0.5 : 0) }))
    .filter((x) => x.i !== at)
    .sort((a, b) => a.d - b.d)
    .map((x) => x.it);
}

/** Cards of a speech column in on-screen order (falls back to the stored order if the layout lacks it). */
function columnCards(f: FormatConfig, flow: FlowState, speech: string): Card[] {
  const byId = new Map(flow.cards.map((c) => [c.id, c]));
  let ids: string[] = [];
  try {
    ids = layoutRows(f, flow).lanes.get(speech)?.cards ?? [];
  } catch {
    ids = [];
  }
  const ordered = ids.map((id) => byId.get(id)).filter((c): c is Card => !!c);
  const seen = new Set(ordered.map((c) => c.id));
  for (const c of flow.cards) if (c.ownerSpeech === speech && !seen.has(c.id)) ordered.push(c);
  return ordered;
}

/**
 * Up to SIBLINGS non-empty card titles of the column, in on-screen order: the nearest cards of the same
 * zone (responses / arguments) first, then the nearest of the rest of the column.
 */
function siblingCards(f: FormatConfig, flow: FlowState, card: Card, n = SIBLINGS): string[] {
  const cards = columnCards(f, flow, card.ownerSpeech);
  const sp = speechById(f, card.ownerSpeech);
  const zoneOf = (c: Card) => (sp ? effectiveZone(flow.perspective, sp, c) : c.zone);
  const zone = zoneOf(card);
  const same = cards.filter((c) => c.id === card.id || zoneOf(c) === zone);
  const rest = cards.filter((c) => c.id === card.id || zoneOf(c) !== zone);
  const around = (list: Card[]) => {
    const at = list.findIndex((c) => c.id === card.id);
    return at < 0 ? list : nearest(list, at);
  };
  const pool = [...around(same), ...around(rest)].filter((c) => c.id !== card.id && clip(c.text));
  const picked = new Set(pool.slice(0, n).map((c) => c.id));
  return list(cards.filter((c) => picked.has(c.id)).map((c) => c.text), n);
}

/** Text of the cards a card answers (`respondsTo`, existing targets in link order). */
function answersOf(flow: FlowState, card: Card): string[] {
  const byId = new Map(flow.cards.map((c) => [c.id, c]));
  return list(targetsOf(flow, card).map((id) => byId.get(id)?.text));
}

/** Column a thesis belongs to when the call site does not say: its first card's, else our live arguments column. */
function thesisSpeech(f: FormatConfig, flow: FlowState, thesisId: string): SpeechConfig | null {
  const first = flow.cards
    .filter((c) => c.thesisId === thesisId)
    .sort((a, b) => speechIndex(f, a.ownerSpeech) - speechIndex(f, b.ownerSpeech))[0];
  const fromCard = speechById(f, first?.ownerSpeech);
  if (fromCard) return fromCard;
  // same rule as the Doc view's column for new arguments
  const ours = f.speeches.filter((s) => s.side === flow.perspective && s.prefixSeries.own);
  const live = ours.find((s) => columnState(f, flow.perspective, s, flow.stage) === "live");
  return live ?? [...ours].reverse().find((s) => columnState(f, flow.perspective, s, flow.stage) !== "future") ?? ours[0] ?? null;
}

/** Drops empty strings and empty lists, so the request carries only what is known. */
function compact(c: SuggestContext): SuggestContext {
  const out: SuggestContext = { format: c.format, side: c.side };
  if (c.speech) out.speech = c.speech;
  if (c.motion) out.motion = c.motion;
  if (c.thesis) out.thesis = c.thesis;
  if (c.card) out.card = c.card;
  if (c.answers?.length) out.answers = c.answers;
  if (c.siblings?.length) out.siblings = c.siblings;
  return out;
}

/**
 * What the field `target` sends to /api/suggest, or null when the field no longer exists
 * (a partner deleted the card / point / thesis).
 */
export function buildSuggestInput(src: SuggestSource, target: SuggestTarget, opts: SuggestOptions = {}): SuggestInput | null {
  const { format: f, flow } = src;
  const field = (kind: "card" | "point" | "thesis"): SuggestField => (opts.doc ? `doc-${kind}` : kind);
  const base: SuggestContext = { format: clip(f.id), side: clip(flow.perspective) };
  const motion = clip(src.motion);
  const thesisTitle = (id: string | null) => clip(id ? flow.theses.find((t) => t.id === id)?.title : "");

  switch (target.kind) {
    case "motion":
      // the motion is the text being typed: not repeated as context
      return { room: src.room, field: "motion", context: compact(base) };

    case "thesis": {
      const thesis = flow.theses.find((t) => t.id === target.id);
      if (!thesis) return null;
      const sp = speechById(f, target.speech) ?? thesisSpeech(f, flow, thesis.id);
      const others = thesesOf(flow, thesis.side).filter((t) => t.id !== thesis.id);
      const at = thesesOf(flow, thesis.side).findIndex((t) => t.id === thesis.id);
      const near = new Set(nearest(thesesOf(flow, thesis.side), at).filter((t) => clip(t.title)).slice(0, SIBLINGS).map((t) => t.id));
      return {
        room: src.room,
        field: field("thesis"),
        context: compact({
          ...base,
          speech: clip(sp?.label),
          motion,
          siblings: list(others.filter((t) => near.has(t.id)).map((t) => t.title), SIBLINGS),
        }),
      };
    }

    case "card": {
      const card = flow.cards.find((c) => c.id === target.id);
      if (!card) return null;
      return {
        room: src.room,
        field: field("card"),
        context: compact({
          ...base,
          speech: clip(speechById(f, card.ownerSpeech)?.label),
          motion,
          thesis: thesisTitle(card.thesisId),
          answers: answersOf(flow, card),
          siblings: siblingCards(f, flow, card),
        }),
      };
    }

    case "point": {
      const card = flow.cards.find((c) => c.id === target.cardId);
      const at = card ? card.points.findIndex((p) => p.id === target.pointId) : -1;
      if (!card || at < 0) return null;
      // style reference: the card's other points first, then nearby card titles of the column
      const points = nearest(card.points, at).map((p) => p.text);
      return {
        room: src.room,
        field: field("point"),
        context: compact({
          ...base,
          speech: clip(speechById(f, card.ownerSpeech)?.label),
          motion,
          thesis: thesisTitle(card.thesisId),
          card: clip(card.text),
          answers: answersOf(flow, card),
          siblings: list([...list(points, SIBLINGS), ...siblingCards(f, flow, card)], SIBLINGS),
        }),
      };
    }
  }
}

/** What a room session exposes that the getter needs (structural, so tests can pass a plain object). */
export interface SuggestSession {
  readonly code: string;
  getSnapshot: () => Pick<RoomSnapshot, "formatId" | "flow" | "motion">;
}

/**
 * Lazy getter for `YTextEditor`'s `suggest` prop: reads the session's current snapshot at the moment
 * the editor asks (not at render time) and builds the input for `target`.
 */
export function suggestFromSession(session: SuggestSession, target: SuggestTarget, opts: SuggestOptions = {}): SuggestInput | null {
  const snap = session.getSnapshot();
  return buildSuggestInput({ room: session.code, format: getFormat(snap.formatId), flow: snap.flow, motion: snap.motion }, target, opts);
}
