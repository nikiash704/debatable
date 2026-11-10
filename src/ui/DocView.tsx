import { useEffect, useLayoutEffect, useMemo, useRef, type KeyboardEvent } from "react";
import * as Y from "yjs";
import {
  addPoint,
  createCard,
  createThesis,
  deleteCard,
  deletePoint,
  deleteThesis,
  indentCard,
  indentThesis,
  outdentCard,
  outdentPoint,
  type Focus,
  type Result,
} from "../engine/commands";
import { byOrder, thesesOf } from "../engine/order";
import { columnState, effectiveZone, hasTheses, speechIndex } from "../engine/stages";
import type { Card } from "../engine/types";
import { getCardText, getPointText, getThesisTitle, LOCAL } from "../sync/doc";
import type { Peer, RoomSession } from "../sync/session";
import { randomId } from "../sync/storage";
import type { Controller } from "./controller";
import { MOD } from "./keys";
import { YTextEditor } from "./YTextEditor";

const newId = () => randomId(12);

type Line =
  | { kind: "thesis"; key: string; id: string; marker: string }
  | { kind: "card"; key: string; id: string; marker: string; label: string; card: Card }
  | { kind: "point"; key: string; cardId: string; pointId: string; marker: string };

const focusOf = (l: Line): Focus => (l.kind === "point" ? { kind: "point", cardId: l.cardId, pointId: l.pointId } : { kind: l.kind, id: l.id });
const keyOf = (f: Focus | null) => (!f ? "" : f.kind === "point" ? `p:${f.pointId}` : `${f.kind[0]}:${f.id}`);

/**
 * Doc view for prep (spec 02 requirement 1): a second view of the same data, for our side only — an
 * outline like a Google Doc. Theses are "1.", our arguments "a.", points "•". Every line edits the same
 * Y.Text as the board and every key runs the same engine command, so nothing is converted and a partner
 * can stay on the board while you type here. Enter = next line at the same level, Tab / Shift+Tab =
 * level, ↑/↓ = lines, Backspace on an empty line deletes it, Alt+↑/↓ moves the line.
 */
