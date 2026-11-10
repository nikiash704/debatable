import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { getFormat, withTimes } from "../config/formats";
import { stagesOf } from "../engine/stages";
import { getRoom, setLastRoom, subscribeRooms, updateRoom, type RoomEntry } from "../sync/rooms";
import { RoomSession, randomIdentity, type Identity } from "../sync/session";
import { readJSON, writeJSON } from "../sync/storage";
import { ensureVerified, startNewRound } from "./App";
import { Board } from "./Board";
import { DocView } from "./DocView";
import { PrepTimerBar, usePrepTimer, type PrepTimerApi } from "./PrepTimer";
import { copyText, InviteBanner, StageBar, TopBar } from "./Chrome";
import { useController, type Controller } from "./controller";
import { isTyping, MOD } from "./keys";
import { CardPicker, CommandPalette, type Command } from "./Palette";
import { inviteLink } from "./router";
import { SetupPanel } from "./SetupPanel";

const IDENTITY_KEY = "debatable.identity";

function deviceIdentity(): Identity {
  let id = readJSON<Identity | null>(IDENTITY_KEY, null);
  if (!id || !id.name || !id.hex) {
    id = randomIdentity();
    writeJSON(IDENTITY_KEY, id);
  }
  return id;
}

function useEntry(code: string): RoomEntry | null {
  const cache = useRef<{ key: string; v: RoomEntry | null }>({ key: "", v: null });
  return useSyncExternalStore(subscribeRooms, () => {
    const v = getRoom(code);
    const key = JSON.stringify(v);
    if (key !== cache.current.key) cache.current = { key, v };
    return cache.current.v;
  });
}

/** Opens a room: local copy first, live sync once the code is verified (spec 01). */
export function RoomScreen({ code }: { code: string }) {
  const entry = useEntry(code);
  const [session, setSession] = useState<RoomSession | null>(null);

  useEffect(() => {
    const e = getRoom(code);
    const identity = e?.identity ?? deviceIdentity();
    const s = new RoomSession(code, { name: identity.name, color: identity.color, hex: identity.hex }, (id) =>
      updateRoom(code, { identity: id }),
    );
    if (!e?.identity) updateRoom(code, { identity });
    // test/debug hook (dev server and automated browsers only)
    if (import.meta.env.DEV || navigator.webdriver) (window as unknown as { __debatable?: RoomSession }).__debatable = s;
    setLastRoom(code);
    updateRoom(code, { openedAt: Date.now() });
    setSession(s);
    return () => {
      s.destroy();
      setSession(null);
    };
  }, [code]);

  // Verify / reserve the code in the background; connect live sync when it is ours.
  const verified = entry?.verified ?? false;
  useEffect(() => {
    if (!session) return;
    if (verified) {
      session.connect();
      return;
    }
    let stop = false;
    const attempt = async () => {
      const e = getRoom(code);
      if (!e || stop) return;
      const r = await ensureVerified(e, session.doc);
      if (r === "ok" && !stop) session.connect();
    };
    void attempt();
    const onOnline = () => void attempt();
    window.addEventListener("online", onOnline);
    const timer = window.setInterval(attempt, 15000);
    return () => {
      stop = true;
      window.removeEventListener("online", onOnline);
      window.clearInterval(timer);
    };
  }, [session, verified, code]);

  if (!session || !entry) return <div className="app" aria-busy="true" />;
  return <Room key={session.code} session={session} entry={entry} />;
}

