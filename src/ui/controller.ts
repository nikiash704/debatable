import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormatConfig, TagType } from "../config/types";
import {
  addPoint,
  answerCard,
  answerPlace,
  cardDrag,
  computeBoard,
  computeNumbers,
  moveCardOps,
  movePointOps,
  moveThesisOps,
  pointDrag,
  stepSlot,
  thesisDrag,
  createCard,
  createCardBelow,
  createThesis,
  deleteCard,
  deletePoint,
  deleteThesis,
  indentCard,
  indentThesis,
  nextStage,
  outdentCard,
  outdentPoint,
  planStageChange,
  prevStage,
  speechModeColumn,
  tagAvailable,
  toggleSaid,
  toggleStrong,
  toggleLink,
  toggleTag,
  unlinkCard,
  type AnswerPlace,
  type BoardVM,
  type ColumnVM,
  type Focus,
  type Result,
  type Slot,
} from "../engine";
import type { FlowState } from "../engine/types";
import { randomId } from "../sync/storage";
import type { RoomSession } from "../sync/session";

export type View = "board" | "doc";

export interface UiState {
  selection: Focus | null;
  editing: boolean;
  expanded: Set<string>;
  speechOverride: boolean | null;
  picker: { cardId: string; type: "same-as" | "contradicts" } | null;
  tagMenu: string | null;
  palette: boolean;
  /** Board or Doc view (this device only). */
  view: View;
  /** Link pick mode (this device only): the card being linked and the keyboard cursor. */
  pick: { cardId: string; cursor: string | null } | null;
  /** Selected arrow (shows its × for touch / keyboard). */
  link: { from: string; to: string } | null;
}

const newId = () => randomId(12);

/** Keyboard navigation items of a lane, top to bottom (rows), with the row each one sits in. */
export type NavItem = { kind: "card"; id: string; row: number } | { kind: "thesis"; id: string; row: number };

export function navItems(col: ColumnVM, speechOnly: boolean, board: BoardVM): NavItem[] {
  const out: NavItem[] = [];
  const rows = board.layout.rows;
  const segAt = new Map<number, string[]>();
  if (!speechOnly) for (const g of col.lane.segments) segAt.set(g.from, [...(segAt.get(g.from) ?? []), g.thesisId]);
  for (let i = 0; i < rows.length; i++) {
    for (const t of segAt.get(i) ?? []) out.push({ kind: "thesis", id: t, row: i });
    for (const id of rows[i].cells.get(col.speech.id) ?? []) out.push({ kind: "card", id, row: i });
  }
  return out;
}

export interface Controller {
  f: FormatConfig;
  flow: FlowState;
  board: BoardVM;
  ui: UiState;
  role: string | null;
  speechColumn: string | null;
  speechMode: boolean;
  canSpeechMode: boolean;
  select: (focus: Focus | null, edit?: boolean) => void;
  stopEditing: () => void;
  run: (r: Result) => void;
  addAt: (slot: Slot) => void;
  addBelow: (cardId?: string | null) => void;
  addPointTo: (cardId: string, afterPointId?: string | null) => void;
  addThesis: (afterThesisId?: string | null) => void;
  said: (cardId: string) => void;
  strong: (cardId: string) => void;
  tag: (cardId: string, type: TagType) => void;
  pickRef: (cardId: string, type: "same-as" | "contradicts", ref: string | null) => void;
  closePicker: () => void;
  setTagMenu: (cardId: string | null) => void;
  remove: (focus?: Focus | null) => void;
  removePoint: (cardId: string, pointId: string) => void;
  indent: (focus?: Focus | null) => void;
  outdent: (focus?: Focus | null) => void;
  move: (dir: "up" | "down" | "left" | "right") => void;
  goStage: (stage: string) => void;
  next: () => void;
  prev: () => void;
  toggleSpeechMode: () => void;
  toggleExpand: (cardId: string) => void;
  setPalette: (open: boolean) => void;
  undo: () => void;
  redo: () => void;
  columnOfFocus: (focus: Focus | null) => string | null;
  /** Speech-mode tap: toggles said and selects the next card. */
  speechTap: (cardId: string) => void;
  /** Card the selection is on (card or one of its points). */
  selectedCardId: string | null;
  /** R / "↩ Answer": where an answer to this card would go, or why it cannot. */
  answerPlaceOf: (cardId: string) => AnswerPlace;
  answer: (cardId?: string | null) => void;
  /** L / "Link": pick mode for a card. */
  startLink: (cardId?: string | null) => void;
  endPick: () => void;
  pickToggle: (targetId: string) => void;
  pickMove: (dir: "up" | "down" | "left" | "right") => void;
  unlink: (from: string, to: string) => void;
  selectLink: (link: { from: string; to: string } | null) => void;
  setView: (v: View) => void;
  toggleView: () => void;
  /** Select a card and bring it into view (unanswered pill). */
  jumpTo: (cardId: string) => void;
  /** Alt+↑/↓: move a card / thesis / point one slot. Returns a hint when it cannot move. */
  moveStep: (focus: Focus | null, dir: -1 | 1) => string | null;
  /** Drag preview (null = show the real state). */
  setPreview: (state: FlowState | null) => void;
  previewing: boolean;
}

