import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormatConfig, TagType } from "../config/types";
import {
  addPoint,
  computeBoard,
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
  toggleTag,
  type BoardVM,
  type ColumnVM,
  type Focus,
  type Result,
  type Slot,
} from "../engine";
import type { FlowState } from "../engine/types";
import { randomId } from "../sync/storage";
import type { RoomSession } from "../sync/session";

export interface UiState {
  selection: Focus | null;
  editing: boolean;
  expanded: Set<string>;
  speechOverride: boolean | null;
  picker: { cardId: string; type: "same-as" | "contradicts" } | null;
  tagMenu: string | null;
  palette: boolean;
}

const newId = () => randomId(12);

/** Keyboard navigation items of a column, in on-screen order. */
export type NavItem = { kind: "card"; id: string } | { kind: "thesis"; id: string };

export function navItems(col: ColumnVM, speechOnly: boolean): NavItem[] {
  const out: NavItem[] = [];
  for (const z of col.zones) {
    for (const g of z.groups) {
      if (g.thesis && !speechOnly) out.push({ kind: "thesis", id: g.thesis.id });
      for (const c of g.cards) out.push({ kind: "card", id: c.card.id });
    }
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
}

export function useController(session: RoomSession, f: FormatConfig, flow: FlowState, role: string | null): Controller {
  const board = useMemo(() => computeBoard(f, flow), [f, flow]);
  const [ui, setUi] = useState<UiState>({
    selection: null,
    editing: false,
    expanded: new Set(),
    speechOverride: null,
    picker: null,
    tagMenu: null,
    palette: false,
  });
  const flowRef = useRef(flow);
  flowRef.current = flow;
  const boardRef = useRef(board);
  boardRef.current = board;
  const uiRef = useRef(ui);
  uiRef.current = ui;

  // Manual speech-mode override lasts for one stage.
  const lastStage = useRef(flow.stage);
  useEffect(() => {
    if (lastStage.current !== flow.stage) {
      lastStage.current = flow.stage;
      setUi((u) => ({ ...u, speechOverride: null }));
    }
  }, [flow.stage]);

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
      setUi((u) => ({ ...u, selection: focus, editing: !!focus && edit, tagMenu: null }));
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
    const col = b.columns.find((c) => c.zones.some((z) => z.groups.some((g) => g.thesis?.id === focus.id)) && c.state === "live");
    return (col ?? b.columns.find((c) => c.zones.some((z) => z.groups.some((g) => g.thesis?.id === focus.id))))?.speech.id ?? null;
  }, []);

  /** Item above/below in the same column (for focus after deletes). */
  const neighbour = useCallback(
    (focus: Focus, dir: -1 | 1): Focus | null => {
      const colId = columnOfFocus(focus);
      const col = boardRef.current.columns.find((c) => c.speech.id === colId);
      if (!col) return null;
      const items = navItems(col, false);
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

  const move = useCallback(
    (dir: "up" | "down" | "left" | "right") => {
      const b = boardRef.current;
      const u = uiRef.current;
      const speechOnly = speechMode;
      const cols = b.columns.filter((c) => c.order.length > 0 || c.zones.some((z) => z.groups.some((g) => g.thesis)));
      if (!cols.length) return;
      const sel = u.selection;
      const colId = sel ? columnOfFocus(sel) : null;
      let ci = cols.findIndex((c) => c.speech.id === colId);
      if (ci < 0) {
        const preferred = cols.findIndex((c) => (speechColumn ? c.speech.id === speechColumn : c.current));
        ci = preferred >= 0 ? preferred : 0;
        const items = navItems(cols[ci], speechOnly && cols[ci].speech.id === speechColumn);
        if (items[0]) setUi((s) => ({ ...s, selection: { kind: items[0].kind, id: items[0].id }, editing: false }));
        return;
      }
      const items = navItems(cols[ci], speechOnly && cols[ci].speech.id === speechColumn);
      const curId = sel?.kind === "point" ? sel.cardId : sel?.id;
      const idx = Math.max(0, items.findIndex((x) => x.id === curId));
      if (dir === "up" || dir === "down") {
        const n = items[idx + (dir === "up" ? -1 : 1)];
        if (n) setUi((s) => ({ ...s, selection: { kind: n.kind, id: n.id }, editing: false }));
        return;
      }
      const nci = ci + (dir === "left" ? -1 : 1);
      if (nci < 0 || nci >= cols.length) return;
      const nItems = navItems(cols[nci], speechOnly && cols[nci].speech.id === speechColumn);
      const n = nItems[Math.min(idx, nItems.length - 1)];
      if (n) setUi((s) => ({ ...s, selection: { kind: n.kind, id: n.id }, editing: false }));
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
      const items = navItems(col, true);
      const i = items.findIndex((x) => x.id === cardId);
      const n = items[i + 1] ?? items[i];
      if (n) setUi((s) => ({ ...s, selection: { kind: "card", id: n.id }, editing: false }));
    },
    [f, run, speechColumn],
  );

  return {
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
  };
}
