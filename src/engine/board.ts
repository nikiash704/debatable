import type { FormatConfig, SpeechConfig, StageId } from "../config/types";
import { answerStatus, answersTo, laneCounter, targetsOf, unansweredCards, type AnswerStatus, type CounterPart } from "./clash";
import { byOrder } from "./order";
import { computeNumbers, thesesOf } from "./numbering";
import { layoutRows, type LaneLayout, type RowLayout } from "./rows";
import {
  cardLabel,
  columnState,
  currentSpeech,
  pointLabel,
  rebuttalInProgress,
  sideOf,
  speechById,
  stageIndex,
  stagesOf,
  strikesVisible,
  zonesFor,
  type ColumnState,
} from "./stages";
import type { Card, FlowState, Thesis, Zone } from "./types";

export interface CardVM {
  card: Card;
  number: number;
  label: string;
  pointLabels: string[];
  ours: boolean;
  /** Said and strike-throughs are visible at this stage. */
  struck: boolean;
  /** Our unsaid constructive card during our rebuttal: red + "new — don't say". */
  red: boolean;
  /** "from LO" when carried over. */
  fromLabel: string | null;
  /** Opponent cards: answered / unanswered / unanswerable (stage 2). Null for ours. */
  status: AnswerStatus | null;
  /** Opponent card no card of ours answers yet: the design's red "Unanswered" look. */
  unanswered: boolean;
  /** Our rebuttal: our card said in a constructive gets a green "said" highlight + "said in LOC". */
  saidGreen: boolean;
  saidMeta: string | null;
  /** Existing targets (ids, link order) and their current labels: "Responding to PM1, PM2". */
  targets: string[];
  targetLabels: string[];
  /** Cards that answer this one. */
  answeredBy: string[];
  /** Sits in its first target's row (not a row starter). */
  linked: boolean;
  /** Look: ours (green border), said (green tint), neutral (answered), unanswered (red), red (new — don't say). */
  tone: "ours" | "said" | "neutral" | "unanswered" | "red";
}

/** One arrow: answer card → target card. */
export interface LinkVM {
  from: string;
  to: string;
  /** Colour follows the answer card's status. */
  tone: "ours" | "neutral" | "red";
}

export interface GroupVM {
  thesis: Thesis | null;
  thesisNumber: number | null;
  cards: CardVM[];
}

export interface ZoneVM {
  zone: Zone;
  series: string;
  label: string | null;
  groups: GroupVM[];
}

export interface ColumnVM {
  speech: SpeechConfig;
  ours: boolean;
  state: ColumnState;
  current: boolean;
  /** "said X / Y" over this column while its speech is being given (our side only). */
  counter: { said: number; total: number } | null;
  /** "PM answered 4/5", "MG answered 1/2 · from PM left 1" on our live columns. */
  answerCounter: CounterPart[] | null;
  /** Rows, theses, add buttons and gaps of this lane. */
  lane: LaneLayout;
  zones: ZoneVM[];
  canAdd: boolean;
  /** Cards in on-screen order, top to bottom (keyboard navigation). */
  order: CardVM[];
}

export interface StepVM {
  id: StageId;
  label: string;
  state: "done" | "current" | "future";
}

export interface BoardVM {
  stage: StageId;
  stageIndex: number;
  steps: StepVM[];
  speech: SpeechConfig | null;
  columns: ColumnVM[];
  cards: Map<string, CardVM>;
  thesisNumbers: Map<string, number>;
  pooAvailable: boolean;
  layout: RowLayout;
  status: Map<string, AnswerStatus>;
  /** Unanswered opponent cards in board order (stage bar pill). */
  unanswered: CardVM[];
  links: LinkVM[];
  /** Our rebuttal is being given (green "said" highlights). */
  ourRebuttal: boolean;
}

export function speakerOf(f: FormatConfig, speechId: string | null): string | null {
  return speechById(f, speechId)?.speaker ?? null;
}

/**
 * Pure projection of the flow state into what the board shows.
 * `numbers` lets a drag preview keep the real labels until the drop.
 */
