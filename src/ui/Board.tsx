import { useEffect, useMemo, useRef, type KeyboardEvent, type ReactNode } from "react";
import type { CardVM, ColumnVM, GroupKey, Segment } from "../engine";
import { effectiveZone, sideOf } from "../engine/stages";
import type { Focus } from "../engine/commands";
import { getCardText, getPointText, getThesisTitle } from "../sync/doc";
import type { Peer, RoomSession } from "../sync/session";
import { ArrowLayer, hoverStore } from "./Arrows";
import { CardView } from "./components/CardView";
import { Chip } from "./components/Chip";
import { Lane } from "./components/Lane";
import type { Controller } from "./controller";
import type { DragApi } from "./drag";
import { MOD } from "./keys";
import { YTextEditor } from "./YTextEditor";

interface BoardProps {
  c: Controller;
  session: RoomSession;
  peers: Peer[];
  drag?: DragApi | null;
}

/** Grid lines: row 1 = lane headers; each layout row i has 4 tracks: label, thesis head, cards, footer. */
const T = {
  label: (i: number) => 2 + 4 * i,
  head: (i: number) => 3 + 4 * i,
  main: (i: number) => 4 + 4 * i,
  foot: (i: number) => 5 + 4 * i,
};

/** Focus (this device only): rings on the selected card's targets and answers; other lanes dim. */
interface FocusInfo {
  source: string | null;
  ring: Set<string>;
  dimLanes: Set<string>;
  pick: { source: string; eligible: Set<string>; picked: Set<string>; cursor: string | null } | null;
}

function useFocusInfo(c: Controller): FocusInfo {
  const b = c.board;
  const sel = c.selectedCardId;
  const pick = c.ui.pick;
  return useMemo(() => {
    if (pick) {
      const src = b.cards.get(pick.cardId);
      const eligible = new Set<string>();
      if (src) {
        const si = c.f.speeches.findIndex((s) => s.id === src.card.ownerSpeech);
        for (const v of b.cards.values()) {
          const ti = c.f.speeches.findIndex((s) => s.id === v.card.ownerSpeech);
          if (v.card.id !== src.card.id && v.card.side !== src.card.side && ti >= 0 && ti < si) eligible.add(v.card.id);
        }
      }
      return { source: pick.cardId, ring: new Set(), dimLanes: new Set(), pick: { source: pick.cardId, eligible, picked: new Set(src?.targets ?? []), cursor: pick.cursor } };
    }
    const vm = sel ? b.cards.get(sel) : null;
    if (!vm) return { source: null, ring: new Set(), dimLanes: new Set(), pick: null };
    const ring = new Set([...vm.targets, ...vm.answeredBy]);
    const dimLanes = new Set<string>();
    if (ring.size) {
      const keep = new Set([...ring, vm.card.id].map((id) => b.cards.get(id)?.card.ownerSpeech));
      for (const col of b.columns) if (!keep.has(col.speech.id)) dimLanes.add(col.speech.id);
    }
    return { source: vm.card.id, ring, dimLanes, pick: null };
  }, [b, sel, pick, c.f.speeches]);
}

export function Board({ c, session, peers, drag }: BoardProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  // Bring the lane being spoken into view when the stage changes (tablets show 3–4 lanes).
  const current = c.board.speech?.id ?? null;
  useEffect(() => {
    if (!current) return;
    const el = document.querySelector(`[data-lane="${current}"]`);
    el?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
  }, [current]);
  const focus = useFocusInfo(c);
  const R = c.board.layout.rows.length;
  const pickSrc = c.ui.pick ? c.board.cards.get(c.ui.pick.cardId) : null;
  return (
    <main
      className={`board${c.ui.pick ? " board--pick" : ""}`}
      data-testid="board"
      onClick={(e) => {
        const t = e.target as HTMLElement;
        if (t.closest('[data-testid="card"], button, textarea, input, .thesis__head, .arrow__hit, .pick-banner')) return;
        if (c.ui.pick) c.endPick();
        c.select(null);
      }}
    >
      {pickSrc && (
        <div className="pick-banner" data-testid="pick-banner" role="status">
          <b className="mono">{pickSrc.label}</b>
          <span>
            {pickSrc.targets.length ? `answers ${pickSrc.targetLabels.join(", ")}` : "no target yet"} · click the arguments it answers
          </span>
          <button type="button" className="btn btn--dark" data-testid="pick-done" data-tip="Finish linking" data-key="Esc" onClick={c.endPick}>
            Done
          </button>
        </div>
      )}
      <div className="board-grid" ref={gridRef} style={{ gridTemplateRows: `auto${R ? ` repeat(${4 * R}, auto)` : ""} 1fr` }} data-testid="board-grid">
        {c.board.columns.map((col, i) => (
          <Column key={col.speech.id} index={i} col={col} c={c} session={session} peers={peers} focus={focus} drag={drag ?? null} />
        ))}
        <ArrowLayer c={c} gridRef={gridRef} />
      </div>
    </main>
  );
}

