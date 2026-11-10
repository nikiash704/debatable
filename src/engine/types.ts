import type { SideId, SpeechId, StageId, TagType } from "../config/types";

export type Zone = "clash" | "own";

export interface Point {
  id: string;
  text: string;
}

export interface Tag {
  type: TagType;
  /** Internal card id for same-as / contradicts; the UI shows that card's current number. */
  refCardId?: string | null;
}

/** Card: exactly the data model of spec 02 «Модель данных». */
export interface Card {
  /** Internal id, never changes. */
  id: string;
  /** Debate side the card belongs to (gov / opp). */
  side: SideId;
  /** Speech column the card lives in (LOC, MO, PMC for the opponent's…). */
  ownerSpeech: SpeechId;
  /** clash = answers at the top of the column, own = own arguments below. */
  zone: Zone;
  /** A / C / R for our cards; the speech label (PM, MG…) for the opponent's. */
  series: string;
  /** Snapshot of the number, valid when numberLocked. */
  displayNumber: number | null;
  numberLocked: boolean;
  /** Only for our own arguments (zone own). */
  thesisId: string | null;
  text: string;
  points: Point[];
  strong: boolean;
  tags: Tag[];
  /** Speech in which the card was said, or null. */
  saidIn: SpeechId | null;
  /** Speech the card was carried from (LO → MO), or null. */
  carriedFrom: SpeechId | null;
  /** Stage 2 (arrows). Stored from day one. */
  respondsTo: string[];
  /** Stage 3 (grouping the opponent's arguments). Stored from day one. */
  groupId: string | null;
  /** Fractional-index key; sorts the card inside its group. */
  order: string;
}

export interface Thesis {
  id: string;
  side: SideId;
  title: string;
  order: string;
}

/** Everything the engine needs about one side's flow plus the shared room stage. */
export interface FlowState {
  stage: StageId;
  /** Our side (the team that owns the room / this flow). */
  perspective: SideId;
  cards: Card[];
  theses: Thesis[];
}