export function computeBoard(f: FormatConfig, state: FlowState, opts: { numbers?: Map<string, number> } = {}): BoardVM {
  const layout = layoutRows(f, state);
  const numbers = opts.numbers ?? computeNumbers(f, state, layout);
  const status = answerStatus(f, state);
  const stage = state.stage;
  const now = stageIndex(f, stage);
  const speech = currentSpeech(f, stage);
  const strikes = strikesVisible(f, stage);
  const ourRebuttal = !!speech && !speech.allowsNew && speech.side === state.perspective;
  const cards = new Map<string, CardVM>();

  const vm = (c: Card): CardVM => {
    const n = numbers.get(c.id) ?? 0;
    const ours = c.side === state.perspective;
    const owner = speechById(f, c.ownerSpeech);
    const constructive = owner ? owner.allowsNew : true;
    const said = speechById(f, c.saidIn);
    const st = ours ? null : (status.get(c.id) ?? null);
    const red = ourRebuttal && ours && constructive && !c.saidIn;
    const saidGreen = ourRebuttal && ours && !!said && said.allowsNew;
    const v: CardVM = {
      card: c,
      number: n,
      label: cardLabel(f, state.perspective, c, n),
      pointLabels: c.points.map((_, i) => pointLabel(n, i)),
      ours,
      struck: !!c.saidIn && (strikes || c.saidIn === stage),
      red,
      fromLabel: c.carriedFrom ? `from ${speakerOf(f, c.carriedFrom) ?? c.carriedFrom}` : null,
      status: st,
      unanswered: st === "unanswered",
      saidGreen,
      saidMeta: saidGreen ? `said in ${said!.label}` : null,
      targets: targetsOf(state, c),
      targetLabels: [],
      answeredBy: answersTo(state, c.id),
      linked: !!layout.parent.get(c.id),
      tone: red ? "red" : ours ? (saidGreen ? "said" : "ours") : st === "unanswered" ? "unanswered" : "neutral",
    };
    cards.set(c.id, v);
    return v;
  };

  const thesisNumbers = new Map<string, number>();
  for (const side of f.sides) thesesOf(state, side.id).forEach((t, i) => thesisNumbers.set(t.id, i + 1));

  const columns: ColumnVM[] = f.speeches.map((sp) => {
    const ours = sp.side === state.perspective;
    const st = columnState(f, state.perspective, sp, stage);
    const inCol = state.cards.filter((c) => c.ownerSpeech === sp.id);
    const zoneIds = zonesFor(state.perspective, sp);
    const zones: ZoneVM[] = zoneIds.map((zone) => {
      const zc = zoneIds.length === 1 ? inCol : inCol.filter((c) => c.zone === zone);
      const series = ours ? (sp.prefixSeries[zone] ?? "") : sp.opponentLabel;
      const label = zoneIds.length > 1 ? (zone === "clash" ? "Responses" : "Arguments") : null;
      if (zone === "clash" || !ours) {
        return { zone, series, label, groups: [{ thesis: null, thesisNumber: null, cards: [...zc].sort(byOrder).map(vm) }] };
      }
      const theses = thesesOf(state, sp.side);
      const known = new Set(theses.map((t) => t.id));
      const showEmpty = st === "live";
      const groups: GroupVM[] = [];
      for (const t of theses) {
        const tc = zc.filter((c) => c.thesisId === t.id).sort(byOrder);
        if (tc.length || showEmpty) groups.push({ thesis: t, thesisNumber: thesisNumbers.get(t.id) ?? null, cards: tc.map(vm) });
      }
      const loose = zc.filter((c) => !c.thesisId || !known.has(c.thesisId)).sort(byOrder);
      if (loose.length) groups.push({ thesis: null, thesisNumber: null, cards: loose.map(vm) });
      return { zone, series, label, groups };
    });
    const lane = layout.lanes.get(sp.id)!;
    const order = lane.cards.map((id) => cards.get(id) ?? vm(state.cards.find((c) => c.id === id)!));
    const current = speech?.id === sp.id;
    return {
      speech: sp,
      ours,
      state: st,
      current,
      counter: current && ours ? { said: inCol.filter((c) => !!c.saidIn).length, total: inCol.length } : null,
      answerCounter: laneCounter(f, state, sp.id, status),
      lane,
      zones,
      canAdd: st !== "future",
      order,
    };
  });

  for (const v of cards.values()) v.targetLabels = v.targets.map((t) => cards.get(t)?.label ?? "?");
  const links: LinkVM[] = [];
  for (const v of cards.values()) {
    const tone = v.tone === "red" || v.tone === "unanswered" ? "red" : v.ours ? "ours" : "neutral";
    for (const t of v.targets) if (cards.has(t)) links.push({ from: v.card.id, to: t, tone });
  }

  const steps: StepVM[] = stagesOf(f).map((s) => ({
    id: s.id,
    label: s.label,
    state: s.index < now ? "done" : s.index === now ? "current" : "future",
  }));

  return {
    stage,
    stageIndex: now,
    steps,
    speech,
    columns,
    cards,
    thesisNumbers,
    pooAvailable: rebuttalInProgress(f, stage),
    layout,
    status,
    unanswered: unansweredCards(f, layout, status).map((id) => cards.get(id)!).filter(Boolean),
    links,
    ourRebuttal,
  };
}

/** Speech-mode column for a device: the current speech if it is ours and the device's role speaks it. */
export function speechModeColumn(f: FormatConfig, state: FlowState, role: string | null): string | null {
  const sp = currentSpeech(f, state.stage);
  if (!sp || sp.side !== state.perspective) return null;
  return sp.speaker === role ? sp.id : null;
}

export function sideLabel(f: FormatConfig, side: string): string {
  return sideOf(f, side).label;
}