interface ColProps {
  col: ColumnVM;
  index: number;
  c: Controller;
  session: RoomSession;
  peers: Peer[];
  focus: FocusInfo;
  drag: DragApi | null;
}

function Column({ col, index, c, session, peers, focus, drag }: ColProps) {
  const f = c.f;
  const empty = col.order.length === 0 && col.lane.segments.length === 0;
  const narrow = col.state === "future" && empty;
  const side = sideOf(f, col.speech.side);
  return (
    <Lane
      speechId={col.speech.id}
      label={col.speech.label}
      title={col.speech.title}
      minutes={col.speech.minutes}
      sideTag={side.short}
      ours={col.ours}
      live={col.current}
      future={narrow}
      counter={col.counter}
      answers={col.answerCounter}
      grid={{ column: index + 1 }}
      dim={focus.dimLanes.has(col.speech.id)}
    >
      {narrow ? undefined : <LaneCells col={col} c={c} session={session} peers={peers} focus={focus} drag={drag} index={index} />}
    </Lane>
  );
}

function addLabel(col: ColumnVM, zone: string): string {
  if (!col.ours) return `Add ${col.speech.opponentLabel} argument`;
  if (!col.speech.allowsNew) return "Add rebuttal point";
  return zone === "clash" ? "Add response" : "Add argument";
}

