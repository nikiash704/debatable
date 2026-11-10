import { Fragment, memo, type KeyboardEvent } from "react";
import type { CardVM, ColumnVM, GroupVM, ZoneVM } from "../engine";
import { sideOf } from "../engine/stages";
import type { Focus } from "../engine/commands";
import { getCardText, getPointText, getThesisTitle } from "../sync/doc";
import type { Peer, RoomSession } from "../sync/session";
import { CardView } from "./components/CardView";
import { Chip } from "./components/Chip";
import { Lane } from "./components/Lane";
import { ThesisGroup } from "./components/ThesisGroup";
import type { Controller } from "./controller";
import { MOD } from "./keys";
import { YTextEditor } from "./YTextEditor";

interface BoardProps {
  c: Controller;
  session: RoomSession;
  peers: Peer[];
}

export function Board({ c, session, peers }: BoardProps) {
  return (
    <main
      className="board"
      data-testid="board"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains("lanes")) c.select(null);
      }}
    >
      <div className="lanes">
        {c.board.columns.map((col) => (
          <Column key={col.speech.id} col={col} c={c} session={session} peers={peers} />
        ))}
      </div>
    </main>
  );
}

function Column({ col, c, session, peers }: { col: ColumnVM; c: Controller; session: RoomSession; peers: Peer[] }) {
  const f = c.f;
  const empty = col.order.length === 0 && !col.zones.some((z) => z.groups.some((g) => g.thesis));
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
    >
      {narrow
        ? undefined
        : col.zones.map((z) => <Zone key={z.zone} z={z} col={col} c={c} session={session} peers={peers} />)}
    </Lane>
  );
}

function addLabel(col: ColumnVM, z: ZoneVM): string {
  if (!col.ours) return `Add ${col.speech.opponentLabel} argument`;
  if (!col.speech.allowsNew) return "Add rebuttal point";
  return z.zone === "clash" ? "Add response" : "Add argument";
}

function Zone({ z, col, c, session, peers }: { z: ZoneVM; col: ColumnVM; c: Controller; session: RoomSession; peers: Peer[] }) {
  const ownZone = col.ours && z.zone === "own" && !!col.speech.prefixSeries.own;
  const groups: GroupVM[] = z.groups.length ? z.groups : ownZone ? [] : [{ thesis: null, thesisNumber: null, cards: [] }];
  return (
    <div className="zone" data-testid={`zone-${col.speech.id}-${z.zone}`}>
      {z.label && <div className="zone__label">{z.label}</div>}
      {groups.map((g, gi) => (
        <Fragment key={g.thesis?.id ?? `loose-${gi}`}>
          {g.thesis ? (
            <ThesisItem g={g} z={z} col={col} c={c} session={session} peers={peers} />
          ) : (
            <Cards g={g} z={z} col={col} c={c} session={session} peers={peers} />
          )}
        </Fragment>
      ))}
      {ownZone && col.canAdd && (
        <div style={{ display: "flex", gap: 6, marginTop: groups.length ? 8 : 0 }}>
          {!groups.some((g) => !g.thesis) && (
            <button
              type="button"
              className="add-btn"
              data-testid={`add-loose-${col.speech.id}`}
              data-tip="New argument without a thesis"
              data-key="A"
              onClick={() => c.addAt({ speech: col.speech.id, zone: "own", thesisId: null })}
            >
              + Argument
            </button>
          )}
          <button
            type="button"
            className="add-btn"
            data-testid={`add-thesis-${col.speech.id}`}
            data-tip="New thesis"
            data-key="Shift+Tab on a card"
            onClick={() => c.addThesis(null)}
          >
            + Thesis
          </button>
        </div>
      )}
    </div>
  );
}

function ThesisItem({ g, z, col, c, session, peers }: { g: GroupVM; z: ZoneVM; col: ColumnVM; c: Controller; session: RoomSession; peers: Peer[] }) {
  const t = g.thesis!;
  const sel = c.ui.selection;
  const selected = sel?.kind === "thesis" && sel.id === t.id && c.columnOfFocus(sel) === col.speech.id;
  const editing = selected && c.ui.editing;
  const ytext = editing ? getThesisTitle(session.doc, c.flow.perspective, t.id) : null;
  const partner = peers.find((p) => p.editing?.kind === "thesis" && p.editing.id === t.id);
  return (
    <ThesisGroup
      number={g.thesisNumber ?? 0}
      title={t.title}
      selected={selected}
      data-testid="thesis"
      data-thesis-id={t.id}
      style={partner ? { borderLeftColor: partner.user.hex } : undefined}
      headProps={{
        onClick: (e) => {
          e.stopPropagation();
          if (selected && !editing) c.select({ kind: "thesis", id: t.id }, true);
          else c.select({ kind: "thesis", id: t.id });
        },
        onDoubleClick: (e) => {
          e.stopPropagation();
          c.select({ kind: "thesis", id: t.id }, true);
        },
        style: selected && !editing ? { background: "var(--c-fill-subtle)" } : undefined,
        "data-tip": editing ? undefined : "Thesis · double-click or Enter to rename",
      } as React.HTMLAttributes<HTMLDivElement>}
      editor={
        ytext ? (
          <YTextEditor
            ytext={ytext}
            autoFocus
            placeholder="Thesis title"
            testId="thesis-editor"
            onUndo={c.undo}
            onRedo={c.redo}
            onKeyDown={(e) => editorKeys(e, c, { kind: "thesis", id: t.id }, col.speech.id, ytext.toString())}
          />
        ) : undefined
      }
    >
      <Cards g={g} z={z} col={col} c={c} session={session} peers={peers} />
    </ThesisGroup>
  );
}

