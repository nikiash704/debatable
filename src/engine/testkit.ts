import type { FormatConfig, SideId, TagType } from "../config/types";
import { computeBoard, type BoardVM } from "./board";
import * as clash from "./clash";
import * as cmd from "./commands";
import { layoutRows } from "./rows";
import { applyOps } from "./ops";
import { planStageChange } from "./transitions";
import type { FlowState, Zone } from "./types";

/** Test driver: holds a plain FlowState and runs engine commands on it with deterministic ids. */
export class Sim {
  state: FlowState;
  private n = 0;
  constructor(
    public f: FormatConfig,
    perspective: SideId,
  ) {
    this.state = { stage: f.prepStage.id, perspective, cards: [], theses: [] };
  }

  newId = () => `x${String(++this.n).padStart(3, "0")}`;

  run(r: cmd.Result): cmd.Result {
    this.state = applyOps(this.state, r.ops);
    return r;
  }

  board(): BoardVM {
    return computeBoard(this.f, this.state);
  }

  go(stage: string) {
    this.state = applyOps(this.state, planStageChange(this.f, this.state, stage));
  }

  thesis(title: string, after: string | null = null): string {
    const r = this.run(cmd.createThesis(this.state, this.state.perspective, after, this.newId, title));
    return (r.focus as { id: string }).id;
  }

  /** Adds a card at the end of a group (or after/before a card) and returns its id. */
  card(speech: string, text: string, opts: { zone?: Zone; thesis?: string | null; after?: string; before?: string; atStart?: boolean; points?: string[] } = {}): string {
    const r = this.run(
      cmd.createCard(
        this.f,
        this.state,
        { speech, zone: opts.zone ?? "own", thesisId: opts.thesis ?? null, after: opts.after, before: opts.before, atStart: opts.atStart },
        this.newId,
        text,
      ),
    );
    if (!r.focus) throw new Error(`could not create a card in ${speech}`);
    const id = (r.focus as { id: string }).id;
    for (const p of opts.points ?? []) this.run(cmd.addPoint(this.state, id, null, this.newId, p));
    return id;
  }

  say(id: string) {
    this.run(cmd.toggleSaid(this.f, this.state, id));
  }

  tag(id: string, type: TagType, ref?: string) {
    return this.run(cmd.toggleTag(this.f, this.state, id, type, ref));
  }

  label(id: string): string {
    return this.board().cards.get(id)!.label;
  }

  /** Labels of a column in on-screen order. */
  col(speech: string): string[] {
    return this.board()
      .columns.find((c) => c.speech.id === speech)!
      .order.map((c) => c.label);
  }

  /** R: answer a card; returns the new card's id. */
  answer(targetId: string, text = ""): string {
    const r = this.run(clash.answerCard(this.f, this.state, targetId, this.newId));
    if (!r.focus) throw new Error(`cannot answer ${targetId}: ${JSON.stringify(clash.answerPlace(this.f, this.state, targetId))}`);
    const id = (r.focus as { id: string }).id;
    if (text) this.state = { ...this.state, cards: this.state.cards.map((c) => (c.id === id ? { ...c, text } : c)) };
    return id;
  }

  link(cardId: string, targetId: string) {
    return this.run(clash.toggleLink(this.f, this.state, cardId, targetId));
  }

  rows() {
    return layoutRows(this.f, this.state);
  }

  /** Row index of a card. */
  row(id: string): number {
    return this.rows().rowOf.get(id)!;
  }

  card$(id: string) {
    return this.state.cards.find((c) => c.id === id)!;
  }
}