function LaneCells({ col, c, session, peers, focus, drag }: ColProps) {
  const b = c.board;
  const L = col.lane;
  const sid = col.speech.id;
  const rows = b.layout.rows;
  const labelAt = new Map(L.labels.map((l) => [l.row, l.zone]));
  const segStart = new Map<number, Segment[]>();
  const segOfRow = new Map<number, Segment>();
  for (const g of L.segments) {
    segStart.set(g.from, [...(segStart.get(g.from) ?? []), g]);
    for (let r = g.from; r <= g.to; r++) segOfRow.set(r, g);
  }
  const addsAt = new Map<number, GroupKey[]>();
  for (const a of L.adds) addsAt.set(a.row, [...(addsAt.get(a.row) ?? []), a.group]);
  const gapFor = new Map(L.gaps.map((g) => [g.cardId, g]));
  const ownZone = col.ours && !!col.speech.prefixSeries.own;
  const hasLoose = L.gaps.some((g) => g.group.zone === "own" && g.group.thesisId === null);
  const sel = c.ui.selection;
  const thesisSel = sel?.kind === "thesis" && c.columnOfFocus(sel) === sid ? sel.id : null;
  const firstSeg = new Map<string, Segment>();
  for (const g of L.segments) if (!firstSeg.has(g.thesisId)) firstSeg.set(g.thesisId, g);

  const out: ReactNode[] = [];
  for (const g of L.segments) {
    const partner = peers.find((p) => p.editing?.kind === "thesis" && p.editing.id === g.thesisId);
    out.push(
      <div
        key={`line-${g.thesisId}-${g.from}`}
        className={`thesis-line${thesisSel === g.thesisId ? " thesis-line--selected" : ""}`}
        style={{ gridRow: `${T.head(g.from)} / ${T.foot(g.to)}`, ...(partner ? { borderLeftColor: partner.user.hex } : {}) }}
        aria-hidden="true"
      />,
    );
  }
  for (let i = 0; i < rows.length; i++) {
    const zone = labelAt.get(i);
    if (zone) {
      out.push(
        <div key={`label-${i}`} className="cell cell--label zone__label" style={{ gridRow: T.label(i) }} data-testid={`zone-${sid}-${zone}`}>
          {zone === "clash" ? "Responses" : "Arguments"}
        </div>,
      );
    }
    for (const g of segStart.get(i) ?? []) {
      out.push(
        <ThesisHead
          key={`head-${g.thesisId}-${i}`}
          seg={g}
          row={i}
          col={col}
          c={c}
          session={session}
          editable={firstSeg.get(g.thesisId) === g}
          selected={thesisSel === g.thesisId}
          drag={drag}
        />,
      );
    }
    const ids = rows[i].cells.get(sid) ?? [];
    const adds = addsAt.get(i) ?? [];
    if (ids.length || adds.length) {
      out.push(
        <div key={`main-${i}`} className={`cell cell--main${segOfRow.has(i) ? " cell--thesis" : ""}`} style={{ gridRow: T.main(i) }} data-row={i}>
          {ids.map((id) => {
            const vm = b.cards.get(id);
            if (!vm) return null;
            const gap = gapFor.get(id);
            const prev = gap?.prevId ? b.cards.get(gap.prevId) : null;
            return (
              <div className="slot" key={id}>
                {gap && col.canAdd && (
                  <Gap
                    testId={prev ? `gap-after-${prev.label}` : `gap-before-${vm.label}`}
                    onAdd={() => c.addAt({ speech: sid, zone: gap.group.zone, thesisId: gap.group.thesisId, before: id })}
                  />
                )}
                <CardItem vm={vm} col={col} c={c} session={session} peers={peers} focus={focus} drag={drag} />
              </div>
            );
          })}
          {adds.map((g) => {
            const n = g.thesisId ? b.thesisNumbers.get(g.thesisId) : null;
            return (
              <button
                key={`add-${g.zone}-${g.thesisId ?? ""}`}
                type="button"
                className="add-btn"
                data-testid={`add-${sid}-${g.zone}${n ? `-t${n}` : ""}`}
                data-tip="New card at the end"
                data-key="A · Enter while typing"
                onClick={() => c.addAt({ speech: sid, zone: g.zone, thesisId: g.thesisId })}
              >
                + {addLabel(col, g.zone)}
              </button>
            );
          })}
        </div>,
      );
    }
    if (L.footer === i && ownZone && col.state === "live") {
      out.push(
        <div key={`foot-${i}`} className="cell cell--foot" style={{ gridRow: T.foot(i) }}>
          {!hasLoose && (
            <button
              type="button"
              className="add-btn"
              data-testid={`add-loose-${sid}`}
              data-tip="New argument without a thesis"
              data-key="A"
              onClick={() => c.addAt({ speech: sid, zone: "own", thesisId: null })}
            >
              + Argument
            </button>
          )}
          <button type="button" className="add-btn" data-testid={`add-thesis-${sid}`} data-tip="New thesis" data-key="Shift+Tab on a card" onClick={() => c.addThesis(null)}>
            + Thesis
          </button>
        </div>,
      );
    }
  }
  return <>{out}</>;
}

function ThesisHead({
  seg,
  row,
  col,
  c,
  session,
  editable,
  selected,
  drag,
}: {
  seg: Segment;
  row: number;
  col: ColumnVM;
  c: Controller;
  session: RoomSession;
  editable: boolean;
  selected: boolean;
  drag: DragApi | null;
}) {
  const t = c.flow.theses.find((x) => x.id === seg.thesisId);
  if (!t) return null;
  const editing = selected && editable && c.ui.editing;
  const ytext = editing ? getThesisTitle(session.doc, c.flow.perspective, t.id) : null;
  const n = c.board.thesisNumbers.get(t.id) ?? 0;
  return (
    <div className="cell cell--head" style={{ gridRow: T.head(row) }} data-testid="thesis" data-thesis-id={t.id}>
      <div
        className={`thesis__head${selected ? " thesis__head--selected" : ""}`}
        data-tip={editing ? undefined : "Thesis · double-click or Enter to rename · drag to reorder"}
        onPointerDown={(e) => drag?.onThesisPointerDown(e, t.id, col.speech.id)}
        onClick={(e) => {
          e.stopPropagation();
          if (drag?.consumeClick()) return;
          if (selected && !editing && editable) c.select({ kind: "thesis", id: t.id }, true);
          else c.select({ kind: "thesis", id: t.id });
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          c.select({ kind: "thesis", id: t.id }, true);
        }}
      >
        <span className="thesis__num">{n}</span>
        <span className="thesis__dot">·</span>
        {ytext ? (
          <div className="thesis__title">
            <YTextEditor
              ytext={ytext}
              autoFocus
              placeholder="Thesis title"
              testId="thesis-editor"
              onUndo={c.undo}
              onRedo={c.redo}
              onKeyDown={(e) => editorKeys(e, c, { kind: "thesis", id: t.id }, col.speech.id, ytext.toString())}
            />
          </div>
        ) : (
          <span className={`thesis__title${t.title ? "" : " thesis__title--empty"}`} data-testid="thesis-title">
            {t.title || "Untitled thesis"}
          </span>
        )}
      </div>
    </div>
  );
}

