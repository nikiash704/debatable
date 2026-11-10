/**
 * Prep timer (spec 02 requirement 1): pure functions of time and state. The state is room state
 * (synced), so both devices show the same countdown. Each Start begins a new run id; when a run
 * reaches 0 during Prep the round moves to the first speech once per run (guarded by `advancedRun`).
 */
export interface PrepTimer {
  /** "" = never started. A new id on every Start and Reset. */
  runId: string;
  /** Epoch ms when it reaches 0 while running; null while paused. */
  endsAt: number | null;
  /** Remaining ms while paused. */
  remainingMs: number;
  /** Length of the run (for the progress bar): prep minutes + every "+1 min". */
  totalMs: number;
}

export const MINUTE = 60_000;

/** Reads the stored value (or none yet) into a timer; an untouched timer follows the prep minutes. */
export function readPrepTimer(raw: unknown, durationMs: number): PrepTimer {
  const r = raw as Partial<PrepTimer> | null | undefined;
  if (!r || typeof r !== "object" || typeof r.runId !== "string") return { runId: "", endsAt: null, remainingMs: durationMs, totalMs: durationMs };
  const remainingMs = typeof r.remainingMs === "number" && r.remainingMs >= 0 ? r.remainingMs : durationMs;
  return {
    runId: r.runId,
    endsAt: typeof r.endsAt === "number" ? r.endsAt : null,
    remainingMs,
    totalMs: typeof r.totalMs === "number" && r.totalMs > 0 ? r.totalMs : Math.max(durationMs, remainingMs),
  };
}

export function timerRemaining(t: PrepTimer, now: number): number {
  return t.endsAt === null ? Math.max(0, t.remainingMs) : Math.max(0, t.endsAt - now);
}

export function timerRunning(t: PrepTimer, now: number): boolean {
  return t.endsAt !== null && t.endsAt > now;
}

export function timerExpired(t: PrepTimer, now: number): boolean {
  return t.runId !== "" && timerRemaining(t, now) === 0;
}

export function startTimer(t: PrepTimer, now: number, runId: string): PrepTimer {
  const left = timerRemaining(t, now);
  if (left <= 0 || timerRunning(t, now)) return t;
  return { runId, endsAt: now + left, remainingMs: left, totalMs: t.totalMs };
}

export function pauseTimer(t: PrepTimer, now: number): PrepTimer {
  if (t.endsAt === null) return t;
  return { ...t, endsAt: null, remainingMs: timerRemaining(t, now) };
}

/** +1 min: while running it pushes the end; when paused or finished it adds to what is left (paused). */
export function addMinute(t: PrepTimer, now: number): PrepTimer {
  if (timerRunning(t, now)) return { ...t, endsAt: t.endsAt! + MINUTE, totalMs: t.totalMs + MINUTE };
  const left = timerRemaining(t, now);
  return { ...t, endsAt: null, remainingMs: left + MINUTE, totalMs: left > 0 ? t.totalMs + MINUTE : MINUTE };
}

export function resetTimer(durationMs: number, runId: string): PrepTimer {
  return { runId, endsAt: null, remainingMs: durationMs, totalMs: durationMs };
}

/** Should this device move the round from Prep to the first speech now? At most once per run. */
export function shouldAdvance(o: { isPrep: boolean; timer: PrepTimer; advancedRun: string | null; now: number; enabled: boolean }): boolean {
  return o.enabled && o.isPrep && o.timer.endsAt !== null && timerExpired(o.timer, o.now) && o.advancedRun !== o.timer.runId;
}

/** "14:05" */
export function formatClock(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
