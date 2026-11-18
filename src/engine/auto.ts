import type { FormatConfig, SpeechConfig } from "../config/types";
import { answerPlace } from "./clash";
import { newCard, type IdGen } from "./commands";
import type { Op } from "./ops";
import { applyOps } from "./ops";
import { byOrder, keyBetween } from "./order";
import { columnState, seriesFor, speechById, speechIndex } from "./stages";
import type { Card, FlowState } from "./types";

/**
 * Automatic answer slots (user feedback after stage 2, 18.11.2026):
 *
 * 1. Every opponent argument we flow gets an empty answer card of ours at once, linked to it, in the column
 *    that answers it (PM1 → OC1 in LO; MG1 → OC in MO). The arrow shows before anything is typed.
 * 2. At the end of our speech, the empty answer cards whose target is still unanswered move on to our next
 *    speech (LOC → MO, MO → LOR; Government: MG → PMR), so a long arrow points from there to the gap.
 * 3. Our rebuttal (LOR / PMR) gets an empty "extension" card in the row of every argument of ours that was
 *    made in a constructive, from the moment the rebuttal column opens (LOR: during MO).
 *
 * An empty card (no text, no points) is a placeholder: it never counts as an answer, as "said", or in
 * counters, and it is removed when its only target goes away.
 */

export function isBlank(c: Pick<Card, "text" | "points">): boolean {
  return !c.text.trim() && c.points.length === 0;
}

/** Our rebuttal: the first speech of our side that allows no new arguments (LOR for the Opposition). */
export function ourRebuttal(f: FormatConfig, perspective: string): SpeechConfig | null {
  return f.speeches.find((s) => s.side === perspective && !s.allowsNew) ?? null;
}

/** Same-side links ("extensions") are allowed only from a rebuttal column to earlier columns of that side. */
export function isExtensionColumn(f: FormatConfig, speechId: string): boolean {
  const sp = speechById(f, speechId);
  return !!sp && !sp.allowsNew;
}

/** Text answers of ours to a card (empty placeholders do not count). */
export function realAnswers(state: FlowState, targetId: string): Card[] {
  return state.cards.filter((c) => c.side === state.perspective && c.id !== targetId && c.respondsTo.includes(targetId) && !isBlank(c));
}

/** An opponent card was just created: the empty answer card of ours for it (if a column can answer it now). */
export function autoAnswerOps(f: FormatConfig, state: FlowState, card: Card, newId: IdGen): Op[] {
  if (card.side === state.perspective) return [];
  const s = applyOps(state, [{ t: "card.create", card }]);
  const place = answerPlace(f, s, card.id);
  if (!place.ok) return [];
  const answer = newCard(f, s, place.slot, newId());
  if (!answer) return [];
  return [{ t: "card.create", card: { ...answer, respondsTo: [card.id] } }];
}

/** Empty answer of ours to `targetId` in a column that is open now (reused by R / "↩ Answer"). */
export function blankAnswerFor(f: FormatConfig, state: FlowState, targetId: string): Card | null {
  return (
    state.cards.find(
      (c) =>
        c.side === state.perspective &&
        c.respondsTo[0] === targetId &&
        isBlank(c) &&
        (() => {
          const sp = speechById(f, c.ownerSpeech);
          return !!sp && columnState(f, state.perspective, sp, state.stage) === "live";
        })(),
    ) ?? null
  );
}

/**
 * Our rebuttal column is open: every argument of ours made in a constructive gets an empty extension card
 * in it (one per argument); empty extensions of arguments that are no longer "made" are removed.
 */
export function syncExtensions(f: FormatConfig, state: FlowState, newId: IdGen): Op[] {
  const reb = ourRebuttal(f, state.perspective);
  if (!reb || columnState(f, state.perspective, reb, state.stage) !== "live") return [];
  const ops: Op[] = [];
  const inReb = state.cards.filter((c) => c.ownerSpeech === reb.id && c.side === state.perspective);
  const extended = new Set(inReb.flatMap((c) => c.respondsTo));
  const made = (c: Card) => {
    const said = speechById(f, c.saidIn);
    return c.side === state.perspective && c.ownerSpeech !== reb.id && !!said && said.allowsNew && !isBlank(c);
  };
  const byId = new Map(state.cards.map((c) => [c.id, c]));
  for (const x of inReb) {
    if (!isBlank(x) || x.respondsTo.length !== 1) continue;
    const t = byId.get(x.respondsTo[0]);
    if (t && t.side === state.perspective && !made(t)) ops.push({ t: "card.delete", id: x.id });
  }
  const sources = state.cards
    .filter((c) => made(c) && !extended.has(c.id))
    .sort((a, b) => speechIndex(f, a.ownerSpeech) - speechIndex(f, b.ownerSpeech) || byOrder(a, b));
  let last = [...inReb].sort(byOrder).pop()?.order ?? null;
  for (const src of sources) {
    const card = newCard(f, state, { speech: reb.id, zone: "clash", thesisId: null }, newId());
    if (!card) continue;
    last = keyBetween(last, null);
    ops.push({ t: "card.create", card: { ...card, order: last, respondsTo: [src.id] } });
  }
  return ops;
}

/**
 * End of our speech `ending`: empty answer cards in it whose target is still unanswered move on to our
 * next speech (carriesTo, else the next speech of our side), keeping `carriedFrom` so going back reverses
 * it; empty answers whose target got a real answer meanwhile are removed. Numbers stay live (an empty slot
 * is not a said argument).
 */
export function moveBlankAnswers(f: FormatConfig, state: FlowState, ending: SpeechConfig): Op[] {
  if (ending.side !== state.perspective) return [];
  const i = speechIndex(f, ending.id);
  const next = speechById(f, ending.carriesTo) ?? f.speeches.find((s, k) => k > i && s.side === ending.side) ?? null;
  const ops: Op[] = [];
  for (const c of state.cards) {
    if (c.ownerSpeech !== ending.id || c.side !== state.perspective || !isBlank(c) || !c.respondsTo.length) continue;
    const target = c.respondsTo[0];
    const t = state.cards.find((x) => x.id === target);
    if (!t || t.side === state.perspective) continue; // extensions stay
    if (realAnswers(state, target).length || !next) {
      ops.push({ t: "card.delete", id: c.id });
      continue;
    }
    ops.push({ t: "card.update", id: c.id, patch: {
        ownerSpeech: next.id,
        carriedFrom: ending.id,
        numberLocked: false,
        displayNumber: null,
        zone: "clash",
        series: seriesFor(f, state.perspective, next, "clash"),
      },
    });
  }
  return ops;
}
