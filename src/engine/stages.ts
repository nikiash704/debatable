import type { FormatConfig, SideId, SpeechConfig, StageId } from "../config/types";
import type { Card, FlowState, Zone } from "./types";

export interface StageInfo {
  id: StageId;
  label: string;
  index: number;
  speech: SpeechConfig | null;
}

/** Prep → speeches in order → review. */
export function stagesOf(f: FormatConfig): StageInfo[] {
  return [
    { id: f.prepStage.id, label: f.prepStage.label, index: 0, speech: null },
    ...f.speeches.map((s, i) => ({ id: s.id, label: s.label, index: i + 1, speech: s })),
    { id: f.reviewStage.id, label: f.reviewStage.label, index: f.speeches.length + 1, speech: null },
  ];
}

export function stageIndex(f: FormatConfig, stage: StageId): number {
  if (stage === f.prepStage.id) return 0;
  if (stage === f.reviewStage.id) return f.speeches.length + 1;
  const i = f.speeches.findIndex((s) => s.id === stage);
  return i < 0 ? 0 : i + 1;
}

export function stageAt(f: FormatConfig, index: number): StageId {
  const all = stagesOf(f);
  return all[Math.max(0, Math.min(all.length - 1, index))].id;
}

export function normalizeStage(f: FormatConfig, stage: StageId | null | undefined): StageId {
  if (!stage) return f.prepStage.id;
  return stageAt(f, stageIndex(f, stage)) === stage ? stage : f.prepStage.id;
}

export function speechById(f: FormatConfig, id: string | null | undefined): SpeechConfig | null {
  return (id && f.speeches.find((s) => s.id === id)) || null;
}

/** The speech being given at this stage, or null for prep/review. */
export function currentSpeech(f: FormatConfig, stage: StageId): SpeechConfig | null {
  return speechById(f, stage);
}

export function sideOf(f: FormatConfig, side: SideId) {
  return f.sides.find((s) => s.id === side) ?? f.sides[0];
}

export function otherSide(f: FormatConfig, side: SideId): SideId {
  return (f.sides.find((s) => s.id !== side) ?? f.sides[0]).id;
}

/** Strike-throughs show until the first speech with allowsNew = false (then they are cleared). */
export function strikesVisible(f: FormatConfig, stage: StageId): boolean {
  const first = f.speeches.findIndex((s) => !s.allowsNew);
  if (first < 0) return true;
  return stageIndex(f, stage) < first + 1;
}

/** POO is offered only while a rebuttal (allowsNew = false) is being given. */
export function rebuttalInProgress(f: FormatConfig, stage: StageId): boolean {
  const sp = currentSpeech(f, stage);
  return !!sp && !sp.allowsNew;
}

export type ColumnState = "future" | "live" | "locked";

/**
 * Our columns are live from `liveFrom` to the end of their speech; the opponent's columns are
 * live only during their own speech. Before that: future (narrow, dashed). After: locked.
 */
export function columnState(f: FormatConfig, perspective: SideId, speech: SpeechConfig, stage: StageId): ColumnState {
  const now = stageIndex(f, stage);
  const own = stageIndex(f, speech.id);
  const from = speech.side === perspective ? stageIndex(f, speech.liveFrom) : own;
  if (now > own) return "locked";
  if (now >= Math.min(from, own)) return "live";
  return "future";
}

/** Series for a new card in this column/zone. */
export function seriesFor(_f: FormatConfig, perspective: SideId, speech: SpeechConfig, zone: Zone): string {
  if (speech.side !== perspective) return speech.opponentLabel;
  return speech.prefixSeries[zone] ?? speech.prefixSeries.own ?? speech.prefixSeries.clash ?? "A";
}

/** Zones of a column in display order. */
export function zonesFor(perspective: SideId, speech: SpeechConfig): Zone[] {
  if (speech.side !== perspective) return ["own"];
  const z: Zone[] = [];
  if (speech.prefixSeries.clash) z.push("clash");
  if (speech.prefixSeries.own) z.push("own");
  return z.length ? z : ["own"];
}

/** "OA3", "GC1", "PM2". Our cards: side prefix + series + number; the opponent's: series + number. */
export function cardLabel(f: FormatConfig, perspective: SideId, card: Pick<Card, "side" | "series">, n: number): string {
  if (card.side === perspective) return `${sideOf(f, card.side).prefix}${card.series}${n}`;
  return `${card.series}${n}`;
}

/** "1a", "1b"… for points of card number n. */
export function pointLabel(n: number, i: number): string {
  let s = "";
  let k = i;
  do {
    s = String.fromCharCode(97 + (k % 26)) + s;
    k = Math.floor(k / 26) - 1;
  } while (k >= 0);
  return `${n}${s}`;
}

/** Our own-arguments zone is grouped by theses; answers, rebuttals and the opponent's columns are flat lists. */
export function hasTheses(state: Pick<FlowState, "perspective">, sp: SpeechConfig, zone: Zone): boolean {
  return sp.side === state.perspective && zone === "own" && !!sp.prefixSeries.own;
}

/** Zone a card is shown in inside a column (a single-zone column shows every card in its only zone). */
export function effectiveZone(perspective: SideId, sp: SpeechConfig, card: Pick<Card, "zone">): Zone {
  const zones = zonesFor(perspective, sp);
  return zones.length === 1 ? zones[0] : zones.includes(card.zone) ? card.zone : zones[zones.length - 1];
}

/** Speech index (0-based) in speaking order, or -1. */
export function speechIndex(f: FormatConfig, id: string | null | undefined): number {
  return id ? f.speeches.findIndex((s) => s.id === id) : -1;
}
