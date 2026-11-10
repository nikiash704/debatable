import type { FormatConfig, SpeechConfig, StageId } from "../config/types";
import { byOrder } from "./order";
import { columnOrder, computeNumbers, thesesOf } from "./numbering";
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
  zones: ZoneVM[];
  canAdd: boolean;
  /** Cards in on-screen order (for keyboard navigation). */
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
}

export function speakerOf(f: FormatConfig, speechId: string | null): string | null {
  return speechById(f, speechId)?.speaker ?? null;
}

/** Pure projection of the flow state into what the board shows. */
export function computeBoard(f: FormatConfig, state: FlowState): BoardVM {
  const numbers = computeNumbers(f, state);
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
    const v: CardVM = {
      card: c,
      number: n,
      label: cardLabel(f, state.perspective, c, n),
      pointLabels: c.points.map((_, i) => pointLabel(n, i)),
      ours,
      struck: !!c.saidIn && (strikes || c.saidIn === stage),
      red: ourRebuttal && ours && constructive && !c.saidIn,
      fromLabel: c.carriedFrom ? `from ${speakerOf(f, c.carriedFrom) ?? c.carriedFrom}` : null,
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
    const order = columnOrder(f, state, sp.id).map((c) => cards.get(c.id)!);
    const current = speech?.id === sp.id;
    return {
      speech: sp,
      ours,
      state: st,
      current,
      counter: current && ours ? { said: inCol.filter((c) => !!c.saidIn).length, total: inCol.length } : null,
      zones,
      canAdd: st !== "future",
      order,
    };
  });

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
