import type { FormatConfig, SpeechId } from "../config/types";
import { byOrder } from "./order";
import { zonesFor } from "./stages";
import type { Card, FlowState, Thesis } from "./types";

export function thesesOf(state: FlowState, side: string): Thesis[] {
  return state.theses.filter((t) => t.side === side).sort(byOrder);
}

/** Cards of one column in on-screen order: clash zone, then own zone by thesis, then ungrouped. */
export function columnOrder(f: FormatConfig, state: FlowState, speechId: SpeechId): Card[] {
  const speech = f.speeches.find((s) => s.id === speechId);
  if (!speech) return [];
  const inColumn = state.cards.filter((c) => c.ownerSpeech === speechId);
  const out: Card[] = [];
  for (const zone of zonesFor(state.perspective, speech)) {
    const zoneCards = inColumn.filter((c) => (zonesFor(state.perspective, speech).length === 1 ? true : c.zone === zone));
    if (zone === "clash" || speech.side !== state.perspective) {
      out.push(...zoneCards.sort(byOrder));
      continue;
    }
    const theses = thesesOf(state, speech.side);
    const known = new Set(theses.map((t) => t.id));
    for (const t of theses) out.push(...zoneCards.filter((c) => c.thesisId === t.id).sort(byOrder));
    out.push(...zoneCards.filter((c) => !c.thesisId || !known.has(c.thesisId)).sort(byOrder));
  }
  return out;
}

const seriesKey = (c: Pick<Card, "side" | "series">) => `${c.side}|${c.series}`;

/**
 * Card numbers (spec 02 «Нумерация»):
 * - locked cards keep their snapshot;
 * - live cards are numbered by position, continuing the series after every number already used
 *   in earlier columns and by locked cards in the same column (OC5 after LO's OC4, OA7 after OA6).
 */
export function computeNumbers(f: FormatConfig, state: FlowState): Map<string, number> {
  const numbers = new Map<string, number>();
  const running = new Map<string, number>();
  for (const speech of f.speeches) {
    const cards = columnOrder(f, state, speech.id);
    for (const c of cards) {
      if (c.numberLocked && c.displayNumber != null) {
        numbers.set(c.id, c.displayNumber);
        const k = seriesKey(c);
        running.set(k, Math.max(running.get(k) ?? 0, c.displayNumber));
      }
    }
    for (const c of cards) {
      if (c.numberLocked && c.displayNumber != null) continue;
      const k = seriesKey(c);
      const n = (running.get(k) ?? 0) + 1;
      running.set(k, n);
      numbers.set(c.id, n);
    }
  }
  return numbers;
}

/** Next free number in a series (used when a card is added to an already locked column). */
export function nextNumber(f: FormatConfig, state: FlowState, side: string, series: string): number {
  const numbers = computeNumbers(f, state);
  let max = 0;
  for (const c of state.cards) {
    if (c.side === side && c.series === series) max = Math.max(max, numbers.get(c.id) ?? 0);
  }
  return max + 1;
}