function Cards({ g, z, col, c, session, peers }: { g: GroupVM; z: ZoneVM; col: ColumnVM; c: Controller; session: RoomSession; peers: Peer[] }) {
  const slot = { speech: col.speech.id, zone: z.zone, thesisId: g.thesis?.id ?? null };
  return (
    <>
      {col.canAdd && g.cards.length > 0 && <Gap testId={`gap-before-${g.cards[0].label}`} onAdd={() => c.addAt({ ...slot, atStart: true })} />}
      {g.cards.map((vm, i) => (
        <Fragment key={vm.card.id}>
          <CardItem vm={vm} col={col} c={c} session={session} peers={peers} />
          {i < g.cards.length - 1 && col.canAdd && <Gap testId={`gap-after-${vm.label}`} onAdd={() => c.addAt({ ...slot, after: vm.card.id })} />}
          {i < g.cards.length - 1 && !col.canAdd && <div className="gap" />}
        </Fragment>
      ))}
      {col.canAdd && (
        <>
          {g.cards.length > 0 && <div className="gap" />}
          <button
            type="button"
            className="add-btn"
            data-testid={`add-${col.speech.id}-${z.zone}${g.thesis ? `-t${g.thesisNumber}` : ""}`}
            data-tip="New card at the end"
            data-key="A · Enter while typing"
            onClick={() => c.addAt(slot)}
          >
            + {addLabel(col, z)}
          </button>
        </>
      )}
    </>
  );
}

function Gap({ onAdd, testId }: { onAdd: () => void; testId?: string }) {
  return (
    <div className="gap">
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

const CardItem = memo(function CardItem({ vm, col, c, session, peers }: { vm: CardVM; col: ColumnVM; c: Controller; session: RoomSession; peers: Peer[] }) {
  const card = vm.card;
  const sel = c.ui.selection;
  const selected = (sel?.kind === "card" && sel.id === card.id) || (sel?.kind === "point" && sel.cardId === card.id);
  const editingText = selected && c.ui.editing && sel?.kind === "card";
  const editingPoint = selected && c.ui.editing && sel?.kind === "point" ? sel.pointId : null;
  const inSpeech = c.speechMode && c.speechColumn === col.speech.id && vm.ours;
  const partner = peers.find((p) => (p.editing?.kind === "card" && p.editing.id === card.id) || (p.editing?.kind === "point" && p.editing.cardId === card.id));
  const tone = vm.red ? "red" : vm.ours ? "ours" : "neutral";
  const expanded = c.ui.expanded.has(card.id);
  const ytext = editingText ? getCardText(session.doc, c.flow.perspective, card.id) : null;
  const pooOk = c.board.pooAvailable;

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

  return (
    <div style={{ position: "relative" }}>
      <CardView
        tone={tone}
        label={vm.label}
        text={card.text}
        strong={card.strong}
        struck={vm.struck}
        plates={plates}
        tags={tags}
        selected={selected && !c.ui.editing}
        editing={editingText || !!editingPoint}
        speech={inSpeech}
        partner={partner ? { name: partner.user.name, color: partner.user.hex } : null}
        expanded={expanded}
        onToggleExpand={() => c.toggleExpand(card.id)}
        tools={!inSpeech && !c.ui.editing ? tools : undefined}
        data-testid="card"
        data-card-id={card.id}
        data-label={vm.label}
        data-said={card.saidIn ? "true" : "false"}
        data-struck={vm.struck ? "true" : "false"}
        data-red={vm.red ? "true" : "false"}
        role="button"
        aria-pressed={inSpeech ? !!vm.struck : undefined}
        aria-label={`${vm.label} ${card.text}`}
        onClick={(e) => {
          e.stopPropagation();
          if (inSpeech) {
            c.speechTap(card.id);
            return;
          }
          if (selected && !c.ui.editing && sel?.kind === "card") c.select({ kind: "card", id: card.id }, true);
          else if (!(selected && c.ui.editing)) c.select({ kind: "card", id: card.id });
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
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
    </div>
  );
});

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
function editorKeys(e: KeyboardEvent<HTMLTextAreaElement>, c: Controller, focus: Focus, speech: string, text: string) {
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