function Gap({ onAdd, testId }: { onAdd: () => void; testId?: string }) {
  return (
    <div className="gap gap--float">
      <button type="button" className="gap__btn" data-tip="Insert a card here" data-key="A below the selected card" data-testid={testId} onClick={onAdd} tabIndex={-1}>
        <span className="gap__plus">+</span>
      </button>
    </div>
  );
}

const TAG_LABEL: Record<string, string> = {
  "same-as": "Same as",
  contradicts: "Contradicts",
};

function CardItem({ vm, col, c, session, peers, focus, drag }: { vm: CardVM; col: ColumnVM; c: Controller; session: RoomSession; peers: Peer[]; focus: FocusInfo; drag: DragApi | null }) {
  const card = vm.card;
  const sel = c.ui.selection;
  const selected = (sel?.kind === "card" && sel.id === card.id) || (sel?.kind === "point" && sel.cardId === card.id);
  const editingText = selected && c.ui.editing && sel?.kind === "card";
  const editingPoint = selected && c.ui.editing && sel?.kind === "point" ? sel.pointId : null;
  const inSpeech = c.speechMode && c.speechColumn === col.speech.id && vm.ours && !focus.pick;
  const partner = peers.find((p) => (p.editing?.kind === "card" && p.editing.id === card.id) || (p.editing?.kind === "point" && p.editing.cardId === card.id));
  const expanded = c.ui.expanded.has(card.id);
  const ytext = editingText ? getCardText(session.doc, c.flow.perspective, card.id) : null;
  const pooOk = c.board.pooAvailable;
  const pick = focus.pick;
  const eligible = pick ? pick.eligible.has(card.id) : false;
  const answer = c.answerPlaceOf(card.id);
  const clashCard = vm.ours && effectiveZone(c.flow.perspective, col.speech, card) === "clash";
  const myLane = c.f.speeches.findIndex((s) => s.id === card.ownerSpeech);
  const canLinkSomething = c.board.columns.some((x, i) => i < myLane && x.speech.side !== card.side && x.order.length > 0);
  const dragging = drag?.draggingId === card.id;

  const plates = [
    ...(vm.fromLabel ? [{ text: vm.fromLabel, tone: "mono" as const, testId: "plate-from" }] : []),
    ...(vm.red ? [{ text: "new — don't say", tone: "red" as const, testId: "plate-new" }] : []),
  ];

  const tags =
    card.tags.length > 0 ? (
      <>
        {card.tags.map((t) => {
          const cfg = c.f.tags.find((x) => x.type === t.type);
          const ref = t.refCardId ? c.board.cards.get(t.refCardId)?.label : undefined;
          return (
            <Chip
              key={`${t.type}-${t.refCardId ?? ""}`}
              label={TAG_LABEL[t.type] ?? cfg?.label ?? t.type}
              refLabel={ref}
              tone={cfg?.tone === "alert" ? "alert" : "default"}
              testId={`tag-${t.type}`}
              title={cfg?.needsRef ? `Change ${cfg.label.replace("…", "")}` : `Remove ${cfg?.label ?? t.type}`}
              hotkey={cfg?.hotkey}
              showKey={false}
              onClick={() => c.tag(card.id, t.type)}
            />
          );
        })}
      </>
    ) : undefined;

  const tools = (
    <>
      <button
        type="button"
        className={`tool tool--text${answer.ok ? "" : " tool--off"}`}
        aria-disabled={!answer.ok}
        data-testid="tool-answer"
        data-tip={answer.ok ? `Answer ${vm.label} (new card in ${c.f.speeches.find((s) => s.id === answer.slot.speech)?.label})` : `Can't answer: ${answer.reason}`}
        data-key="R"
        onClick={() => answer.ok && c.answer(card.id)}
      >
        {answer.ok ? "↩ Answer" : "↩"}
      </button>
      {(vm.targets.length > 0 || canLinkSomething) && (
        <button type="button" className="tool tool--text" data-testid="tool-link" data-tip="Link to the arguments it answers" data-key="L" onClick={() => c.startLink(card.id)}>
          Link
        </button>
      )}
      <button type="button" className="tool" aria-pressed={card.strong} data-testid="tool-strong" data-tip={card.strong ? "Not strong" : "Strong"} data-key="S" onClick={() => c.strong(card.id)}>
        {card.strong ? "★" : "☆"}
      </button>
      {vm.ours && (
        <button type="button" className="tool tool--said" aria-pressed={!!card.saidIn} data-testid="tool-said" data-tip={card.saidIn ? "Not said" : "Said"} data-key={`${MOD}↵`} onClick={() => c.said(card.id)}>
          ✓
        </button>
      )}
      <button type="button" className="tool" data-testid="tool-tags" data-tip="Tags" data-key="W N = C T P" onClick={() => c.setTagMenu(c.ui.tagMenu === card.id ? null : card.id)}>
        #
      </button>
      <button type="button" className="tool" data-testid="tool-point" data-tip="Add point" data-key="Enter, Tab" onClick={() => c.addPointTo(card.id)}>
        •+
      </button>
      <button type="button" className="tool" data-testid="tool-below" data-tip="New card below" data-key="A" onClick={() => c.addBelow(card.id)}>
        +
      </button>
      <button type="button" className="tool" data-testid="tool-delete" data-tip="Delete card" data-key="Del" onClick={() => c.remove({ kind: "card", id: card.id })}>
        ✕
      </button>
    </>
  );

  const cls = [
    focus.ring.has(card.id) && "card--focus",
    pick && card.id === pick.source && "card--pick-source",
    pick && eligible && "card--eligible",
    pick && !eligible && card.id !== pick.source && "card--ineligible",
    pick && pick.picked.has(card.id) && "card--picked",
    pick && pick.cursor === card.id && "card--cursor",
    dragging && "card--drag-target",
  ]
    .filter(Boolean)
    .join(" ");

  const showHint = selected && clashCard && vm.targets.length === 0 && !pick;

  return (
    <>
      <CardView
        tone={vm.tone}
        label={vm.label}
        text={card.text}
        strong={card.strong}
        struck={vm.struck}
        plates={plates}
        tags={tags}
        selected={selected && !c.ui.editing && !pick}
        editing={editingText || !!editingPoint}
        speech={inSpeech}
        partner={partner ? { name: partner.user.name, color: partner.user.hex } : null}
        expanded={expanded}
        onToggleExpand={() => c.toggleExpand(card.id)}
        tools={!inSpeech && !c.ui.editing && !pick ? tools : undefined}
        responding={vm.targets.map((t, i) => ({ label: vm.targetLabels[i], tone: c.board.cards.get(t)?.tone ?? "neutral" }))}
        meta={vm.saidMeta}
        hint={
          showHint ? (
            <div className="card__hint" data-testid="no-target-hint">
              no target · <kbd>L</kbd>
            </div>
          ) : undefined
        }
        className={cls || undefined}
        data-testid="card"
        data-card-id={card.id}
        data-label={vm.label}
        data-said={card.saidIn ? "true" : "false"}
        data-struck={vm.struck ? "true" : "false"}
        data-red={vm.red ? "true" : "false"}
        data-unanswered={vm.unanswered ? "true" : "false"}
        data-said-green={vm.saidGreen ? "true" : "false"}
        data-focus={focus.ring.has(card.id) ? "true" : "false"}
        data-eligible={pick ? (eligible ? "true" : "false") : undefined}
        data-picked={pick ? (pick.picked.has(card.id) ? "true" : "false") : undefined}
        role="button"
        aria-pressed={inSpeech ? !!vm.struck : undefined}
        aria-label={`${vm.label} ${card.text}`}
        onPointerEnter={() => hoverStore.set(card.id)}
        onPointerLeave={() => hoverStore.set(null)}
        onPointerDown={(e) => drag?.onCardPointerDown(e, card.id)}
        onClick={(e) => {
          e.stopPropagation();
          if (drag?.consumeClick()) return;
          if (pick) {
            if (eligible) c.pickToggle(card.id);
            else if (card.id === pick.source) c.endPick();
            return;
          }
          if (inSpeech) {
            c.speechTap(card.id);
            return;
          }
          if (selected && !c.ui.editing && sel?.kind === "card") c.select({ kind: "card", id: card.id }, true);
          else if (!(selected && c.ui.editing)) c.select({ kind: "card", id: card.id });
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (pick) return;
          // double-click on a point edits that point, anywhere else the card text
          const row = (e.target as HTMLElement).closest?.("[data-point-id]") as HTMLElement | null;
          if (row?.dataset.pointId) c.select({ kind: "point", cardId: card.id, pointId: row.dataset.pointId }, true);
          else c.select({ kind: "card", id: card.id }, true);
        }}
        editor={
          ytext ? (
            <YTextEditor
              ytext={ytext}
              autoFocus
              placeholder="Type the argument…"
              testId="card-editor"
              onUndo={c.undo}
              onRedo={c.redo}
              onKeyDown={(e) => editorKeys(e, c, { kind: "card", id: card.id }, col.speech.id, ytext.toString())}
            />
          ) : undefined
        }
        points={card.points.map((p, i) => {
          const pt = editingPoint === p.id ? getPointText(session.doc, c.flow.perspective, card.id, p.id) : null;
          return {
            id: p.id,
            label: vm.pointLabels[i],
            text: p.text,
            onPointerDown: drag ? (e: React.PointerEvent) => drag.onPointPointerDown(e, card.id, p.id) : undefined,
            editor: pt ? (
              <YTextEditor
                ytext={pt}
                autoFocus
                placeholder="Point…"
                testId="point-editor"
                onUndo={c.undo}
                onRedo={c.redo}
                onKeyDown={(e) => editorKeys(e, c, { kind: "point", cardId: card.id, pointId: p.id }, col.speech.id, pt.toString())}
              />
            ) : undefined,
          };
        })}
      />
      {c.ui.tagMenu === card.id && <TagMenu cardId={card.id} c={c} pooOk={pooOk} />}
    </>
  );
}

