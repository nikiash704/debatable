import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from "react";
import * as Y from "yjs";
import { LOCAL } from "../sync/doc";
import type { SuggestInput } from "../shared/suggest";
import { useGhost } from "./suggest/useGhost";

export interface YTextEditorProps {
  ytext: Y.Text;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  /** Where to put the caret on focus. */
  caret?: "end" | "start" | "all";
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onBlur?: () => void;
  onFocus?: () => void;
  /** Undo/redo for the whole room (Cmd/Ctrl+Z inside the editor). */
  onUndo?: () => void;
  onRedo?: () => void;
  testId?: string;
  ariaLabel?: string;
  rows?: number;
  /** AI ghost-text suggestions: returns what this field sends to /api/suggest (null = no suggestions). */
  suggest?: () => SuggestInput | null;
}

/**
 * A textarea bound to a Y.Text: local typing is applied as a character diff, remote changes are
 * merged in while keeping the caret in place (relative positions). Two people can type in the same
 * card at once and both texts survive.
 *
 * With `suggest`, a typing pause at the end of a sentence shows an AI continuation as gray "ghost"
 * text after the caret (plan: docs/plans/ai-suggestions.md). The ghost is drawn by a mirror layer
 * over the textarea that is absolutely positioned, so the textarea's size (autosize) never sees it;
 * → at the end, or a tap on the gray text, accepts it through the normal typing path.
 */
export function YTextEditor({
  ytext,
  placeholder,
  className,
  autoFocus,
  caret = "end",
  onKeyDown,
  onBlur,
  onFocus,
  onUndo,
  onRedo,
  testId,
  ariaLabel,
  rows = 1,
  suggest,
}: YTextEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const rel = useRef<{ start: Y.RelativePosition; end: Y.RelativePosition } | null>(null);

  const autosize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  };

  const rememberSelection = () => {
    const el = ref.current;
    if (!el) return;
    // assoc -1: the caret sticks to the character on its left, so when two people type at the
    // same spot each keeps a contiguous run instead of interleaving letters.
    rel.current = {
      start: Y.createRelativePositionFromTypeIndex(ytext, el.selectionStart, -1),
      end: Y.createRelativePositionFromTypeIndex(ytext, el.selectionEnd, -1),
    };
  };

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.value = ytext.toString();
    autosize();
    if (autoFocus) {
      el.focus({ preventScroll: false });
      const n = el.value.length;
      if (caret === "all") el.setSelectionRange(0, n);
      else if (caret === "start") el.setSelectionRange(0, 0);
      else el.setSelectionRange(n, n);
    }
    rememberSelection();
    ghost.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ytext]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = (_e: Y.YTextEvent, tr: Y.Transaction) => {
      // our own keystrokes are already in the textarea
      if (tr.origin === LOCAL && tr.local && el.value === ytext.toString()) return;
      // someone else changed this text (or an undo did): the suggestion no longer fits
      ghost.clear();
      const doc = ytext.doc;
      const focused = document.activeElement === el;
      let start = 0;
      let end = 0;
      if (focused && rel.current && doc) {
        start = Y.createAbsolutePositionFromRelativePosition(rel.current.start, doc)?.index ?? 0;
        end = Y.createAbsolutePositionFromRelativePosition(rel.current.end, doc)?.index ?? start;
      }
      el.value = ytext.toString();
      autosize();
      if (focused) el.setSelectionRange(start, end);
    };
    ytext.observe(observer);
    const onSel = () => {
      if (document.activeElement === el) rememberSelection();
      ghost.onSelection();
    };
    document.addEventListener("selectionchange", onSel);
    return () => {
      ytext.unobserve(observer);
      document.removeEventListener("selectionchange", onSel);
    };
  }, [ytext]);

  const pushDiff = () => {
    const el = ref.current;
    if (!el || composing.current) return;
    const next = el.value;
    const prev = ytext.toString();
    if (next === prev) return;
    let a = 0;
    while (a < prev.length && a < next.length && prev[a] === next[a]) a++;
    let b = 0;
    while (b < prev.length - a && b < next.length - a && prev[prev.length - 1 - b] === next[next.length - 1 - b]) b++;
    const doc = ytext.doc;
    const run = () => {
      if (prev.length - a - b > 0) ytext.delete(a, prev.length - a - b);
      const ins = next.slice(a, next.length - b);
      if (ins) ytext.insert(a, ins);
    };
    if (doc) doc.transact(run, LOCAL);
    else run();
    autosize();
    rememberSelection();
  };

  const ghost = useGhost({ ref, composing, suggest, commit: pushDiff });
  const view = ghost.view;

  // The wrapper is a plain block (no box of its own), so the page lays out exactly as with a bare
  // textarea; it only becomes a positioning context while a ghost is shown.
  return (
    <div className={view ? "ed-wrap ed-wrap--ghost" : "ed-wrap"}>
      <textarea
        ref={ref}
        className={`ed${className ? ` ${className}` : ""}`}
        rows={rows}
        placeholder={placeholder}
        spellCheck
        data-testid={testId}
        aria-label={ariaLabel}
        onInput={() => {
          pushDiff();
          ghost.onInput();
        }}
        onCompositionStart={() => {
          composing.current = true;
          ghost.clear();
        }}
        onCompositionEnd={() => {
          composing.current = false;
          pushDiff();
          ghost.onInput();
        }}
        onKeyDown={(e) => {
          const mod = e.metaKey || e.ctrlKey;
          if (mod && !e.altKey && e.key.toLowerCase() === "z") {
            e.preventDefault();
            if (e.shiftKey) onRedo?.();
            else onUndo?.();
            return;
          }
          if (mod && !e.altKey && e.key.toLowerCase() === "y") {
            e.preventDefault();
            onRedo?.();
            return;
          }
          if (ghost.onKeyDown(e)) return;
          onKeyDown?.(e);
        }}
        onBlur={() => {
          ghost.clear();
          onBlur?.();
        }}
        onFocus={onFocus}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      />
      {view && (
        <div className="ed-ghost" aria-hidden="true">
          <span className="ed-ghost__text">{view.text}</span>
          <span
            className="ed-ghost__rest"
            data-testid="ghost"
            onPointerDown={ghost.onGhostPointerDown}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {view.ghost}
          </span>
        </div>
      )}
    </div>
  );
}
