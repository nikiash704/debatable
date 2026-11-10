import type { ReactNode } from "react";

export interface LaneProps {
  speechId: string;
  label: string;
  title: string;
  minutes: number;
  sideTag: string;
  ours: boolean;
  live: boolean;
  future: boolean;
  counter?: { said: number; total: number } | null;
  children?: ReactNode;
}

export function formatMinutes(min: number): string {
  const total = Math.round(min * 60);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** One lane per speech (Figma "Lane / …"): 240 px; future speeches are narrow and dashed. */
export function Lane({ speechId, label, title, minutes, sideTag, ours, live, future, counter, children }: LaneProps) {
  return (
    <section
      className={`lane${future ? " lane--future" : ""}`}
      data-testid={`lane-${speechId}`}
      data-lane={speechId}
      aria-label={`${label} — ${title}`}
    >
      <header className="lane__head">
        <div className="lane__row">
          <span className="lane__label">{label}</span>
          {!future && <span className={`side-tag${ours ? " side-tag--ours" : ""}`}>{sideTag}</span>}
          {live && <span className="live-tag">LIVE</span>}
          <span className="lane__spacer" />
          <span className="lane__time">{formatMinutes(minutes)}</span>
        </div>
        <div className="lane__sub">{title}</div>
        {counter && (
          <div className="lane__counter" data-testid={`counter-${speechId}`}>
            said{" "}
            <b>
              {counter.said} / {counter.total}
            </b>
          </div>
        )}
      </header>
      {future && !children ? (
        <div className="lane__empty">
          Not yet
          <br />
          spoken
        </div>
      ) : (
        children
      )}
    </section>
  );
}
