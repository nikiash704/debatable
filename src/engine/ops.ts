import type { StageId } from "../config/types";
import type { Card, FlowState, Point, Thesis } from "./types";

/** Atomic changes. The sync layer applies the same ops to the Yjs document. Text edits go straight to Y.Text. */
/** `respondsTo` is changed only through card.link / card.unlink (a Y.Array per card, safe on two devices). */
export type CardPatch = Partial<Omit<Card, "id" | "text" | "points" | "respondsTo">>;
export type ThesisPatch = Partial<Omit<Thesis, "id" | "title">>;

export type Op =
  | { t: "card.create"; card: Card }
  | { t: "card.update"; id: string; patch: CardPatch }
  | { t: "card.delete"; id: string }
  /** Adds a target to the end of a card's respondsTo (no duplicates). */
  | { t: "card.link"; id: string; target: string }
  /** Removes a target from a card's respondsTo. */
  | { t: "card.unlink"; id: string; target: string }
  | { t: "point.insert"; cardId: string; index: number; point: Point }
  | { t: "point.delete"; cardId: string; pointId: string }
  | { t: "thesis.create"; thesis: Thesis }
  | { t: "thesis.update"; id: string; patch: ThesisPatch }
  | { t: "thesis.delete"; id: string }
  | { t: "stage.set"; stage: StageId };

/** Applies ops to a plain state (used by tests and by multi-step planning). */
export function applyOps(state: FlowState, ops: Op[]): FlowState {
  let s = state;
  for (const op of ops) s = applyOp(s, op);
  return s;
}

function applyOp(s: FlowState, op: Op): FlowState {
  switch (op.t) {
    case "card.create":
      return { ...s, cards: [...s.cards.filter((c) => c.id !== op.card.id), op.card] };
    case "card.update":
      return { ...s, cards: s.cards.map((c) => (c.id === op.id ? { ...c, ...op.patch } : c)) };
    case "card.delete":
      return { ...s, cards: s.cards.filter((c) => c.id !== op.id) };
    case "card.link":
      return {
        ...s,
        cards: s.cards.map((c) => (c.id === op.id && !c.respondsTo.includes(op.target) ? { ...c, respondsTo: [...c.respondsTo, op.target] } : c)),
      };
    case "card.unlink":
      return {
        ...s,
        cards: s.cards.map((c) => (c.id === op.id && c.respondsTo.includes(op.target) ? { ...c, respondsTo: c.respondsTo.filter((x) => x !== op.target) } : c)),
      };
    case "point.insert":
      return {
        ...s,
        cards: s.cards.map((c) => {
          if (c.id !== op.cardId) return c;
          const points = [...c.points];
          points.splice(Math.max(0, Math.min(op.index, points.length)), 0, op.point);
          return { ...c, points };
        }),
      };
    case "point.delete":
      return {
        ...s,
        cards: s.cards.map((c) => (c.id === op.cardId ? { ...c, points: c.points.filter((p) => p.id !== op.pointId) } : c)),
      };
    case "thesis.create":
      return { ...s, theses: [...s.theses.filter((t) => t.id !== op.thesis.id), op.thesis] };
    case "thesis.update":
      return { ...s, theses: s.theses.map((t) => (t.id === op.id ? { ...t, ...op.patch } : t)) };
    case "thesis.delete":
      return { ...s, theses: s.theses.filter((t) => t.id !== op.id) };
    case "stage.set":
      return { ...s, stage: op.stage };
  }
}