export function DocView({ c, session, peers }: { c: Controller; session: RoomSession; peers: Peer[] }) {
  const f = c.f;
  const flow = c.flow;
  const persp = flow.perspective;

  /** Column where new arguments typed in the doc go: our live column with arguments (LO in prep). */
  const docColumn = useMemo(() => {
    const ours = f.speeches.filter((s) => s.side === persp && s.prefixSeries.own);
    const live = ours.find((s) => columnState(f, persp, s, flow.stage) === "live");
    return (live ?? [...ours].reverse().find((s) => columnState(f, persp, s, flow.stage) !== "future") ?? ours[0])?.id ?? null;
  }, [f, persp, flow.stage]);

  const lines = useMemo(() => {
    const out: Line[] = [];
    const theses = thesesOf(flow, persp);
    const known = new Set(theses.map((t) => t.id));
    const own = flow.cards.filter((card) => {
      const sp = f.speeches.find((s) => s.id === card.ownerSpeech);
      return !!sp && card.side === persp && hasTheses(flow, sp, effectiveZone(persp, sp, card));
    });
    const sorted = (list: Card[]) => [...list].sort((a, b) => speechIndex(f, a.ownerSpeech) - speechIndex(f, b.ownerSpeech) || byOrder(a, b));
    const pushCards = (list: Card[]) =>
      sorted(list).forEach((card, i) => {
        out.push({ kind: "card", key: `c:${card.id}`, id: card.id, marker: `${letter(i)}.`, label: c.board.cards.get(card.id)?.label ?? "", card });
        for (const p of card.points) out.push({ kind: "point", key: `p:${p.id}`, cardId: card.id, pointId: p.id, marker: "•" });
      });
    theses.forEach((t, i) => {
      out.push({ kind: "thesis", key: `t:${t.id}`, id: t.id, marker: `${i + 1}.` });
      pushCards(own.filter((x) => x.thesisId === t.id));
    });
    const loose = own.filter((x) => !x.thesisId || !known.has(x.thesisId));
    pushCards(loose);
    return { list: out, looseFrom: loose.length ? out.findIndex((l) => l.kind === "card" && loose.some((x) => x.id === l.id)) : -1 };
  }, [flow, f, persp, c.board]);

  const rootRef = useRef<HTMLDivElement>(null);
  const caret = useRef<"start" | "end">("end");
  const activeKey = c.ui.editing ? keyOf(c.ui.selection) : "";

  // Focus the line the controller selected (Enter / Tab / commands return a focus with edit = true).
  useLayoutEffect(() => {
    if (!activeKey) return;
    const el = rootRef.current?.querySelector<HTMLTextAreaElement>(`[data-doc-key="${activeKey}"] textarea`);
    if (!el || document.activeElement === el) return;
    el.focus({ preventScroll: false });
    const n = caret.current === "start" ? 0 : el.value.length;
    el.setSelectionRange(n, n);
    caret.current = "end";
  }, [activeKey, lines]);

  // Leaving the doc view ends editing there.
  useEffect(() => () => c.stopEditing(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const run = (r: Result, at: "start" | "end" = "end") => {
    caret.current = at;
    c.run(r);
  };

  const ytextOf = (l: Line): Y.Text | null =>
    l.kind === "thesis"
      ? getThesisTitle(session.doc, persp, l.id)
      : l.kind === "card"
        ? getCardText(session.doc, persp, l.id)
        : getPointText(session.doc, persp, l.cardId, l.pointId);

  const go = (i: number, at: "start" | "end" = "end") => {
    const l = lines.list[i];
    if (!l) return false;
    caret.current = at;
    c.select(focusOf(l), true);
    return true;
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>, l: Line, i: number) => {
    const el = e.currentTarget;
    const mod = e.metaKey || e.ctrlKey;
    const state = c.flow;
    if (e.key === "Escape") {
      e.preventDefault();
      el.blur();
      c.stopEditing();
      return;
    }
    if (mod && e.key.toLowerCase() === "k") {
      e.preventDefault();
      c.setPalette(true);
      return;
    }
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      c.moveStep(focusOf(l), e.key === "ArrowUp" ? -1 : 1);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !mod) {
      e.preventDefault();
      // split at the caret: the text after it moves to the new line
      const yt = ytextOf(l);
      const pos = el.selectionStart;
      const after = yt ? yt.toString().slice(pos) : "";
      if (yt && after) yt.doc!.transact(() => yt.delete(pos, after.length), LOCAL);
      const at = after ? "start" : "end";
      if (l.kind === "thesis") run(createThesis(state, persp, l.id, newId, after), at);
      else if (l.kind === "card") run(createCard(f, state, { speech: l.card.ownerSpeech, zone: l.card.zone, thesisId: l.card.thesisId, after: l.id }, newId, after), at);
      else run(addPoint(state, l.cardId, l.pointId, newId, after), at);
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      if (l.kind === "thesis") {
        if (!e.shiftKey && docColumn) run(indentThesis(f, state, l.id, docColumn, newId, true));
      } else if (l.kind === "card") {
        run(e.shiftKey ? outdentCard(f, state, l.id, newId) : indentCard(f, state, l.id, newId));
      } else if (e.shiftKey) {
        run(outdentPoint(f, state, l.cardId, l.pointId, newId));
      }
      return;
    }
    if (e.key === "Backspace" && !mod && el.value === "" && el.selectionStart === 0) {
      e.preventDefault();
      const prev = i - 1;
      if (l.kind === "thesis") c.run(deleteThesis(f, state, l.id));
      else if (l.kind === "card") c.run(deleteCard(state, l.id));
      else c.run(deletePoint(state, l.cardId, l.pointId));
      if (prev >= 0) go(prev, "end");
      else c.stopEditing();
      return;
    }
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !e.shiftKey && !mod) {
      const single = el.scrollHeight <= parseFloat(getComputedStyle(el).lineHeight || "20") * 1.5;
      const up = e.key === "ArrowUp";
      const edge = single || (up ? el.selectionStart === 0 : el.selectionEnd === el.value.length);
      if (edge && go(i + (up ? -1 : 1), up ? "end" : "start")) e.preventDefault();
    }
  };

  const partnerOn = (l: Line) =>
    peers.find((p) =>
      l.kind === "point" ? p.editing?.kind === "point" && p.editing.id === l.pointId : p.editing?.kind === l.kind && p.editing.id === l.id,
    );

  return (
    <main className="doc" data-testid="doc-view">
      <div className="doc__page" ref={rootRef}>
        <div className="doc__head">
          <span className="doc__title">Our case</span>
          <span className="doc__hint">
            Enter new line · <kbd>Tab</kbd> deeper · <kbd>⇧Tab</kbd> up · <kbd>Alt ↑↓</kbd> move · <kbd>{MOD}K</kbd> commands
          </span>
        </div>
        {lines.list.length === 0 && <p className="doc__empty">Start with a thesis: type it, press Enter for the next one, Tab to turn a line into an argument under the thesis above.</p>}
        {lines.list.map((l, i) => {
          const yt = ytextOf(l);
          const partner = partnerOn(l);
          const sel = c.ui.selection;
          const selected = !!sel && keyOf(sel) === l.key;
          return (
            <div key={l.key}>
              {i === lines.looseFrom && <div className="doc__section">No thesis</div>}
              <div
                className={`doc__line doc__line--${l.kind}${selected ? " doc__line--active" : ""}`}
                data-doc-key={l.key}
                data-testid={`doc-${l.kind}`}
                style={partner ? { boxShadow: `inset 2px 0 0 ${partner.user.hex}` } : undefined}
              >
                <span className="doc__marker">{l.marker}</span>
                <div className="doc__text">
                  {yt && (
                    <YTextEditor
                      ytext={yt}
                      placeholder={l.kind === "thesis" ? "Thesis" : l.kind === "card" ? "Argument" : "Point"}
                      testId={`doc-editor-${l.kind}`}
                      onUndo={c.undo}
                      onRedo={c.redo}
                      onFocus={() => {
                        if (!(selected && c.ui.editing)) c.select(focusOf(l), true);
                      }}
                      onKeyDown={(e) => onKey(e, l, i)}
                    />
                  )}
                </div>
                {l.kind === "card" && (
                  <span className="doc__label mono" data-testid="doc-label">
                    {l.label}
                  </span>
                )}
                {partner && <span className="doc__partner" style={{ background: partner.user.hex }}>{partner.user.name}</span>}
              </div>
            </div>
          );
        })}
        <div className="doc__actions">
          <button type="button" className="add-btn" data-testid="doc-add-thesis" data-tip="New thesis at the end" data-key="Enter on a thesis" onClick={() => run(createThesis(c.flow, persp, null, newId))}>
            + Thesis
          </button>
          {docColumn && (
            <button
              type="button"
              className="add-btn"
              data-testid="doc-add-card"
              data-tip="New argument without a thesis"
              data-key="Tab on a thesis line"
              onClick={() => run(createCard(f, c.flow, { speech: docColumn, zone: "own", thesisId: null }, newId))}
            >
              + Argument
            </button>
          )}
        </div>
        <p className="doc__foot">Same data as the board: responses and the other side's arguments stay on the Board (D).</p>
      </div>
    </main>
  );
}

function letter(i: number): string {
  let s = "";
  let k = i;
  do {
    s = String.fromCharCode(97 + (k % 26)) + s;
    k = Math.floor(k / 26) - 1;
  } while (k >= 0);
  return s;
}
