import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { renderSVG } from "uqr";
import type { FormatConfig } from "../config/types";
import { sideOf, stageIndex, stagesOf } from "../engine/stages";
import { nextStage, prevStage } from "../engine/transitions";
import { normalizeCode } from "../shared/code";
import { listRooms, subscribeRooms, type RoomEntry } from "../sync/rooms";
import type { Identity, Peer, SyncStatus } from "../sync/session";
import { startNewRound } from "./App";
import copyIcon from "./icons/copy.svg";
import { StageStepper } from "./components/StageStepper";
import type { Controller } from "./controller";
import { MOD } from "./keys";
import { inviteLink, navigate, roomPath } from "./router";

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function useOutside(ref: React.RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, open, close]);
}

export function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface TopBarProps {
  code: string;
  motion: string;
  f: FormatConfig;
  side: string;
  role: string | null;
  me: Identity;
  peers: Peer[];
  status: SyncStatus;
  onSetup: () => void;
  onPalette: () => void;
  toast: (msg: string) => void;
}

/** Top bar (Figma 3:3): brand, motion, side/role/partner, round code with copy, rounds, have-a-code field. */
export function TopBar({ code, motion, f, side, role, me, peers, status, onSetup, onPalette, toast }: TopBarProps) {
  const partner = peers[0];
  const statusText =
    status === "synced" ? "Synced" : status === "connecting" ? "Connecting…" : status === "offline" ? "Offline · saved here" : status === "local" ? "Saved on this device" : "Loading…";
  return (
    <header className="topbar" data-testid="topbar">
      <a className="brand" href="/" onClick={(e) => e.preventDefault()} aria-label="Debatable">
        <span className="brand__mark">D</span>
        <span className="brand__name">Debatable</span>
      </a>
      <span className="topbar__slash">/</span>
      <button
        type="button"
        className={`topbar__motion${motion ? "" : " topbar__motion--empty"}`}
        data-testid="topbar-motion"
        data-tip="Round setup"
        onClick={onSetup}
      >
        {motion || "Add the motion…"}
      </button>
      <span className="topbar__spacer" />
      <span className={`sync${status === "synced" ? "" : " sync--offline"}`} data-testid="sync-status" data-status={status}>
        {statusText}
      </span>
      <span className="side-pill" data-testid="side-pill">
        <span className="side-pill__side">{sideOf(f, side).label}</span>
        <span className="side-pill__dot">·</span>
        <span className="side-pill__rest">
          <span data-testid="me">
            You: {role ?? "—"}{" "}
            <span className="side-pill__detail">
              ({me.name}, {me.color})
            </span>
          </span>
          <span className="side-pill__dot">·</span>
          {partner ? (
            <span data-testid="partner" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span className="presence-dot" style={{ background: partner.user.hex }} />
              <span className="side-pill__partner-name">Partner: </span>
              {partner.user.name} ({partner.user.color}){partner.role ? ` · ${partner.role}` : ""}
            </span>
          ) : (
            <span data-testid="partner-none">No partner yet</span>
          )}
        </span>
      </span>
      <button
        type="button"
        className="code-pill"
        data-testid="code-pill"
        data-tip="Copy invite link"
        onClick={async () => toast((await copyText(inviteLink(code))) ? "Invite link copied" : inviteLink(code))}
      >
        <span className="code-pill__code" data-testid="room-code">
          {code}
        </span>
        <img src={copyIcon} width={14} height={14} alt="" />
      </button>
      <JoinField />
      <RoundsMenu code={code} />
      <button type="button" className="icon-btn" data-testid="open-setup" data-tip="Round setup" onClick={onSetup}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2.5 4.5h7M12.5 4.5h1M2.5 11.5h1M6.5 11.5h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          <circle cx="11" cy="4.5" r="1.5" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="5" cy="11.5" r="1.5" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      </button>
      <button type="button" className="btn btn--outline" data-testid="open-palette" data-tip="Command palette" data-key={`${MOD}K`} onClick={onPalette}>
        <span className="btn__key" style={{ color: "inherit" }}>
          {MOD}K
        </span>
      </button>
    </header>
  );
}

/** "Have a code?" — always visible (spec 01). */
function JoinField() {
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);
  return (
    <form
      className="join"
      onSubmit={(e) => {
        e.preventDefault();
        const code = normalizeCode(value);
        if (!code) {
          setError(true);
          return;
        }
        setValue("");
        navigate(roomPath(code));
      }}
    >
      <input
        className="join__input"
        data-testid="join-input"
        placeholder="Have a code?"
        aria-label="Have a code? Enter it to join"
        value={value}
        maxLength={12}
        aria-invalid={error}
        data-tip={error ? "Codes are 5 letters/digits" : undefined}
        onChange={(e) => {
          setValue(e.target.value);
          setError(false);
        }}
      />
      {value && (
        <button className="btn btn--outline" type="submit" data-testid="join-go">
          Open →
        </button>
      )}
    </form>
  );
}

function useRooms(): RoomEntry[] {
  const cache = useRef<{ key: string; list: RoomEntry[] }>({ key: "", list: [] });
  return useSyncExternalStore(subscribeRooms, () => {
    const list = listRooms();
    const key = JSON.stringify(list);
    if (key !== cache.current.key) cache.current = { key, list };
    return cache.current.list;
  });
}

