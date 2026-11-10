import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  applyOps,
  cardDrag,
  moveCardOps,
  movePointOps,
  moveThesisOps,
  pointDrag,
  thesisDrag,
  type CardSlot,
  type Op,
  type PointSlot,
  type ThesisSlot,
} from "../engine";
import type { RoomSession } from "../sync/session";
import type { Controller } from "./controller";

/** Drag and drop on the board. Cards, thesis headers and points report pointer-downs here. */
export interface DragApi {
  /** Card being dragged (shown as the landing placeholder). */
  draggingId: string | null;
  onCardPointerDown(e: ReactPointerEvent, cardId: string): void;
  onThesisPointerDown(e: ReactPointerEvent, thesisId: string, speech: string): void;
  onPointPointerDown(e: ReactPointerEvent, cardId: string, pointId: string): void;
  /** True once after a drag ended: the click that follows must not select / edit. */
  consumeClick(): boolean;
}

type Kind =
  | { kind: "card"; cardId: string }
  | { kind: "thesis"; thesisId: string; speech: string }
  | { kind: "point"; cardId: string; pointId: string };

interface Target {
  /** Content y of the slot (board coordinates, scroll-independent). */
  y: number;
  ops: Op[];
  key: string;
}

interface Active {
  what: Kind;
  targets: Target[];
  current: number;
  chosen: number;
  /** Linked answers: allowed vertical band and lane (content coords); outside = snap back. */
  band: { top: number; bottom: number; left: number; right: number } | null;
  ghost: HTMLElement;
  dx: number;
  dy: number;
  outside: boolean;
  /** Where the drag began: edge auto-scroll starts only once the pointer has moved away from it. */
  sx: number;
  sy: number;
  armed: boolean;
}

interface Pending {
  what: Kind;
  el: HTMLElement;
  /** Element the finger touched: touch events keep coming to it even after the preview removes it. */
  target: EventTarget | null;
  x: number;
  y: number;
  pointerId: number;
  touch: boolean;
  timer: number | undefined;
}

const MOUSE_SLOP = 5;
const TOUCH_SLOP = 8;
const LONG_PRESS = 380;

/**
 * Pointer drag (mouse: press and move; touch: long press, then drag — a quick swipe still scrolls).
 * While dragging, the controller shows a preview of the drop (other cards step aside, FLIP-animated by
 * the board) with the real labels; the drop applies the same engine move ops as Alt+↑/↓.
 */
