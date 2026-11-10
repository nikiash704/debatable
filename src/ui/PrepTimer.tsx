import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormatConfig } from "../config/types";
import { planStageChange, stageAt } from "../engine";
import {
  addMinute,
  formatClock,
  pauseTimer,
  readPrepTimer,
  resetTimer,
  shouldAdvance,
  startTimer,
  timerRemaining,
  timerRunning,
  type PrepTimer,
} from "../engine/timer";
import type { RoomSnapshot } from "../sync/doc";
import type { RoomSession } from "../sync/session";
import { randomId } from "../sync/storage";

export interface PrepTimerApi {
  enabled: boolean;
  timer: PrepTimer;
  running: boolean;
  start: () => void;
  pause: () => void;
  toggle: () => void;
  plus: () => void;
  reset: () => void;
}

/**
 * Prep timer state and actions. The timer is room state (synced), so both devices count down together.
 * While it runs during Prep, every device checks it; at 0 the round moves to the first speech once per run.
 */
export function usePrepTimer(session: RoomSession, f: FormatConfig, snap: RoomSnapshot): PrepTimerApi {
  const durationMs = Math.round(f.prepMinutes * 60_000);
  const timer = useMemo(() => readPrepTimer(snap.prepTimer, durationMs), [snap.prepTimer, durationMs]);
  const enabled = durationMs > 0;
  const isPrep = snap.stage === f.prepStage.id;
  const [, tick] = useState(0);

  useEffect(() => {
    if (!isPrep || timer.endsAt === null || !enabled) return;
    const check = () => {
      const now = Date.now();
      tick((n) => n + 1);
      const live = session.getSnapshot();
      if (shouldAdvance({ isPrep: live.stage === f.prepStage.id, timer, advancedRun: live.prepAdvanced, now, enabled })) {
        const ops = planStageChange(f, live.flow, stageAt(f, 1));
        session.advancePrep(timer.runId, f.prepStage.id, ops);
      }
    };
    check();
    const id = window.setInterval(check, 250);
    return () => window.clearInterval(id);
  }, [isPrep, timer, enabled, f, session]);

  const now = Date.now();
  const running = timerRunning(timer, now);
  const start = useCallback(() => session.setPrepTimer(startTimer(timer, Date.now(), randomId(8))), [session, timer]);
  const pause = useCallback(() => session.setPrepTimer(pauseTimer(timer, Date.now())), [session, timer]);
  const toggle = useCallback(() => (timerRunning(timer, Date.now()) ? pause() : start()), [timer, pause, start]);
  const plus = useCallback(() => session.setPrepTimer(addMinute(timer, Date.now())), [session, timer]);
  const reset = useCallback(() => session.setPrepTimer(resetTimer(durationMs, randomId(8))), [session, durationMs]);
  return { enabled, timer, running, start, pause, toggle, plus, reset };
}

/** In the stage bar where the mock has the speech timer; only during Prep. */
export function PrepTimerBar({ t }: { t: PrepTimerApi }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!t.running) {
      setNow(Date.now());
      return;
    }
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [t.running, t.timer]);
  const left = timerRemaining(t.timer, now);
  const pct = t.timer.totalMs > 0 ? Math.max(0, Math.min(100, (1 - left / t.timer.totalMs) * 100)) : 100;
  return (
    <div className="prep-timer" data-testid="prep-timer" data-running={t.running ? "true" : "false"}>
      <div className="prep-timer__clock">
        <span className="prep-timer__label">PREP</span>
        <span className="prep-timer__time" data-testid="prep-clock">
          {formatClock(left)}
        </span>
        <span className="prep-timer__total">/ {formatClock(t.timer.totalMs)}</span>
        <div className="prep-timer__bar" aria-hidden="true">
          <div style={{ width: `${pct}%` }} />
        </div>
      </div>
      <button
        type="button"
        className="btn btn--outline prep-timer__btn"
        data-testid="prep-toggle"
        data-tip={t.running ? "Pause prep" : left > 0 ? "Start prep" : "Prep is over: +1 min or reset"}
        data-key="Shift+Space"
        disabled={!t.running && left <= 0}
        onClick={t.toggle}
      >
        {t.running ? "Pause" : "Start"}
      </button>
      <button type="button" className="btn btn--outline prep-timer__btn" data-testid="prep-plus" data-tip="One more minute" data-key="+" onClick={t.plus}>
        +1 min
      </button>
      <button type="button" className="icon-btn" data-testid="prep-reset" data-tip="Reset prep timer" data-key="Shift+R" onClick={t.reset} aria-label="Reset prep timer">
        ↺
      </button>
    </div>
  );
}
