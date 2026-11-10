import { useEffect, useMemo, useRef, useState } from "react";
import type { Controller } from "./controller";

export interface Command {
  id: string;
  label: string;
  hotkey?: string;
  group: string;
  run: () => void;
}

function useListKeys(count: number, onPick: (i: number) => void, onClose: () => void) {
  const [active, setActive] = useState(0);
  useEffect(() => setActive((a) => Math.min(a, Math.max(0, count - 1))), [count]);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(count - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (count > 0) onPick(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };
  return { active, setActive, onKeyDown };
}

/** Cmd/Ctrl+K: every action with its hotkey (spec 02). */
export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return commands;
    return commands.filter((c) => `${c.label} ${c.group}`.toLowerCase().includes(s));
  }, [commands, q]);
  const pick = (i: number) => {
    const cmd = list[i];
    if (!cmd) return;
    onClose();
    // run after the palette closes so focus/edit targets are not stolen by the overlay
    setTimeout(cmd.run, 0);
  };
  const { active, setActive, onKeyDown } = useListKeys(list.length, pick, onClose);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);
  let lastGroup = "";
  return (
    <div className="overlay" onPointerDown={onClose} data-testid="palette-overlay">
      <div className="panel palette" role="dialog" aria-label="Command palette" onPointerDown={(e) => e.stopPropagation()} data-testid="palette">
        <input
          className="palette__input"
          autoFocus
          placeholder="Type a command…"
          value={q}
          data-testid="palette-input"
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        <div className="palette__list" ref={listRef} role="listbox">
          {list.length === 0 && <div className="palette__empty">No matching command</div>}
          {list.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <div key={c.id}>
                {header && <div className="menu__label">{header}</div>}
                <button
                  type="button"
                  className="menu__item"
                  role="option"
                  aria-selected={i === active}
                  data-testid={`cmd-${c.id}`}
                  onPointerEnter={() => setActive(i)}
                  onClick={() => pick(i)}
                >
                  {c.label}
                  {c.hotkey && <span className="menu__key">{c.hotkey}</span>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Same as… / Contradicts…: pick the card it refers to. */
export function CardPicker({ c }: { c: Controller }) {
  const picker = c.ui.picker!;
  const [q, setQ] = useState("");
  const source = c.board.cards.get(picker.cardId);
  const existing = source?.card.tags.find((t) => t.type === picker.type)?.refCardId ?? null;
  const all = useMemo(
    () =>
      c.board.columns
        .flatMap((col) => col.order)
        .filter((vm) => vm.card.id !== picker.cardId),
    [c.board, picker.cardId],
  );
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? all.filter((vm) => `${vm.label} ${vm.card.text}`.toLowerCase().includes(s)) : all;
  }, [all, q]);
  const options = existing ? [null, ...list] : list;
  const pick = (i: number) => {
    const vm = options[i];
    c.pickRef(picker.cardId, picker.type, vm ? vm.card.id : null);
  };
  const { active, setActive, onKeyDown } = useListKeys(options.length, pick, c.closePicker);
  const title = picker.type === "same-as" ? "Same as…" : "Contradicts…";
  return (
    <div className="overlay" onPointerDown={c.closePicker}>
      <div className="panel palette" role="dialog" aria-label={title} onPointerDown={(e) => e.stopPropagation()} data-testid="card-picker">
        <input
          className="palette__input"
          autoFocus
          placeholder={`${source?.label ?? ""} · ${title} type a number or words`}
          value={q}
          data-testid="picker-input"
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        <div className="palette__list" role="listbox">
          {options.length === 0 && <div className="palette__empty">No cards</div>}
          {options.map((vm, i) => (
            <button
              key={vm ? vm.card.id : "remove"}
              type="button"
              className="menu__item"
              role="option"
              aria-selected={i === active}
              data-testid={vm ? `pick-${vm.label}` : "pick-remove"}
              onPointerEnter={() => setActive(i)}
              onClick={() => pick(i)}
            >
              {vm ? (
                <>
                  <span className="mono" style={{ fontSize: 11, minWidth: 40, color: "var(--c-text-tertiary)" }}>
                    {vm.label}
                  </span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{vm.card.text || "…"}</span>
                  {vm.card.id === existing && <span className="menu__key">current</span>}
                </>
              ) : (
                <>Remove {title.replace("…", "")}</>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
