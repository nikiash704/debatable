import { useEffect, useState } from "react";

/**
 * One global tooltip for every element with `data-tip` (label) and optional `data-key` (hotkey).
 * Spec 02: every button shows its hotkey on hover.
 */
export function TooltipHost() {
  const [tip, setTip] = useState<{ label: string; keys: string | null; x: number; y: number; below: boolean } | null>(null);

  useEffect(() => {
    let current: HTMLElement | null = null;
    const show = (el: HTMLElement) => {
      const label = el.dataset.tip;
      if (!label) return;
      const r = el.getBoundingClientRect();
      const below = r.top < 60;
      setTip({
        label,
        keys: el.dataset.key ?? null,
        x: Math.min(Math.max(r.left + r.width / 2, 80), window.innerWidth - 80),
        y: below ? r.bottom + 6 : r.top - 6,
        below,
      });
    };
    const onOver = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const el = (e.target as Element | null)?.closest?.("[data-tip]") as HTMLElement | null;
      if (el === current) return;
      current = el;
      if (el) show(el);
      else setTip(null);
    };
    const hide = () => {
      current = null;
      setTip(null);
    };
    const onFocus = (e: FocusEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-tip]") as HTMLElement | null;
      if (el && el.matches(":focus-visible")) {
        current = el;
        show(el);
      }
    };
    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", hide);
    window.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", hide);
      window.removeEventListener("scroll", hide, true);
    };
  }, []);

  if (!tip) return null;
  return (
    <div
      className="tooltip"
      role="tooltip"
      style={{
        left: tip.x,
        top: tip.y,
        transform: tip.below ? "translate(-50%, 0)" : "translate(-50%, -100%)",
      }}
    >
      <span>{tip.label}</span>
      {tip.keys && <kbd>{tip.keys}</kbd>}
    </div>
  );
}

/** Props that give an element a tooltip with an optional hotkey. */
export function tip(label: string, keys?: string) {
  return { "data-tip": label, "data-key": keys, "aria-label": label } as Record<string, string | undefined>;
}