function Room({ session, entry }: { session: RoomSession; entry: RoomEntry }) {
  const snap = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const peers = useSyncExternalStore(session.subscribePresence, session.getPeers);
  const f = useMemo(() => withTimes(getFormat(snap.formatId), snap.times, snap.prepMinutes), [snap.formatId, snap.times, snap.prepMinutes]);
  const side = snap.side;
  const sideMembers = f.sides.find((s) => s.id === side)?.members ?? [];
  const role = entry.role && sideMembers.some((m) => m.id === entry.role) ? entry.role : (f.defaults.role[side] ?? sideMembers[0]?.id ?? null);
  const c = useController(session, f, snap.flow, role, {
    initialView: entry.view,
    onView: (v) => updateRoom(entry.code, { view: v }),
  });
  const prep = usePrepTimer(session, f, snap);
  const [toastMsg, setToastMsg] = useState<{ text: string; action?: { label: string; run: () => void } } | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const toast = useCallback((m: string, action?: { label: string; run: () => void }) => {
    setToastMsg({ text: m, action });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(null), action ? 8000 : 1800);
  }, []);

  // The timer ended prep (on this device or the partner's): both switch to the Board, with Undo.
  const seenPrepEnd = useRef(snap.prepEnded);
  useEffect(() => {
    if (snap.prepEnded === seenPrepEnd.current) return;
    seenPrepEnd.current = snap.prepEnded;
    if (!snap.prepEnded || snap.stage === f.prepStage.id) return;
    c.setView("board");
    toast("Prep over — board", { label: "Undo", run: () => c.goStage(f.prepStage.id) });
  }, [snap.prepEnded, snap.stage, f.prepStage.id, c, toast]);
  const [setupOpen, setSetupOpen] = useState(entry.createdHere && !entry.setupDismissed && !entry.edited);

  // Keep the device's list of rounds up to date (motion, side, role; edited = stored for good).
  useEffect(() => {
    updateRoom(entry.code, {
      motion: snap.motion.slice(0, 140),
      side,
      role,
      ...(snap.empty ? {} : { edited: true }),
    });
  }, [entry.code, snap.motion, snap.empty, side, role]);

  useEffect(() => {
    session.setPresence({ role });
  }, [session, role]);

  const closeSetup = useCallback(() => {
    setSetupOpen(false);
    updateRoom(entry.code, { setupDismissed: true });
  }, [entry.code]);

  const setRole = useCallback((r: string) => updateRoom(entry.code, { role: r }), [entry.code]);

  const commands = useCommands(c, {
    prep: snap.stage === f.prepStage.id && prep.enabled ? prep : null,
    openSetup: () => setSetupOpen(true),
    copyLink: async () => toast((await copyText(inviteLink(entry.code))) ? "Invite link copied" : inviteLink(entry.code)),
    focusJoin: () => (document.querySelector('[data-testid="join-input"]') as HTMLInputElement | null)?.focus(),
  });

  useHotkeys(c, { setupOpen, closeSetup, toast, prep: snap.stage === f.prepStage.id && prep.enabled ? prep : null });

  const showInvite = peers.length === 0 && !entry.inviteDismissed;
  return (
    <div className="app" data-testid="room" data-code={entry.code} data-side={side} data-role={role ?? ""}>
      <TopBar
        code={entry.code}
        motion={snap.motion}
        f={f}
        side={side}
        role={role}
        me={session.identity}
        peers={peers}
        status={session.status}
        onSetup={() => setSetupOpen((o) => !o)}
        onPalette={() => c.setPalette(true)}
        toast={toast}
        view={c.ui.view}
        onView={c.setView}
      />
      {showInvite && <InviteBanner code={entry.code} onDismiss={() => updateRoom(entry.code, { inviteDismissed: true })} toast={toast} />}
      <StageBar c={c} timer={snap.stage === f.prepStage.id && prep.enabled ? <PrepTimerBar t={prep} /> : null} />
      <div className="app__body">
        {c.ui.view === "doc" ? (
          <DocView c={c} session={session} peers={peers} />
        ) : (
          <>
            <Board c={c} session={session} peers={peers} />
            <Legend />
          </>
        )}
        {setupOpen && (
          <SetupPanel
            session={session}
            f={f}
            side={side}
            role={role}
            times={snap.times}
            prepMinutes={snap.prepMinutes}
            onRole={setRole}
            onClose={closeSetup}
          />
        )}
      </div>
      {c.ui.palette && <CommandPalette commands={commands} onClose={() => c.setPalette(false)} />}
      {c.ui.picker && <CardPicker c={c} />}
      {toastMsg && (
        <div className="toast" role="status" data-testid="toast">
          <span data-testid="toast-text">{toastMsg.text}</span>
          {toastMsg.action && (
            <button
              type="button"
              className="toast__action"
              data-testid="toast-action"
              onClick={() => {
                toastMsg.action!.run();
                setToastMsg(null);
              }}
            >
              {toastMsg.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Legend (Figma 3:74, bottom right). */
function Legend() {
  return (
    <div className="legend" data-testid="legend" aria-label="Legend">
      <span className="legend__item">
        <span className="legend__dot" style={{ background: "var(--c-ours-line)" }} />
        Ours · standing
      </span>
      <span className="legend__item">
        <span className="legend__dot" style={{ background: "var(--c-red-counter)" }} />
        Unanswered
      </span>
      <span className="legend__item">
        <span className="legend__dot" style={{ background: "var(--c-text-muted)" }} />
        Answered
      </span>
      <span className="legend__note">Line = response → argument it answers</span>
    </div>
  );
}

function useCommands(c: Controller, extra: { prep: PrepTimerApi | null; openSetup: () => void; copyLink: () => void; focusJoin: () => void }): Command[] {
  const f = c.f;
  const sel = c.ui.selection;
  const cardId = sel?.kind === "card" ? sel.id : sel?.kind === "point" ? sel.cardId : null;
  const card = cardId ? c.board.cards.get(cardId) : null;
  const list: Command[] = [];
  list.push(
    { id: "next-stage", label: "Next stage", hotkey: "]", group: "Stages", run: c.next },
    { id: "prev-stage", label: "Previous stage", hotkey: "[", group: "Stages", run: c.prev },
  );
  for (const s of stagesOf(f)) list.push({ id: `stage-${s.id}`, label: `Go to ${s.label}`, group: "Stages", run: () => c.goStage(s.id) });
  if (c.canSpeechMode) list.push({ id: "speech-mode", label: c.speechMode ? "Speech mode off" : "Speech mode on", hotkey: "M", group: "Stages", run: c.toggleSpeechMode });
  list.push(
    { id: "new-card", label: card ? "New card below" : "New card", hotkey: "A", group: "Cards", run: () => c.addBelow(cardId) },
    { id: "new-thesis", label: "New thesis", group: "Cards", run: () => c.addThesis(sel?.kind === "thesis" ? sel.id : card?.card.thesisId ?? null) },
  );
  if (sel) {
    list.push(
      { id: "edit", label: "Edit selected", hotkey: "Enter", group: "Cards", run: () => c.select(sel, true) },
      { id: "delete", label: "Delete selected", hotkey: "Del", group: "Cards", run: () => c.remove(sel) },
      { id: "indent", label: "Level down (card → point, thesis → card)", hotkey: "Tab", group: "Cards", run: () => c.indent(sel) },
      { id: "outdent", label: "Level up (point → card, card → thesis)", hotkey: "Shift+Tab", group: "Cards", run: () => c.outdent(sel) },
    );
  }
  list.push({ id: "view", label: c.ui.view === "board" ? "Doc view (outline for prep)" : "Board view", hotkey: "D", group: "View", run: c.toggleView });
  if (extra.prep) {
    const p = extra.prep;
    list.push(
      { id: "prep-toggle", label: p.running ? "Pause prep timer" : "Start prep timer", hotkey: "Shift+Space", group: "Prep", run: p.toggle },
      { id: "prep-plus", label: "Prep timer +1 min", hotkey: "+", group: "Prep", run: p.plus },
      { id: "prep-reset", label: "Reset prep timer", hotkey: "Shift+R", group: "Prep", run: p.reset },
    );
  }
  if (sel) list.push({ id: "move-up", label: "Move up", hotkey: "Alt+↑", group: "Cards", run: () => c.moveStep(sel, -1) }, { id: "move-down", label: "Move down", hotkey: "Alt+↓", group: "Cards", run: () => c.moveStep(sel, 1) });
  if (card) {
    const place = c.answerPlaceOf(card.card.id);
    if (place.ok) list.push({ id: "answer", label: `Answer ${card.label}`, hotkey: "R", group: "Clash", run: () => c.answer(card.card.id) });
    else list.push({ id: "answer", label: `Answer ${card.label} — ${place.reason}`, hotkey: "R", group: "Clash", run: () => undefined });
    list.push({ id: "link", label: `Link ${card.label} to the arguments it answers…`, hotkey: "L", group: "Clash", run: () => c.startLink(card.card.id) });
    card.targets.forEach((t, i) =>
      list.push({ id: `unlink-${t}`, label: `Unlink ${card.label} → ${card.targetLabels[i]}`, hotkey: "L", group: "Clash", run: () => c.unlink(card.card.id, t) }),
    );
  }
  if (c.ui.link) {
    const l = c.ui.link;
    list.push({ id: "unlink-selected", label: `Unlink ${c.board.cards.get(l.from)?.label} → ${c.board.cards.get(l.to)?.label}`, hotkey: "Del", group: "Clash", run: () => c.unlink(l.from, l.to) });
  }
  for (const v of c.board.unanswered.slice(0, 12)) list.push({ id: `goto-${v.card.id}`, label: `Go to unanswered ${v.label}`, group: "Clash", run: () => c.jumpTo(v.card.id) });
  if (card) {
    if (card.ours) list.push({ id: "said", label: card.card.saidIn ? "Mark not said" : "Mark said", hotkey: c.speechMode ? `Space · ${MOD}↵` : `${MOD}↵`, group: "Card", run: () => c.said(card.card.id) });
    list.push(
      { id: "strong", label: card.card.strong ? "Not strong" : "Strong", hotkey: "S", group: "Card", run: () => c.strong(card.card.id) },
      { id: "add-point", label: "Add point", hotkey: "Enter, Tab", group: "Card", run: () => c.addPointTo(card.card.id) },
      { id: "expand", label: c.ui.expanded.has(card.card.id) ? "Collapse points" : "Show all points", hotkey: "E", group: "Card", run: () => c.toggleExpand(card.card.id) },
    );
    for (const t of f.tags) {
      if (t.rebuttalOnly && !c.board.pooAvailable) continue;
      list.push({ id: `tag-${t.type}`, label: `Tag: ${t.label}`, hotkey: t.hotkey, group: "Card", run: () => c.tag(card.card.id, t.type) });
    }
  }
  list.push(
    { id: "undo", label: "Undo", hotkey: `${MOD}Z`, group: "Edit", run: c.undo },
    { id: "redo", label: "Redo", hotkey: `${MOD}⇧Z`, group: "Edit", run: c.redo },
    { id: "setup", label: "Round setup (motion, side, role, times)", group: "Round", run: extra.openSetup },
    { id: "copy-link", label: "Copy invite link", group: "Round", run: extra.copyLink },
    { id: "join", label: "Join a round with a code", group: "Round", run: extra.focusJoin },
    { id: "new-round", label: "New round", group: "Round", run: startNewRound },
  );
  return list;
}

/** Global hotkeys while not typing (spec 02 «Создание и ввод»). */
function useHotkeys(
  c: Controller,
  o: { setupOpen: boolean; closeSetup: () => void; toast: (m: string) => void; prep: PrepTimerApi | null },
) {
  const ref = useRef({ c, o });
  ref.current = { c, o };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { c, o } = ref.current;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        c.setPalette(!c.ui.palette);
        return;
      }
      if (c.ui.palette || c.ui.picker) return;
      if (isTyping(e)) return;
      // Link pick mode: arrows move between eligible cards, Enter / Space toggle, Esc ends
      if (c.ui.pick) {
        const dirs: Record<string, "up" | "down" | "left" | "right"> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
        if (dirs[e.key]) {
          e.preventDefault();
          c.pickMove(dirs[e.key]);
        } else if ((e.key === "Enter" || e.key === " ") && c.ui.pick.cursor) {
          e.preventDefault();
          c.pickToggle(c.ui.pick.cursor);
        } else if (e.key === "Escape" || e.key.toLowerCase() === "l") {
          e.preventDefault();
          c.endPick();
        }
        return;
      }
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) c.redo();
        else c.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        c.redo();
        return;
      }
      const sel = c.ui.selection;
      const cardId = sel?.kind === "card" ? sel.id : sel?.kind === "point" ? sel.cardId : null;
      // keyboard drag: Alt+↑/↓ moves the selection one slot
      if (e.altKey && !mod && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        const hint = c.moveStep(sel, e.key === "ArrowUp" ? -1 : 1);
        if (hint) o.toast(hint);
        return;
      }
      // prep timer
      if (o.prep && !mod && !e.altKey) {
        if (e.key === " " && e.shiftKey) {
          e.preventDefault();
          o.prep.toggle();
          return;
        }
        if (e.key === "+") {
          e.preventDefault();
          o.prep.plus();
          return;
        }
        if (e.key === "R" && e.shiftKey) {
          e.preventDefault();
          o.prep.reset();
          return;
        }
      }
      if (mod && e.key === "Enter") {
        e.preventDefault();
        if (cardId) c.said(cardId);
        return;
      }
      if (mod || e.altKey) return;
      const k = e.key;
      const handled = () => e.preventDefault();
      if (c.ui.link && (k === "Delete" || k === "Backspace")) {
        c.unlink(c.ui.link.from, c.ui.link.to);
        c.selectLink(null);
        return handled();
      }
      switch (k) {
        case "Escape":
          if (c.ui.tagMenu) c.setTagMenu(null);
          else if (o.setupOpen) o.closeSetup();
          else if (c.ui.link) c.selectLink(null);
          else c.select(null);
          return handled();
        case "ArrowUp":
          c.move("up");
          return handled();
        case "ArrowDown":
          c.move("down");
          return handled();
        case "ArrowLeft":
          c.move("left");
          return handled();
        case "ArrowRight":
          c.move("right");
          return handled();
        case "[":
          c.prev();
          return handled();
        case "]":
          c.next();
          return handled();
        case "Enter":
          if (sel) c.select(sel.kind === "point" ? sel : sel, true);
          else c.addBelow(null);
          return handled();
        case "Tab":
          if (!sel) return;
          if (e.shiftKey) c.outdent(sel);
          else c.indent(sel);
          return handled();
        case "Delete":
        case "Backspace":
          if (sel) c.remove(sel);
          return handled();
        case " ":
          if (c.speechMode && cardId) {
            const col = c.board.cards.get(cardId)?.card.ownerSpeech;
            if (col === c.speechColumn) c.speechTap(cardId);
            else c.said(cardId);
            return handled();
          }
          return;
      }
      const key = k.length === 1 ? k.toLowerCase() : k;
      if (key === "m") {
        c.toggleSpeechMode();
        return handled();
      }
      if (key === "a") {
        c.addBelow(cardId);
        return handled();
      }
      if (key === "d") {
        c.toggleView();
        return handled();
      }
      if (!cardId) return;
      if (key === "r") {
        c.answer(cardId);
        return handled();
      }
      if (key === "l") {
        c.startLink(cardId);
        return handled();
      }
      if (key === "s") {
        c.strong(cardId);
        return handled();
      }
      if (key === "e") {
        c.toggleExpand(cardId);
        return handled();
      }
      const tag = c.f.tags.find((t) => t.hotkey.toLowerCase() === key);
      if (tag) {
        c.tag(cardId, tag.type);
        return handled();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}
