import type { CSSProperties, ReactNode } from "react";

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
  /** "PM answered 4/5 · from PM left 1" (stage 2), next to "said X / Y" during the speech. */
  answers?: { text: string; kind: "answered" | "left"; left: number }[] | null;
  /** Board grid mode: the lane is a subgrid column; children place themselves in rows. */
  grid?: { column: number } | null;
  dim?: boolean;
  children?: ReactNode;
}

export function formatMinutes(min: number): string {
  const total = Math.round(min * 60);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** One lane per speech (Figma "Lane / …"): 240 px; future speeches are narrow and dashed. */
export function Lane({ speechId, label, title, minutes, sideTag, ours, live, future, counter, answers, grid, dim, children }: LaneProps) {
  const style: CSSProperties | undefined = grid ? { gridColumn: grid.column } : undefined;
  return (
    <section
      className={`lane${future ? " lane--future" : ""}${grid ? " lane--grid" : ""}${dim ? " lane--dim" : ""}`}
      data-testid={`lane-${speechId}`}
      data-lane={speechId}
      data-dim={dim ? "true" : "false"}
      aria-label={`${label} — ${title}`}
      style={style}
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
        {(counter || answers) && (
          <div className="lane__counters">
            {counter && (
              <div className="lane__counter" data-testid={`counter-${speechId}`}>
                said{" "}
                <b>
                  {counter.said} / {counter.total}
                </b>
              </div>
            )}
            {answers && (
              <div className="lane__counter lane__counter--answers" data-testid={`answer-counter-${speechId}`}>
                {answers.map((a, i) => (
                  <span key={i} className={a.kind === "left" && a.left > 0 ? "lane__counter-left" : undefined}>
                    {i > 0 && <span className="lane__counter-sep"> · </span>}
                    {a.text}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </header>
      {future && !children ? (
        <div className="lane__empty" style={grid ? { gridRow: "2 / -1" } : undefined}>
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