export function useBoardDrag(c: Controller, session: RoomSession, toast: (m: string) => void): DragApi {
  const cRef = useRef(c);
  cRef.current = c;
  const pending = useRef<Pending | null>(null);
  const active = useRef<Active | null>(null);
  const suppress = useRef(false);
  const scrollTimer = useRef(0);
  const pointer = useRef({ x: 0, y: 0 });
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const board = () => document.querySelector<HTMLElement>('[data-testid="board"]');
  const contentY = (clientY: number) => {
    const b = board();
    if (!b) return clientY;
    return clientY - b.getBoundingClientRect().top + b.scrollTop;
  };
  const contentX = (clientX: number) => {
    const b = board();
    if (!b) return clientX;
    return clientX - b.getBoundingClientRect().left + b.scrollLeft;
  };

  const cleanupListeners = useRef<() => void>(() => {});

  const finish = useCallback(
    (drop: boolean) => {
      const a = active.current;
      active.current = null;
      pending.current = null;
      cleanupListeners.current();
      cancelAnimationFrame(scrollTimer.current);
      if (!a) return;
      a.ghost.remove();
      document.body.classList.remove("dragging");
      const cc = cRef.current;
      cc.setPreview(null);
      setDraggingId(null);
      suppress.current = true;
      window.setTimeout(() => (suppress.current = false), 0);
      if (!drop) return;
      if (a.outside) {
        toast("Use L to change the target");
        return;
      }
      if (a.chosen !== a.current && a.targets[a.chosen]) session.apply(a.targets[a.chosen].ops);
    },
    [session, toast],
  );

  const pick = useCallback(() => {
    const a = active.current;
    if (!a) return;
    const y = contentY(pointer.current.y);
    const x = contentX(pointer.current.x);
    if (a.band) {
      const out = y < a.band.top - 24 || y > a.band.bottom + 24 || x < a.band.left - 60 || x > a.band.right + 60;
      a.ghost.classList.toggle("drag-ghost--no", out);
      if (out !== a.outside) {
        a.outside = out;
        if (out) {
          a.chosen = a.current;
          cRef.current.setPreview(null);
        }
      }
      if (out) return;
    }
    let best = a.current;
    let dist = Infinity;
    a.targets.forEach((t, i) => {
      const d = Math.abs(t.y - y);
      if (d < dist) {
        dist = d;
        best = i;
      }
    });
    if (best === a.chosen) return;
    a.chosen = best;
    const cc = cRef.current;
    cc.setPreview(best === a.current ? null : applyOps(cc.flow, a.targets[best].ops));
  }, []);

  const autoScroll = useCallback(() => {
    const b = board();
    const a = active.current;
    if (!b || !a) return;
    const r = b.getBoundingClientRect();
    const { x, y } = pointer.current;
    if (!a.armed) a.armed = Math.hypot(x - a.sx, y - a.sy) > 10;
    if (!a.armed) {
      scrollTimer.current = requestAnimationFrame(autoScroll);
      return;
    }
    const edge = 48;
    const vy = y < r.top + edge ? -12 : y > r.bottom - edge ? 12 : 0;
    const vx = x < r.left + edge ? -12 : x > r.right - edge ? 12 : 0;
    if (vx || vy) {
      b.scrollBy(vx, vy);
      pick();
    }
    scrollTimer.current = requestAnimationFrame(autoScroll);
  }, [pick]);

  /** Slots of the drag with their content y, measured once at the start (stable while the preview reflows). */
  const begin = useCallback(
    (p: Pending) => {
      const cc = cRef.current;
      const state = cc.flow;
      const layout = cc.board.layout;
      const rectY = (el: Element | null, edge: "top" | "bottom") => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return contentY(edge === "top" ? r.top : r.bottom);
      };
      const cardEl = (id: string) => document.querySelector(`[data-testid="card"][data-card-id="${id}"]`);
      let targets: Target[] = [];
      let current = 0;
      let band: Active["band"] = null;
      const w = p.what;
      if (w.kind === "card") {
        const d = cardDrag(cc.f, state, layout, w.cardId);
        if (!d) return;
        const laneEl = document.querySelector(`[data-lane="${d.speech}"]`);
        targets = d.slots.map((s: CardSlot) => {
          let y: number | null = null;
          const an = s.anchor;
          if (an && "cardId" in an) y = rectY(cardEl(an.cardId), an.edge);
          else if (an && "thesisId" in an) y = rectY(laneEl?.querySelector(`[data-testid="thesis"][data-thesis-id="${an.thesisId}"]`) ?? null, "bottom");
          return { y: y ?? rectY(p.el, "top") ?? 0, ops: moveCardOps(state, w.cardId, s), key: s.key };
        });
        current = d.current;
        if (d.mode === "row") {
          const stack = layout.rows[d.row]?.cells.get(d.speech) ?? [];
          const rects = stack.map((id) => cardEl(id)?.getBoundingClientRect()).filter(Boolean) as DOMRect[];
          const lr = laneEl?.getBoundingClientRect();
          if (rects.length && lr) {
            band = {
              top: contentY(Math.min(...rects.map((r) => r.top))),
              bottom: contentY(Math.max(...rects.map((r) => r.bottom))),
              left: contentX(lr.left),
              right: contentX(lr.right),
            };
          }
        }
      } else if (w.kind === "thesis") {
        const d = thesisDrag(state, w.thesisId);
        if (!d) return;
        const laneEl = document.querySelector(`[data-lane="${w.speech}"]`);
        const head = (id: string) => laneEl?.querySelector(`[data-testid="thesis"][data-thesis-id="${id}"]`) ?? null;
        const laneBottom = () => {
          const cards = laneEl?.querySelectorAll('[data-testid="card"]');
          return cards && cards.length ? rectY(cards[cards.length - 1], "bottom") : null;
        };
        targets = d.slots.map((s: ThesisSlot) => ({
          y: (s.before ? rectY(head(s.before), "top") : laneBottom()) ?? rectY(p.el, "top") ?? 0,
          ops: moveThesisOps(w.thesisId, s),
          key: s.key,
        }));
        current = d.current;
      } else {
        const d = pointDrag(state, layout, w.cardId, w.pointId);
        if (!d) return;
        targets = d.slots.map((s: PointSlot) => {
          const an = s.anchor;
          const y = "pointId" in an ? rectY(document.querySelector(`[data-point-id="${an.pointId}"]`), "top") : (rectY(cardEl(an.cardId), "bottom") ?? 0) - 8;
          return { y: y ?? 0, ops: movePointOps(state, w.cardId, w.pointId, s), key: s.key };
        });
        current = d.current;
      }
      const r = p.el.getBoundingClientRect();
      const ghost = p.el.cloneNode(true) as HTMLElement;
      ghost.classList.add("drag-ghost");
      ghost.removeAttribute("data-testid");
      ghost.removeAttribute("data-card-id");
      ghost.querySelectorAll("[data-testid]").forEach((x) => x.removeAttribute("data-testid"));
      Object.assign(ghost.style, { position: "fixed", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, margin: "0", zIndex: "80", pointerEvents: "none" });
      document.body.appendChild(ghost);
      document.body.classList.add("dragging");
      // The preview re-renders the dragged card elsewhere. Chrome cancels a touch pointer whose target
      // leaves the DOM, but Touch Events keep reaching that (detached) target: follow the finger there.
      if (p.touch && p.target) {
        const t = p.target;
        const tm = (ev: Event) => {
          const te = ev as TouchEvent;
          if (te.cancelable) te.preventDefault();
          const f = te.touches[0];
          if (f) moveTo(f.clientX, f.clientY);
        };
        const te = (ev: Event) => finish(ev.type === "touchend");
        t.addEventListener("touchmove", tm, { passive: false });
        t.addEventListener("touchend", te);
        t.addEventListener("touchcancel", te);
        const prev = cleanupListeners.current;
        cleanupListeners.current = () => {
          prev();
          t.removeEventListener("touchmove", tm);
          t.removeEventListener("touchend", te);
          t.removeEventListener("touchcancel", te);
        };
      }
      active.current = { what: w, targets, current, chosen: current, band, ghost, dx: p.x - r.left, dy: p.y - r.top, outside: false, sx: p.x, sy: p.y, armed: false };
      if (w.kind === "card") setDraggingId(w.cardId);
      scrollTimer.current = requestAnimationFrame(autoScroll);
    },
    [autoScroll],
  );

  /** Follows the pointer once a drag is on: the ghost moves, the nearest slot is previewed. */
  function moveTo(x: number, y: number) {
    const g = active.current;
    if (!g) return;
    pointer.current = { x, y };
    g.ghost.style.left = `${x - g.dx}px`;
    g.ghost.style.top = `${y - g.dy}px`;
    pickRef.current();
  }
  const pickRef = useRef(() => {});

  const onMove = useCallback(
    (e: PointerEvent) => {
      const p = pending.current;
      if (!p || e.pointerId !== p.pointerId) return;
      if (active.current && p.touch) return; // touch drags follow touch events (see begin)
      pointer.current = { x: e.clientX, y: e.clientY };
      const a = active.current;
      if (!a) {
        const moved = Math.hypot(e.clientX - p.x, e.clientY - p.y);
        if (p.touch) {
          if (moved > TOUCH_SLOP) {
            // a swipe before the long press: it is a scroll, not a drag
            window.clearTimeout(p.timer);
            pending.current = null;
            cleanupListeners.current();
          }
          return;
        }
        if (moved < MOUSE_SLOP) return;
        begin(p);
        if (!active.current) return;
      }
      const g = active.current!;
      g.ghost.style.left = `${e.clientX - g.dx}px`;
      g.ghost.style.top = `${e.clientY - g.dy}px`;
      pick();
    },
    [begin, pick],
  );

  const onUp = useCallback(
    (e: PointerEvent) => {
      const p = pending.current;
      if (!p || e.pointerId !== p.pointerId) return;
      if (active.current && p.touch) return; // touchend ends a touch drag
      window.clearTimeout(p.timer);
      if (active.current) finish(true);
      else {
        pending.current = null;
        cleanupListeners.current();
      }
    },
    [finish],
  );

  const onCancel = useCallback(
    (e: PointerEvent) => {
      const p = pending.current;
      if (!p || e.pointerId !== p.pointerId) return;
      if (active.current && p.touch) return; // expected once the preview moves the touched card; touchend ends it
      window.clearTimeout(p.timer);
      if (active.current) finish(false);
      else {
        pending.current = null;
        cleanupListeners.current();
      }
    },
    [finish],
  );

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && active.current) {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      }
    },
    [finish],
  );

  /** While a touch drag is on, the page must not scroll under the finger. */
  const blockTouch = useCallback((e: TouchEvent) => {
    if (active.current && e.cancelable) e.preventDefault();
  }, []);

  const start = useCallback(
    (e: ReactPointerEvent, what: Kind) => {
      const cc = cRef.current;
      if (pending.current || active.current) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const t = e.target as HTMLElement;
      if (t.closest("button, textarea, input, .card__tools, .popover")) return;
      if (cc.ui.pick) return;
      if (cc.ui.editing) {
        const sel = cc.ui.selection;
        const editingThis =
          (what.kind === "card" && ((sel?.kind === "card" && sel.id === what.cardId) || (sel?.kind === "point" && sel.cardId === what.cardId))) ||
          (what.kind === "thesis" && sel?.kind === "thesis" && sel.id === what.thesisId);
        if (editingThis) return;
      }
      const el = (e.currentTarget as HTMLElement) ?? t;
      const touch = e.pointerType !== "mouse";
      const p: Pending = { what, el, target: e.target, x: e.clientX, y: e.clientY, pointerId: e.pointerId, touch, timer: undefined };
      pending.current = p;
      pointer.current = { x: e.clientX, y: e.clientY };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKey, true);
      cleanupListeners.current = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("keydown", onKey, true);
      };
      if (touch) {
        p.timer = window.setTimeout(() => {
          if (pending.current !== p) return;
          begin(p);
          navigator.vibrate?.(10);
        }, LONG_PRESS);
      }
    },
    [begin, onMove, onUp, onCancel, onKey],
  );

  // Registered once and non-passive (a listener added after touchstart may not be able to cancel the
  // scroll); it only cancels while a drag is on, so normal scrolling is untouched.
  useEffect(() => {
    window.addEventListener("touchmove", blockTouch, { passive: false });
    return () => window.removeEventListener("touchmove", blockTouch);
  }, [blockTouch]);

  pickRef.current = pick;

  useEffect(() => () => finish(false), [finish]);

  return useMemo<DragApi>(
    () => ({
      draggingId,
      onCardPointerDown: (e, cardId) => start(e, { kind: "card", cardId }),
      onThesisPointerDown: (e, thesisId, speech) => start(e, { kind: "thesis", thesisId, speech }),
      onPointPointerDown: (e, cardId, pointId) => {
        e.stopPropagation();
        start(e, { kind: "point", cardId, pointId });
      },
      consumeClick: () => {
        if (!suppress.current) return false;
        suppress.current = false;
        return true;
      },
    }),
    [draggingId, start],
  );
}
