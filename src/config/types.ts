/**
 * Format config schema. Everything format-specific lives here (CLAUDE.md: "format is config, not code").
 * The engine (src/engine) reads only these fields; it never names a speech, side or format.
 */

export type SideId = string;
export type SpeechId = string;
export type StageId = string;
export type TagType = "no-warrant" | "nonsense" | "same-as" | "contradicts" | "turn" | "poo";

export interface MemberConfig {
  /** Speaker id used by speeches, e.g. "PM", "LO". */
  id: string;
  /** Long name, e.g. "Prime Minister". */
  name: string;
}

export interface SideConfig {
  id: SideId;
  /** "Government" */
  label: string;
  /** "Gov" (lane side tag) */
  short: string;
  /** Card id prefix for this side's own cards: "G" → GA1, GC1, GR1. */
  prefix: string;
  members: MemberConfig[];
}

export interface SpeechConfig {
  id: SpeechId;
  /** Column / stage label, e.g. "PMC". */
  label: string;
  /** Lane subtitle, e.g. "Prime Minister Constructive". */
  title: string;
  side: SideId;
  /** Member id of the speaker. */
  speaker: string;
  /** Default length; a room can override it (tournaments differ). */
  minutes: number;
  /** false for rebuttals: no new arguments, POO is offered, unsaid cards turn red. */
  allowsNew: boolean;
  /**
   * Series of the speaking side's own cards in this column.
   * `clash` = answers at the top of the column, `own` = own arguments below, grouped by theses.
   * APDA: constructives A/C (PMC only A), rebuttals R.
   */
  prefixSeries: { clash?: string; own?: string };
  /** Series label when this speech is the opponent's: PM1, MG1, PMR1… */
  opponentLabel: string;
  /** Where unsaid cards of this speech move when it ends (LOC → MO, PMC → MG). */
  carriesTo: SpeechId | null;
  /** First stage at which this column's numbers are live (for the speaking side). */
  liveFrom: StageId;
  /** Speeches this one answers by default (used in stage 2 for arrows). */
  defaultTargets: SpeechId[];
  /** POI window in minutes from the start, if POIs are allowed (used later by the timer). */
  poiWindow?: { from: number; to: number } | null;
}

export interface TagConfig {
  type: TagType;
  label: string;
  /** Single-key hotkey shown in tooltips and the palette. */
  hotkey: string;
  /** Needs a referenced card (Same as… / Contradicts…). */
  needsRef?: boolean;
  /** Offered only while the current stage is a speech with allowsNew = false. */
  rebuttalOnly?: boolean;
  tone?: "default" | "alert";
}

export interface FormatConfig {
  id: string;
  name: string;
  short: string;
  /** Not offered in the UI (test / demo formats). */
  hidden?: boolean;
  /** Prep length in minutes (0 allowed). */
  prepMinutes: number;
  graceSeconds: number;
  prepStage: { id: StageId; label: string };
  reviewStage: { id: StageId; label: string };
  sides: SideConfig[];
  /** In speaking order. */
  speeches: SpeechConfig[];
  tags: TagConfig[];
  /** Defaults for a new room (spec: Opposition, LO). */
  defaults: { side: SideId; role: Record<SideId, string> };
}