function RoundsMenu({ code }: { code: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, open, () => setOpen(false));
  const rooms = useRooms().filter((r) => r.edited || r.code === code);
  return (
    <div ref={ref} style={{ position: "relative", flex: "none" }}>
      <button type="button" className="btn btn--dark" data-testid="rounds-menu" data-tip="Rounds on this device · new round" onClick={() => setOpen((o) => !o)}>
        Rounds ▾
      </button>
      {open && (
        <div className="popover" style={{ right: 0, top: 36, width: 400 }} data-testid="rounds-popover">
          <div className="menu">
            <button
              type="button"
              className="menu__item"
              data-testid="new-round"
              onClick={() => {
                setOpen(false);
                startNewRound();
              }}
            >
              <b>+ New round</b>
              <span className="menu__key">new code</span>
            </button>
            <div className="menu__sep" />
            <div className="menu__label">Recent on this device</div>
            <div className="recent">
              {rooms.map((r) => (
                <button
                  key={r.code}
                  type="button"
                  className="recent__item"
                  aria-current={r.code === code}
                  data-testid="recent-item"
                  onClick={() => {
                    setOpen(false);
                    navigate(roomPath(r.code));
                  }}
                >
                  <span className="recent__code">{r.code}</span>
                  <span className="recent__motion">{r.motion || "Untitled round"}</span>
                  <span className="recent__meta">
                    {formatDate(r.openedAt)}
                    {r.side ? ` · ${r.side === "gov" ? "Gov" : r.side === "opp" ? "Opp" : r.side}` : ""}
                    {r.role ? ` · ${r.role}` : ""}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** "Invite partner: CODE" with copy, link /r/CODE and QR (spec 01). */
export function InviteBanner({ code, onDismiss, toast }: { code: string; onDismiss: () => void; toast: (m: string) => void }) {
  const [qr, setQr] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, qr, () => setQr(false));
  const link = inviteLink(code);
  return (
    <div className="invite" data-testid="invite-banner" ref={ref} style={{ position: "relative" }}>
      <span className="invite__label">Invite partner:</span>
      <span className="invite__code" data-testid="invite-code">
        {code}
      </span>
      <button type="button" className="btn btn--outline" data-tip="Copy the code" onClick={async () => toast((await copyText(code)) ? "Code copied" : code)}>
        Copy code
      </button>
      <a className="invite__link" href={link} data-testid="invite-link" onClick={(e) => e.preventDefault()}>
        {link.replace(/^https?:\/\//, "")}
      </a>
      <button type="button" className="btn btn--outline" data-testid="copy-link" data-tip="Copy the invite link" onClick={async () => toast((await copyText(link)) ? "Invite link copied" : link)}>
        Copy link
      </button>
      <button type="button" className="btn btn--outline" data-testid="show-qr" data-tip="Show QR code" onClick={() => setQr((q) => !q)}>
        QR
      </button>
      <span className="invite__hint">The code never expires — it is also your save file.</span>
      <span className="topbar__spacer" />
      <button type="button" className="icon-btn" data-tip="Hide" onClick={onDismiss} aria-label="Hide invite">
        ✕
      </button>
      {qr && (
        <div className="qr-pop" style={{ top: 40, left: 20 }} data-testid="qr">
          <div dangerouslySetInnerHTML={{ __html: renderSVG(link, { border: 1 }) }} />
          <span className="qr-pop__caption">{code}</span>
        </div>
      )}
    </div>
  );
}

/** Stage bar (Figma 3:22): stepper, speech mode, back / next. Timer, POI status and counters come later. */
export function StageBar({ c }: { c: Controller }) {
  const f = c.f;
  const stage = c.flow.stage;
  const idx = stageIndex(f, stage);
  const last = stagesOf(f).length - 1;
  const nextLabel = stagesOf(f)[Math.min(last, idx + 1)].label;
  const prevLabel = stagesOf(f)[Math.max(0, idx - 1)].label;
  return (
    <div className="stagebar" data-testid="stagebar" data-stage={stage}>
      <StageStepper steps={c.board.steps} onPick={(id) => c.goStage(id)} />
      <span className="stagebar__spacer" />
      {c.canSpeechMode && (
        <button
          type="button"
          className="speech-toggle"
          aria-pressed={c.speechMode}
          data-testid="speech-mode"
          data-tip={c.speechMode ? "Turn speech mode off" : "Turn speech mode on"}
          data-key="M"
          onClick={c.toggleSpeechMode}
        >
          <span className="switch" />
          Speech mode
        </button>
      )}
      <div className="stagebar__nav">
        <button
          type="button"
          className="btn btn--outline"
          data-testid="stage-back"
          disabled={idx === 0}
          data-tip={`Back to ${prevLabel}`}
          data-key="["
          onClick={() => c.goStage(prevStage(f, stage))}
        >
          ← Back
        </button>
        <button
          type="button"
          className="btn btn--dark"
          data-testid="stage-next"
          disabled={idx === last}
          data-tip={`Next stage: ${nextLabel}`}
          data-key="]"
          onClick={() => c.goStage(nextStage(f, stage))}
        >
          Next: {nextLabel} →
        </button>
      </div>
    </div>
  );
}