function TagMenu({ cardId, c, pooOk }: { cardId: string; c: Controller; pooOk: boolean }) {
  const card = c.board.cards.get(cardId)?.card;
  return (
    <div className="popover" style={{ top: 18, right: 0 }} data-testid="tag-menu" onPointerDown={(e) => e.stopPropagation()}>
      <div className="menu">
        <div className="menu__label">Quick responses</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: "2px 4px 4px", maxWidth: 230 }}>
          {c.f.tags
            .filter((t) => !t.rebuttalOnly || pooOk)
            .map((t) => (
              <Chip
                key={t.type}
                label={t.label}
                tone={t.tone === "alert" ? "alert" : "default"}
                hotkey={t.hotkey}
                testId={`menu-tag-${t.type}`}
                title={card?.tags.some((x) => x.type === t.type) ? `Remove ${t.label}` : t.label}
                onClick={() => {
                  c.tag(cardId, t.type);
                  c.setTagMenu(null);
                }}
              />
            ))}
        </div>
      </div>
    </div>
  );
}

/** Keys while typing in a card / point / thesis (spec 02 «Создание и ввод»). */
export function editorKeys(e: KeyboardEvent<HTMLTextAreaElement>, c: Controller, focus: Focus, speech: string, text: string) {
  const mod = e.metaKey || e.ctrlKey;
  if (e.key === "Escape") {
    e.preventDefault();
    c.stopEditing();
    return;
  }
  if (mod && e.key === "Enter") {
    e.preventDefault();
    const id = focus.kind === "point" ? focus.cardId : focus.kind === "card" ? focus.id : null;
    if (id) c.said(id);
    return;
  }
  if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
    e.preventDefault();
    if (focus.kind === "card") c.addBelow(focus.id);
    else if (focus.kind === "point") c.addPointTo(focus.cardId, focus.pointId);
    else c.addAt({ speech, zone: "own", thesisId: focus.id, atStart: true });
    return;
  }
  if (e.key === "Tab") {
    e.preventDefault();
    if (e.shiftKey) c.outdent(focus);
    else c.indent(focus);
    return;
  }
  if (e.key === "Backspace" && text === "" && !mod) {
    e.preventDefault();
    c.remove(focus);
    return;
  }
  if (mod && e.key.toLowerCase() === "k") {
    e.preventDefault();
    c.setPalette(true);
  }
}