export function useController(
  session: RoomSession,
  f: FormatConfig,
  flow: FlowState,
  role: string | null,
  opts: { initialView?: View; onView?: (v: View) => void } = {},
): Controller {
  // drag preview: the board is drawn from the state the drop would give, with the real labels until the drop
  const [preview, setPreviewState] = useState<FlowState | null>(null);
  const board = useMemo(() => (preview ? computeBoard(f, preview, { numbers: computeNumbers(f, flow) }) : computeBoard(f, flow)), [f, flow, preview]);
  const [ui, setUi] = useState<UiState>(() => ({
    selection: null,
    editing: false,
    expanded: new Set(),
    speechOverride: null,
    picker: null,
    tagMenu: null,
    palette: false,
    // the device's last view of this room; otherwise the Doc view during Prep (spec 02 requirement 1)
    view: opts.initialView ?? (flow.stage === f.prepStage.id ? "doc" : "board"),
    pick: null,
    link: null,
  }));
  const flowRef = useRef(flow);
  flowRef.current = flow;
  const onView = useRef(opts.onView);
  onView.current = opts.onView;
  useEffect(() => {
    onView.current?.(ui.view);
  }, [ui.view]);
  const boardRef = useRef(board);
  boardRef.current = board;
  const uiRef = useRef(ui);
  uiRef.current = ui;

  // Manual speech-mode override lasts for one stage. Entering Prep opens the Doc view, leaving it the Board.
  const lastStage = useRef(flow.stage);
  const lastPrep = useRef(flow.stage === f.prepStage.id);
  useEffect(() => {
    if (lastStage.current === flow.stage) return;
    const isPrep = flow.stage === f.prepStage.id;
    const enters = isPrep && !lastPrep.current;
    const leaves = !isPrep && lastPrep.current;
    lastStage.current = flow.stage;
    lastPrep.current = isPrep;
    setUi((u) => ({ ...u, speechOverride: null, view: enters ? "doc" : leaves ? "board" : u.view, pick: null }));
  }, [flow.stage, f.prepStage.id]);

  // Drop selection if the item disappeared (deleted here or by the partner).
  useEffect(() => {
    const sel = ui.selection;
    if (!sel) return;
    const gone =
      (sel.kind === "card" && !board.cards.has(sel.id)) ||
      (sel.kind === "thesis" && !flow.theses.some((t) => t.id === sel.id)) ||
      (sel.kind === "point" && !board.cards.get(sel.cardId)?.card.points.some((p) => p.id === sel.pointId));
    if (gone) setUi((u) => ({ ...u, selection: null, editing: false }));
  }, [board, flow.theses, ui.selection]);

  // Pick mode / selected arrow end when their card or link disappears.
  useEffect(() => {
    if (ui.pick && !board.cards.has(ui.pick.cardId)) setUi((u) => ({ ...u, pick: null }));
    if (ui.link && !board.links.some((l) => l.from === ui.link!.from && l.to === ui.link!.to)) setUi((u) => ({ ...u, link: null }));
  }, [board, ui.pick, ui.link]);

  // Share what we are typing in, so the partner sees the card highlighted in our colour.
  useEffect(() => {
    const s = ui.selection;
    session.setPresence({
      editing:
        ui.editing && s
          ? s.kind === "point"
            ? { kind: "point", id: s.pointId, cardId: s.cardId }
            : { kind: s.kind, id: s.id }
          : null,
    });
  }, [session, ui.editing, ui.selection]);

  const current = board.speech;
  const canSpeechMode = !!current && current.side === flow.perspective;
  const auto = speechModeColumn(f, flow, role) !== null;
  const speechMode = canSpeechMode && (ui.speechOverride ?? auto);
  const speechColumn = speechMode && current ? current.id : null;

  const select = useCallback(
    (focus: Focus | null, edit = false) => {
      session.endUndoStep();
      setUi((u) => ({ ...u, selection: focus, editing: !!focus && edit, tagMenu: null, link: null }));
    },
    [session],
  );

  const stopEditing = useCallback(() => {
    session.endUndoStep();
    setUi((u) => ({ ...u, editing: false }));
  }, [session]);

  const run = useCallback(
    (r: Result) => {
      if (r.ops.length) session.apply(r.ops);
      if (r.focus) {
        // A card shows all its points while one is being edited and folds back to the first one
        // plus "•N" afterwards (spec 02: points collapsed, expanded on click).
        const focus = r.focus;
        setUi((u) => ({ ...u, selection: focus, editing: !!focus.edit }));
      }
    },
    [session],
  );

  const findCard = (id: string) => flowRef.current.cards.find((c) => c.id === id) ?? null;

  /** Column for creating a card without a selection: the speech being given, else our first live column. */
  const defaultSlot = useCallback((): Slot | null => {
    const b = boardRef.current;
    const cols = b.columns.filter((c) => c.canAdd);
    const col =
      cols.find((c) => c.current) ??
      cols.find((c) => c.ours && c.state === "live") ??
      cols[cols.length - 1];
    if (!col) return null;
    const zone = col.zones[col.zones.length - 1];
    const group = zone.groups[zone.groups.length - 1];
    return { speech: col.speech.id, zone: zone.zone, thesisId: group?.thesis?.id ?? null };
  }, []);

  const addAt = useCallback((slot: Slot) => run(createCard(f, flowRef.current, slot, newId)), [f, run]);

  const addBelow = useCallback(
    (cardId?: string | null) => {
      const sel = uiRef.current.selection;
      const id = cardId ?? (sel?.kind === "card" ? sel.id : sel?.kind === "point" ? sel.cardId : null);
      if (id && findCard(id)) {
        run(createCardBelow(f, flowRef.current, id, newId));
        return;
      }
      if (sel?.kind === "thesis") {
        const col = columnOfFocus(sel);
        if (col) {
          run(createCard(f, flowRef.current, { speech: col, zone: "own", thesisId: sel.id, atStart: true }, newId));
          return;
        }
      }
      const slot = defaultSlot();
      if (slot) run(createCard(f, flowRef.current, slot, newId));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [f, run, defaultSlot],
  );

  const addPointTo = useCallback(
    (cardId: string, afterPointId: string | null = null) => run(addPoint(flowRef.current, cardId, afterPointId, newId)),
    [run],
  );

  const addThesis = useCallback(
    (afterThesisId: string | null = null) => run(createThesis(flowRef.current, flowRef.current.perspective, afterThesisId, newId)),
    [run],
  );

  const said = useCallback((cardId: string) => run(toggleSaid(f, flowRef.current, cardId)), [f, run]);
  const strong = useCallback((cardId: string) => run(toggleStrong(flowRef.current, cardId)), [run]);

  const tag = useCallback(
    (cardId: string, type: TagType) => {
      const cfg = f.tags.find((t) => t.type === type);
      if (!cfg || !tagAvailable(f, flowRef.current, type)) return;
      if (cfg.needsRef) {
        setUi((u) => ({ ...u, picker: { cardId, type: type as "same-as" | "contradicts" }, tagMenu: null }));
        return;
      }
      run(toggleTag(f, flowRef.current, cardId, type));
    },
    [f, run],
  );

  const pickRef = useCallback(
    (cardId: string, type: "same-as" | "contradicts", ref: string | null) => {
      run(toggleTag(f, flowRef.current, cardId, type, ref));
      setUi((u) => ({ ...u, picker: null }));
    },
    [f, run],
  );

  const closePicker = useCallback(() => setUi((u) => ({ ...u, picker: null })), []);
  const setTagMenu = useCallback((cardId: string | null) => setUi((u) => ({ ...u, tagMenu: cardId })), []);

  const columnOfFocus = useCallback((focus: Focus | null): string | null => {
    if (!focus) return null;
    const b = boardRef.current;
    if (focus.kind === "card") return b.cards.get(focus.id)?.card.ownerSpeech ?? null;
    if (focus.kind === "point") return b.cards.get(focus.cardId)?.card.ownerSpeech ?? null;
    const has = (c: ColumnVM) => c.lane.segments.some((g) => g.thesisId === focus.id);
    const col = b.columns.find((c) => has(c) && c.state === "live");
    return (col ?? b.columns.find(has))?.speech.id ?? null;
  }, []);

  /** Item above/below in the same column (for focus after deletes). */
  const neighbour = useCallback(
    (focus: Focus, dir: -1 | 1): Focus | null => {
      const colId = columnOfFocus(focus);
      const col = boardRef.current.columns.find((c) => c.speech.id === colId);
      if (!col) return null;
      const items = navItems(col, false, boardRef.current);
      const id = focus.kind === "point" ? focus.cardId : focus.id;
      const i = items.findIndex((x) => x.id === id);
      const n = items[i + dir];
      return n ? { kind: n.kind, id: n.id } : null;
    },
    [columnOfFocus],
  );

  const remove = useCallback(
    (focus?: Focus | null) => {
      const target = focus ?? uiRef.current.selection;
      if (!target) return;
      const after = neighbour(target, -1) ?? neighbour(target, 1);
      if (target.kind === "card") run(deleteCard(flowRef.current, target.id));
      else if (target.kind === "thesis") run(deleteThesis(f, flowRef.current, target.id));
      else run(deletePoint(flowRef.current, target.cardId, target.pointId));
      if (target.kind !== "point") setUi((u) => ({ ...u, selection: after, editing: false }));
    },
    [f, run, neighbour],
  );

  const removePoint = useCallback((cardId: string, pointId: string) => run(deletePoint(flowRef.current, cardId, pointId)), [run]);

  const indent = useCallback(
    (focus?: Focus | null) => {
      const t = focus ?? uiRef.current.selection;
      if (!t) return;
      if (t.kind === "card") run(indentCard(f, flowRef.current, t.id, newId));
      else if (t.kind === "thesis") {
        const col = columnOfFocus(t);
        if (col) run(indentThesis(f, flowRef.current, t.id, col, newId));
      }
    },
    [f, run, columnOfFocus],
  );

  const outdent = useCallback(
    (focus?: Focus | null) => {
      const t = focus ?? uiRef.current.selection;
      if (!t) return;
      if (t.kind === "card") run(outdentCard(f, flowRef.current, t.id, newId));
      else if (t.kind === "point") run(outdentPoint(f, flowRef.current, t.cardId, t.pointId, newId));
    },
    [f, run],
  );

  /**
   * ↑/↓ follow a lane's visual order (rows); ←/→ go to the nearest card in the same row of the next
   * lane, or to the nearest row when that slot is empty. Speech mode keeps only the speech's cards.
   */
  const move = useCallback(
    (dir: "up" | "down" | "left" | "right") => {
      const b = boardRef.current;
      const u = uiRef.current;
      const speechOnly = speechMode;
      const nav = (col: ColumnVM) => navItems(col, speechOnly && col.speech.id === speechColumn, b);
      const cols = b.columns.filter((c) => nav(c).length > 0);
      if (!cols.length) return;
      const sel = u.selection;
      const colId = sel ? columnOfFocus(sel) : null;
      let ci = cols.findIndex((c) => c.speech.id === colId);
      if (ci < 0) {
        const preferred = cols.findIndex((c) => (speechColumn ? c.speech.id === speechColumn : c.current));
        ci = preferred >= 0 ? preferred : 0;
        const items = nav(cols[ci]);
        if (items[0]) setUi((s) => ({ ...s, selection: { kind: items[0].kind, id: items[0].id }, editing: false }));
        return;
      }
      const items = nav(cols[ci]);
      const curId = sel?.kind === "point" ? sel.cardId : sel?.id;
      const idx = Math.max(0, items.findIndex((x) => x.id === curId));
      if (dir === "up" || dir === "down") {
        const n = items[idx + (dir === "up" ? -1 : 1)];
        if (n) setUi((s) => ({ ...s, selection: { kind: n.kind, id: n.id }, editing: false }));
        return;
      }
      const nci = ci + (dir === "left" ? -1 : 1);
      if (nci < 0 || nci >= cols.length) return;
      const row = items[idx]?.row ?? 0;
      const nItems = nav(cols[nci]).filter((x) => x.kind === "card" || speechOnly === false);
      let best: NavItem | null = null;
      for (const x of nItems) {
        // same row first (first card of the stack), then the nearest row (the upper one on a tie)
        if (!best || Math.abs(x.row - row) < Math.abs(best.row - row) || (Math.abs(x.row - row) === Math.abs(best.row - row) && x.row < best.row)) best = x;
        if (x.row === row && x.kind === "card") {
          best = x;
          break;
        }
      }
      if (best) setUi((s) => ({ ...s, selection: { kind: best!.kind, id: best!.id }, editing: false }));
    },
    [columnOfFocus, speechMode, speechColumn],
  );

  const goStage = useCallback(
    (stage: string) => {
      const ops = planStageChange(f, flowRef.current, stage);
      if (ops.length) session.apply(ops);
    },
    [f, session],
  );
  const next = useCallback(() => goStage(nextStage(f, flowRef.current.stage)), [f, goStage]);
  const prev = useCallback(() => goStage(prevStage(f, flowRef.current.stage)), [f, goStage]);

  const toggleSpeechMode = useCallback(() => {
    if (!canSpeechMode) return;
    setUi((u) => ({ ...u, speechOverride: !(u.speechOverride ?? auto) }));
  }, [canSpeechMode, auto]);

  const toggleExpand = useCallback((cardId: string) => {
    setUi((u) => {
      const e = new Set(u.expanded);
      if (e.has(cardId)) e.delete(cardId);
      else e.add(cardId);
      return { ...u, expanded: e };
    });
  }, []);

  const setPalette = useCallback((open: boolean) => setUi((u) => ({ ...u, palette: open })), []);
  const undo = useCallback(() => session.undo.undo(), [session]);
  const redo = useCallback(() => session.undo.redo(), [session]);

  const speechTap = useCallback(
    (cardId: string) => {
      run(toggleSaid(f, flowRef.current, cardId));
      const col = boardRef.current.columns.find((c) => c.speech.id === speechColumn);
      if (!col) return;
      const items = navItems(col, true, boardRef.current);
      const i = items.findIndex((x) => x.id === cardId);
      const n = items[i + 1] ?? items[i];
      if (n) setUi((s) => ({ ...s, selection: { kind: "card", id: n.id }, editing: false }));
    },
    [f, run, speechColumn],
  );

  const selectedCardId = ui.selection?.kind === "card" ? ui.selection.id : ui.selection?.kind === "point" ? ui.selection.cardId : null;
  const selCardRef = useRef(selectedCardId);
  selCardRef.current = selectedCardId;

  const answerPlaceOf = useCallback((cardId: string) => answerPlace(f, flowRef.current, cardId), [f]);

  const answer = useCallback(
    (cardId?: string | null) => {
      const id = cardId ?? selCardRef.current;
      if (!id) return;
      run(answerCard(f, flowRef.current, id, newId));
    },
    [f, run],
  );

  const startLink = useCallback(
    (cardId?: string | null) => {
      const id = cardId ?? selCardRef.current;
      if (!id || !boardRef.current.cards.has(id)) return;
      session.endUndoStep();
      const first = boardRef.current.cards.get(id)!.targets[0] ?? null;
      setUi((u) => ({ ...u, pick: { cardId: id, cursor: first }, editing: false, selection: { kind: "card", id }, tagMenu: null, link: null }));
    },
    [session],
  );

  const endPick = useCallback(() => setUi((u) => ({ ...u, pick: null })), []);

  const pickToggle = useCallback(
    (targetId: string) => {
      const p = uiRef.current.pick;
      if (!p) return;
      run(toggleLink(f, flowRef.current, p.cardId, targetId));
      setUi((u) => (u.pick ? { ...u, pick: { ...u.pick, cursor: targetId } } : u));
    },
    [f, run],
  );

  /** Arrow keys in pick mode: move the cursor between eligible cards (lanes left / right, rows up / down). */
  const pickMove = useCallback(
    (dir: "up" | "down" | "left" | "right") => {
      const p = uiRef.current.pick;
      if (!p) return;
      const b = boardRef.current;
      const src = b.cards.get(p.cardId)?.card;
      if (!src) return;
      const lanes = b.columns
        .map((col) => col.order.filter((v) => v.card.id !== src.id && v.card.side !== src.side && f.speeches.findIndex((s) => s.id === v.card.ownerSpeech) < f.speeches.findIndex((s) => s.id === src.ownerSpeech)))
        .filter((l) => l.length);
      if (!lanes.length) return;
      let li = lanes.findIndex((l) => l.some((v) => v.card.id === p.cursor));
      if (li < 0) {
        setUi((u) => (u.pick ? { ...u, pick: { ...u.pick, cursor: lanes[lanes.length - 1][0].card.id } } : u));
        return;
      }
      const i = lanes[li].findIndex((v) => v.card.id === p.cursor);
      let next = p.cursor;
      if (dir === "up") next = lanes[li][Math.max(0, i - 1)].card.id;
      else if (dir === "down") next = lanes[li][Math.min(lanes[li].length - 1, i + 1)].card.id;
      else {
        const row = b.layout.rowOf.get(p.cursor!) ?? 0;
        li = Math.max(0, Math.min(lanes.length - 1, li + (dir === "left" ? -1 : 1)));
        next = lanes[li].reduce((best, v) => (Math.abs((b.layout.rowOf.get(v.card.id) ?? 0) - row) < Math.abs((b.layout.rowOf.get(best.card.id) ?? 0) - row) ? v : best)).card.id;
      }
      setUi((u) => (u.pick ? { ...u, pick: { ...u.pick, cursor: next } } : u));
    },
    [f],
  );

  const unlink = useCallback((from: string, to: string) => run(unlinkCard(flowRef.current, from, to)), [run]);
  const selectLink = useCallback((link: { from: string; to: string } | null) => setUi((u) => ({ ...u, link })), []);
  const setView = useCallback((v: View) => setUi((u) => ({ ...u, view: v, pick: null, tagMenu: null })), []);
  const toggleView = useCallback(() => setUi((u) => ({ ...u, view: u.view === "board" ? "doc" : "board", pick: null, tagMenu: null })), []);

  const jumpTo = useCallback(
    (cardId: string) => {
      session.endUndoStep();
      setUi((u) => ({ ...u, view: "board", selection: { kind: "card", id: cardId }, editing: false, pick: null }));
      requestAnimationFrame(() =>
        document.querySelector(`[data-card-id="${cardId}"]`)?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" }),
      );
    },
    [session],
  );

  const moveStep = useCallback(
    (focus: Focus | null, dir: -1 | 1): string | null => {
      const t = focus ?? uiRef.current.selection;
      const state = flowRef.current;
      const layout = boardRef.current.layout;
      if (!t) return null;
      if (t.kind === "card") {
        const d = cardDrag(f, state, layout, t.id);
        if (!d) return null;
        const n = stepSlot(d.current, d.slots.length, dir);
        if (n === null) return d.mode === "row" ? "Use L to change the target" : null;
        session.apply(moveCardOps(state, t.id, d.slots[n]));
      } else if (t.kind === "thesis") {
        const d = thesisDrag(state, t.id);
        const n = d ? stepSlot(d.current, d.slots.length, dir) : null;
        if (!d || n === null) return null;
        session.apply(moveThesisOps(t.id, d.slots[n]));
      } else {
        const d = pointDrag(state, layout, t.cardId, t.pointId);
        const n = d ? stepSlot(d.current, d.slots.length, dir) : null;
        if (!d || n === null) return null;
        const slot = d.slots[n];
        session.apply(movePointOps(state, t.cardId, t.pointId, slot));
        if (slot.cardId !== t.cardId) setUi((u) => ({ ...u, selection: { kind: "point", cardId: slot.cardId, pointId: t.pointId } }));
      }
      return null;
    },
    [f, session],
  );

  const setPreview = useCallback((st: FlowState | null) => setPreviewState(st), []);

  return {
    moveStep,
    setPreview,
    previewing: !!preview,
    f,
    flow,
    board,
    ui,
    role,
    speechColumn,
    speechMode,
    canSpeechMode,
    select,
    stopEditing,
    run,
    addAt,
    addBelow,
    addPointTo,
    addThesis,
    said,
    strong,
    tag,
    pickRef,
    closePicker,
    setTagMenu,
    remove,
    removePoint,
    indent,
    outdent,
    move,
    goStage,
    next,
    prev,
    toggleSpeechMode,
    toggleExpand,
    setPalette,
    undo,
    redo,
    columnOfFocus,
    speechTap,
    selectedCardId,
    answerPlaceOf,
    answer,
    startLink,
    endPick,
    pickToggle,
    pickMove,
    unlink,
    selectLink,
    setView,
    toggleView,
    jumpTo,
  };
}
