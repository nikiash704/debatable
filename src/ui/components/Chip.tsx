import type { ReactNode } from "react";

export interface ChipProps {
  label: ReactNode;
  /** Alert = POO (orange); default = neutral response chip. */
  tone?: "default" | "alert";
  refLabel?: string;
  hotkey?: string;
  /** Show the hotkey inside the chip (menus) or only in its tooltip (chips on cards). */
  showKey?: boolean;
  onClick?: () => void;
  title?: string;
  testId?: string;
}

/** Response chip (Figma 2:10): Default and Alert tones. */
export function Chip({ label, tone = "default", refLabel, hotkey, showKey = true, onClick, title, testId }: ChipProps) {
  const cls = `chip${tone === "alert" ? " chip--alert" : ""}`;
  const content = (
    <>
      {label}
      {refLabel && <span className="chip__ref">{refLabel}</span>}
      {hotkey && showKey && <span className="chip__key">{hotkey}</span>}
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        className={cls}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        data-tip={title}
        data-key={hotkey}
        data-testid={testId}
      >
        {content}
      </button>
    );
  }
  return (
    <span className={cls} data-testid={testId}>
      {content}
    </span>
  );
}
