import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import type { LinkVM } from "../engine";
import type { Controller } from "./controller";

/** Which card the pointer is over (cards report it; the arrow layer highlights that card's links). */
let hovered: string | null = null;
const listeners = new Set<() => void>();
export const hoverStore = {
  get: () => hovered,
  set(id: string | null) {
    if (id === hovered) return;
    hovered = id;
    listeners.forEach((l) => l());
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

const key = (l: { from: string; to: string }) => `${l.from}>${l.to}`;

/** Position of an element inside the grid, ignoring transforms (FLIP animations). */
function boxIn(el: HTMLElement, grid: HTMLElement) {
  let x = 0;
  let y = 0;
  let e: HTMLElement | null = el;
  while (e && e !== grid) {
    x += e.offsetLeft;
    y += e.offsetTop;
    e = e.offsetParent as HTMLElement | null;
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}

/**
 * Clash lines (D1 / Clash arrow): one straight thin line per link, from a dot on the answer card to an
 * arrowhead on the target; the colour follows the answer card's status. Drawn imperatively in one
 * requestAnimationFrame pass, re-run by a ResizeObserver on the grid and every card (typing, points,
 * remote edits) and after every board change, so 60 cards stay smooth on a tablet.
 */
export function ArrowLayer({ c, gridRef }: { c: Controller; gridRef: RefObject<HTMLDivElement | null> }) {
  const links = c.board.links;
  const svgRef = useRef<SVGSVGElement>(null);
  const xRef = useRef<HTMLButtonElement>(null);
  const mids = useRef(new Map<string, { x: number; y: number }>());
  const [hoverLink, setHoverLink] = useState<string | null>(null);
  const hoverCard = useSyncExternalStore(hoverStore.subscribe, hoverStore.get);
  const leaveTimer = useRef<number | undefined>(undefined);
  const frame = useRef(0);

  const selectedCard = c.selectedCardId;
  const selectedLink = c.ui.link ? key(c.ui.link) : null;
  const shownX = hoverLink ?? selectedLink;
  const shownLink = shownX ? links.find((l) => key(l) === shownX) ?? null : null;
  const active = new Set<string>();
  for (const l of links) {
    const k = key(l);
    if (k === hoverLink || k === selectedLink || l.from === hoverCard || l.to === hoverCard || l.from === selectedCard || l.to === selectedCard) active.add(k);
  }

  const draw = () => {
    frame.current = 0;
    const grid = gridRef.current;
    const svg = svgRef.current;
    if (!grid || !svg) return;
    svg.setAttribute("width", String(grid.scrollWidth));
    svg.setAttribute("height", String(grid.scrollHeight));
    const cards = new Map<string, HTMLElement>();
    grid.querySelectorAll<HTMLElement>('[data-testid="card"]').forEach((el) => cards.set(el.dataset.cardId!, el));
    const anchorY = (el: HTMLElement, b: { y: number }) => {
      const badge = el.querySelector<HTMLElement>(".card__badge");
      return b.y + (badge ? badge.offsetTop + badge.offsetHeight / 2 : 20);
    };
    svg.querySelectorAll<SVGGElement>("g[data-from]").forEach((g) => {
      const a = cards.get(g.dataset.from!);
      const t = cards.get(g.dataset.to!);
      if (!a || !t) {
        g.style.display = "none";
        return;
      }
      g.style.display = "";
      const ba = boxIn(a, grid);
      const bt = boxIn(t, grid);
      // the answer is to the right of its target (later lane); fall back to facing edges otherwise
      const leftward = ba.x >= bt.x + bt.w || ba.x > bt.x;
      const x1 = leftward ? ba.x : ba.x + ba.w;
      const x2 = leftward ? bt.x + bt.w : bt.x;
      const y1 = anchorY(a, ba);
      const y2 = anchorY(t, bt);
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const [line, hit, head, dot] = [".arrow__line", ".arrow__hit", ".arrow__head", ".arrow__dot"].map((s) => g.querySelector(s)!);
      for (const el of [line, hit]) {
        el.setAttribute("x1", String(x1));
        el.setAttribute("y1", String(y1));
        el.setAttribute("x2", String(x2 - ux * 1.5));
        el.setAttribute("y2", String(y2 - uy * 1.5));
      }
      // keep the hit area off the cards themselves
      hit.setAttribute("x1", String(x1 + ux * 6));
      hit.setAttribute("y1", String(y1 + uy * 6));
      hit.setAttribute("x2", String(x2 - ux * 6));
      hit.setAttribute("y2", String(y2 - uy * 6));
      const px = -uy;
      const py = ux;
      head.setAttribute("points", `${x2 - ux * 5 + px * 4},${y2 - uy * 5 + py * 4} ${x2},${y2} ${x2 - ux * 5 - px * 4},${y2 - uy * 5 - py * 4}`);
      dot.setAttribute("cx", String(x1));
      dot.setAttribute("cy", String(y1));
      mids.current.set(`${g.dataset.from}>${g.dataset.to}`, { x: (x1 + x2) / 2, y: (y1 + y2) / 2 });
    });
    placeX();
  };

  const placeX = () => {
    const x = xRef.current;
    if (!x || !shownX) return;
    const m = mids.current.get(shownX);
    if (!m) return;
    x.style.left = `${m.x}px`;
    x.style.top = `${m.y}px`;
  };

  const schedule = () => {
    if (!frame.current) frame.current = requestAnimationFrame(draw);
  };

  // every render (board change, typing, selection): one pass on the next frame
  useLayoutEffect(() => {
    schedule();
  });

  // card sizes change without a React render of the layer (text wrapping, fonts, points expanding)
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(schedule);
    ro.observe(grid);
    grid.querySelectorAll('[data-testid="card"]').forEach((el) => ro.observe(el));
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.board, gridRef]);

  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    },
    [],
  );

  // highlight both ends of the active links (classes set directly: no board re-render on hover)
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const ends = new Set<string>();
    for (const l of links) {
      const k = key(l);
      if (k === hoverLink || k === selectedLink || l.from === hoverCard || l.to === hoverCard) ends.add(l.from).add(l.to);
    }
    grid.querySelectorAll(".card--hl").forEach((el) => {
      if (!ends.has((el as HTMLElement).dataset.cardId!)) el.classList.remove("card--hl");
    });
    ends.forEach((id) => grid.querySelector(`[data-card-id="${id}"]`)?.classList.add("card--hl"));
  });

  const enter = (k: string) => {
    window.clearTimeout(leaveTimer.current);
    setHoverLink(k);
  };
  const leave = () => {
    window.clearTimeout(leaveTimer.current);
    leaveTimer.current = window.setTimeout(() => setHoverLink(null), 250);
  };

  const label = (id: string) => c.board.cards.get(id)?.label ?? "?";

  return (
    <>
      <svg ref={svgRef} className="arrows" aria-hidden="true" data-testid="arrows">
        {links.map((l: LinkVM) => {
          const k = key(l);
          const on = active.has(k);
          return (
            <g
              key={k}
              data-from={l.from}
              data-to={l.to}
              data-testid={`arrow-${label(l.from)}-${label(l.to)}`}
              className={`arrow arrow--${l.tone}${on ? " arrow--on" : ""}`}
            >
              <line className="arrow__line" />
              <polyline className="arrow__head" />
              <circle className="arrow__dot" r={3} />
              <line
                className="arrow__hit"
                data-testid={`arrow-hit-${label(l.from)}-${label(l.to)}`}
                onPointerEnter={() => enter(k)}
                onPointerLeave={leave}
                onClick={(e) => {
                  e.stopPropagation();
                  c.selectLink(selectedLink === k ? null : { from: l.from, to: l.to });
                }}
              />
            </g>
          );
        })}
      </svg>
      {shownLink && (
        <button
          ref={(el) => {
            xRef.current = el;
            placeX();
          }}
          type="button"
          className="arrow-x"
          data-testid="unlink-x"
          data-tip={`Unlink ${label(shownLink.from)} → ${label(shownLink.to)}`}
          data-key="L · palette"
          aria-label={`Unlink ${label(shownLink.from)} from ${label(shownLink.to)}`}
          onPointerEnter={() => enter(key(shownLink))}
          onPointerLeave={leave}
          onClick={(e) => {
            e.stopPropagation();
            c.unlink(shownLink.from, shownLink.to);
            setHoverLink(null);
            c.selectLink(null);
          }}
        >
          ×
        </button>
      )}
    </>
  );
}
