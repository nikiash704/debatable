import { useEffect, useRef } from "react";
import type { FormatConfig } from "../config/types";
import { getFormat } from "../config/formats";
import { motionText, setRoomField, setSpeechTime } from "../sync/doc";
import type { RoomSession } from "../sync/session";
import { formatMinutes } from "./components/Lane";
import { YTextEditor } from "./YTextEditor";

interface SetupPanelProps {
  session: RoomSession;
  f: FormatConfig;
  side: string;
  role: string | null;
  times: Record<string, number>;
  prepMinutes: number | null;
  onRole: (role: string) => void;
  onClose: () => void;
}

function parseMinutes(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
  if (!m) return null;
  const v = Number(m[1]) + (m[2] ? Number(m[2]) / 60 : 0);
  return v >= 0 && v <= 60 ? Math.round(v * 60) / 60 : null;
}

function TimeCell({ label, value, testId, onChange }: { label: string; value: number; testId: string; onChange: (v: number | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current) ref.current.value = formatMinutes(value);
  }, [value]);
  return (
    <label className="time">
      <span className="time__label">{label}</span>
      <input
        ref={ref}
        className="time__input"
        defaultValue={formatMinutes(value)}
        data-testid={testId}
        inputMode="numeric"
        aria-label={`${label} minutes`}
        onBlur={(e) => {
          const v = parseMinutes(e.target.value);
          if (v === null) e.target.value = formatMinutes(value);
          else onChange(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
    </label>
  );
}

/**
 * Non-blocking round setup (look from Figma 5:244). Opens on a new room, can be dismissed.
 * Motion, side, role and speech times; no partner-name field (names are auto-generated).
 */
export function SetupPanel({ session, f, side, role, times, prepMinutes, onRole, onClose }: SetupPanelProps) {
  const base = getFormat(f.id);
  const members = f.sides.find((s) => s.id === side)?.members ?? [];
  return (
    <aside className="panel setup" data-testid="setup-panel" aria-label="Round setup" onPointerDown={(e) => e.stopPropagation()}>
      <div className="setup__head">
        <span className="setup__title">Round setup</span>
        <span className="topbar__spacer" />
        <span className="field__hint" style={{ marginLeft: 0 }}>
          {f.short} · optional
        </span>
        <button type="button" className="icon-btn" data-testid="setup-close" data-tip="Close" data-key="Esc" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="field">
        <div className="field__row">
          <span className="field__label">Motion</span>
          <span className="field__hint">Paste or type</span>
        </div>
        <div className="textarea" style={{ minHeight: 64 }}>
          <YTextEditor ytext={motionText(session.doc)} placeholder="This House would…" testId="motion-input" ariaLabel="Motion" onUndo={() => session.undo.undo()} onRedo={() => session.undo.redo()} />
        </div>
      </div>
      <div className="field">
        <span className="field__label">Side</span>
        <div className="segmented" role="radiogroup" aria-label="Side">
          {f.sides.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              className="segmented__opt"
              aria-checked={s.id === side}
              data-testid={`side-${s.id}`}
              onClick={() => {
                setRoomField(session.doc, "side", s.id);
                if (!s.members.some((m) => m.id === role)) onRole(f.defaults.role[s.id] ?? s.members[0].id);
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <div className="field__row">
          <span className="field__label">Your role</span>
          <span className="field__hint">on this device · turns speech mode on for your speeches</span>
        </div>
        <div className="roles" role="radiogroup" aria-label="Your role">
          {members.map((m) => {
            const speeches = f.speeches.filter((s) => s.side === side && s.speaker === m.id).map((s) => s.label);
            return (
              <button key={m.id} type="button" role="radio" className="role-opt" aria-checked={m.id === role} data-testid={`role-${m.id}`} onClick={() => onRole(m.id)}>
                {m.id} · {speeches.join(" + ")}
              </button>
            );
          })}
        </div>
      </div>
      <div className="field">
        <div className="field__row">
          <span className="field__label">Speech times</span>
          <button
            type="button"
            className="field__hint"
            data-tip="Back to the format's default times"
            onClick={() => {
              for (const s of f.speeches) setSpeechTime(session.doc, s.id, null);
              setRoomField(session.doc, "prepMinutes", base.prepMinutes);
            }}
          >
            {base.short} default · reset
          </button>
        </div>
        <div className="times">
          <TimeCell
            label="Prep"
            value={prepMinutes ?? base.prepMinutes}
            testId="time-prep"
            onChange={(v) => setRoomField(session.doc, "prepMinutes", v)}
          />
          {f.speeches.map((s) => (
            <TimeCell
              key={s.id}
              label={s.label}
              value={times[s.id] ?? base.speeches.find((x) => x.id === s.id)?.minutes ?? s.minutes}
              testId={`time-${s.id}`}
              onChange={(v) => setSpeechTime(session.doc, s.id, v)}
            />
          ))}
        </div>
      </div>
      <button type="button" className="btn btn--dark btn--lg" style={{ justifyContent: "center" }} data-testid="setup-done" onClick={onClose}>
        Start flowing <span className="btn__key">Esc</span>
      </button>
      <p className="setup__foot">Everything saves as you type. Reopen this panel from the motion or the settings icon.</p>
    </aside>
  );
}
