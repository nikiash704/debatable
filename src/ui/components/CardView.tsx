import type { CSSProperties, HTMLAttributes, PointerEvent as ReactPointerEvent, ReactNode } from "react";

/** ours = green border; said = green tint (our rebuttal); neutral = answered; unanswered = red; red = new — don't say. */
export type CardTone = "ours" | "said" | "neutral" | "unanswered" | "red";

export interface CardTarget {
  label: string;
  tone: CardTone;
}

export interface CardPointView {
  id: string;
  label: string;
  text: string;
  editor?: ReactNode;
  selected?: boolean;
  /** Drag handle (points can be dragged inside a card and between cards). */
  onPointerDown?: (e: ReactPointerEvent) => void;
}

export interface CardPlate {
  text: string;
  tone?: "red" | "mono";
  testId?: string;
}

export interface CardViewProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  tone: CardTone;
  label: string;
  text: string;
  /** Replaces the title while the card text is being edited. */
  editor?: ReactNode;
  placeholder?: string;
  points: CardPointView[];
  expanded: boolean;
  onToggleExpand?: () => void;
  strong?: boolean;
  struck?: boolean;
  plates?: CardPlate[];
  tags?: ReactNode;
  selected?: boolean;
  editing?: boolean;
  speech?: boolean;
  partner?: { name: string; color: string } | null;
  tools?: ReactNode;
  /** "Responding to PM1, PM2" (answer links, mock "M3 Responding to G6"). */
  responding?: CardTarget[];
  /** Small mono line at the bottom ("said in LOC"). */
  meta?: string | null;
  /** Extra content after the card (e.g. the "no target · L" hint). */
  hint?: ReactNode;
}

/**
 * Argument card (Figma 2:86). Tones: ours (green border), neutral ("Answered"), unanswered (red, an
 * opponent card nobody answered yet), red ("new — don't say" in our rebuttal, always with its label),
 * said (green tint: said in a constructive, shown during our rebuttal).
 * Points are the mock's "1a, 1b" sub-rows, collapsed to the first one plus "•N".
 */
export function CardView({
  tone,
  label,
  text,
  editor,
  placeholder = "Type the argument…",
  points,
  expanded,
  onToggleExpand,
  strong,
  struck,
  plates,
  tags,
  selected,
  editing,
  speech,
  partner,
  tools,
  responding,
  meta,
  hint,
  className,
  style,
  ...rest
}: CardViewProps) {
  const cls = [
    "card",
    tone !== "ours" && `card--${tone}`,
    selected && "card--selected",
    editing && "card--editing",
    !editing && partner && "card--partner",
    struck && "card--struck",
    speech && "card--speech",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const anyPointEditing = points.some((p) => p.editor);
  const showAll = expanded || anyPointEditing;
  const visible = showAll ? points : points.slice(0, 1);
  const more = points.length > 1;
  const answering = !!responding && responding.length > 0;
  const titleEl = editor ? (
    <div className={`card__title${answering ? " card__title--block" : ""}`}>{editor}</div>
  ) : (
    <div className={`card__title${text ? "" : " card__title--empty"}${answering ? " card__title--block" : ""}`} data-testid="card-text">
      {text || placeholder}
    </div>
  );
  const st: CSSProperties = partner ? { ...style, ["--partner-color" as string]: partner.color } : (style ?? {});
  return (
    <div className={cls} style={st} {...rest}>
      {partner && !editing && <span className="card__partner">{partner.name}</span>}
      {tools && (
        <div
          className="card__tools"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {tools}
        </div>
      )}
      <div className="card__head">
        <span className="card__badge" data-testid="card-label">
          {label}
        </span>
        {answering ? (
          <span className="card__resp" data-testid="card-responding">
            Responding to{" "}
            {responding!.map((r, i) => (
              <span key={`${r.label}-${i}`}>
                {i > 0 && ", "}
                <span className={`card__resp-id card__resp-id--${r.tone}`}>{r.label}</span>
              </span>
            ))}
          </span>
        ) : (
          titleEl
        )}
        {strong && (
          <span className="card__star" aria-label="Strong" data-testid="card-strong">
            ★
          </span>
        )}
      </div>
      {answering && titleEl}
      {visible.length > 0 && (
        <div className="card__points">
          {visible.map((p, i) => (
            <div
              key={p.id}
              className={`card__point${p.selected ? " card__point--selected" : ""}`}
              data-point-id={p.id}
              data-testid="card-point"
              onPointerDown={p.editor ? undefined : p.onPointerDown}
            >
              <span className="card__point-id">{p.label}</span>
              {p.editor ? (
                <div className="card__point-text">{p.editor}</div>
              ) : (
                <span
                  className="card__point-text"
                  style={!showAll ? { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } : undefined}
                >
                  {p.text || "…"}
                </span>
              )}
              {i === 0 && more && !anyPointEditing && (
                <button
                  type="button"
                  className="card__more"
                  data-testid="card-more"
                  data-tip={expanded ? "Collapse points" : "Show all points"}
                  data-key="E"
                  aria-expanded={expanded}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleExpand?.();
                  }}
                >
                  •{points.length}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {((plates && plates.length > 0) || tags) && (
        <div className="card__foot">
          {plates?.map((p) => (
            <span
              key={p.text}
              className={`plate${p.tone === "red" ? " plate--red" : ""}${p.tone === "mono" ? " plate--mono" : ""}`}
              data-testid={p.testId}
            >
              {p.text}
            </span>
          ))}
          {tags}
        </div>
      )}
      {meta && (
        <div className="card__meta" data-testid="card-meta">
          {meta}
        </div>
      )}
      {hint}
    </div>
  );
}
