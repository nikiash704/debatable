import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

export type CardTone = "ours" | "neutral" | "red";

export interface CardPointView {
  id: string;
  label: string;
  text: string;
  editor?: ReactNode;
  selected?: boolean;
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
}

/**
 * Argument card (Figma 2:86). Tones: ours (green border), neutral ("Answered"), red ("Unanswered",
 * used in stage 1 only for "new — don't say" cards in our rebuttal).
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
        {editor ? (
          <div className="card__title">{editor}</div>
        ) : (
          <div className={`card__title${text ? "" : " card__title--empty"}`} data-testid="card-text">
            {text || placeholder}
          </div>
        )}
        {strong && (
          <span className="card__star" aria-label="Strong" data-testid="card-strong">
            ★
          </span>
        )}
      </div>
      {visible.length > 0 && (
        <div className="card__points">
          {visible.map((p, i) => (
            <div
              key={p.id}
              className={`card__point${p.selected ? " card__point--selected" : ""}`}
              data-point-id={p.id}
              data-testid="card-point"
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
    </div>
  );
}
