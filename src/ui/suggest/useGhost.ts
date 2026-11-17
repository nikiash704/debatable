/**
 * Ghost text for one YTextEditor: asks /api/suggest after a typing pause and keeps the gray
 * continuation in sync with what the user types. The decisions live in ./rules (pure, tested);
 * this hook only wires them to the textarea, timers and the request.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { SUGGEST_CONFIG } from "../../config/suggest";
import type { SuggestInput } from "../../shared/suggest";
import { getDeviceId } from "../../sync/storage";
import { cachedSuggestion, requestSuggestion } from "./client";
import { caretAtEnd, ghostFor, isAcceptKey, isDismissKey, shouldSuggest, trimBefore } from "./rules";

/** What the mirror draws: the field's text (transparent) and then the gray rest of the sentence. */
export interface GhostView {
  text: string;
  ghost: string;
}

interface Options {
  ref: RefObject<HTMLTextAreaElement | null>;
  composing: RefObject<boolean>;
  suggest?: () => SuggestInput | null;
  /** Pushes the textarea's value into the Y.Text (the editor's normal typing path). */
  commit: () => void;
}

export function useGhost({ ref, composing, suggest, commit }: Options) {
  const [view, setView] = useState<GhostView | null>(null);
  const suggestRef = useRef(suggest);
  suggestRef.current = suggest;
  const commitRef = useRef(commit);
  commitRef.current = commit;
  /** The text a continuation was made for, and the continuation. */
  const source = useRef<{ base: string; full: string } | null>(null);
  const shown = useRef<GhostView | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<AbortController | null>(null);

  const ready = () => {
    const el = ref.current;
    return !!el && document.activeElement === el && !composing.current && caretAtEnd(el.value, el.selectionStart, el.selectionEnd);
  };

  const show = (v: GhostView | null) => {
    if (shown.current?.text === v?.text && shown.current?.ghost === v?.ghost) return;
    shown.current = v;
    setView(v);
  };

  const abort = () => {
    inflight.current?.abort();
    inflight.current = null;
  };

  const stopTimer = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };

  const clear = useCallback(() => {
    abort();
    stopTimer();
    source.current = null;
    show(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Shows `full` as the continuation of `base` if the field still fits it. */
  const apply = (base: string, full: string) => {
    const el = ref.current;
    if (!el || !full || !ready()) return;
    const rest = ghostFor(base, full, el.value);
    if (!rest) return;
    source.current = { base, full };
    show({ text: el.value, ghost: rest });
  };

  const fire = () => {
    timer.current = null;
    const el = ref.current;
    if (!el || !ready() || !shouldSuggest(el.value)) return;
    const input = suggestRef.current?.();
    if (!input) return;
    const text = el.value;
    const req = { ...input, device: getDeviceId(), before: trimBefore(text) };
    const cached = cachedSuggestion(req);
    if (cached !== undefined) {
      apply(text, cached);
      return;
    }
    abort();
    const ctrl = new AbortController();
    inflight.current = ctrl;
    void requestSuggestion(req, ctrl.signal).then((full) => {
      if (inflight.current !== ctrl || ctrl.signal.aborted) return;
      inflight.current = null;
      // the text changed while we waited (a remote edit would have aborted us; this is a safety net)
      if (!ref.current?.value.startsWith(text)) return;
      apply(text, full);
    });
  };

  const schedule = () => {
    stopTimer();
    if (!suggestRef.current) return;
    timer.current = setTimeout(fire, SUGGEST_CONFIG.debounceMs);
  };

  /** After every local edit (already pushed to the Y.Text). */
  const onInput = () => {
    const el = ref.current;
    if (!el || composing.current) return;
    abort();
    const src = source.current;
    if (src && caretAtEnd(el.value, el.selectionStart, el.selectionEnd)) {
      const rest = ghostFor(src.base, src.full, el.value);
      if (rest) {
        stopTimer();
        show({ text: el.value, ghost: rest });
        return;
      }
    }
    source.current = null;
    show(null);
    schedule();
  };

  /** Inserts the ghost like typed text: one Y transaction (one undo step), caret at the end. */
  const accept = () => {
    const el = ref.current;
    const v = shown.current;
    if (!el || !v) return;
    clear();
    const value = el.value + v.ghost;
    el.value = value;
    el.setSelectionRange(value.length, value.length);
    commitRef.current();
  };

  /** Returns true when the key was used to accept the ghost (and must not reach onKeyDown). */
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const el = ref.current;
    if (shown.current && el && isAcceptKey({ key: e.key, shiftKey: e.shiftKey, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, isComposing: e.nativeEvent.isComposing || composing.current }) && caretAtEnd(el.value, el.selectionStart, el.selectionEnd)) {
      e.preventDefault();
      accept();
      return true;
    }
    if (isDismissKey(e)) clear();
    return false;
  };

  /** Caret moved: the ghost only lives at the end of the text. */
  const onSelection = () => {
    if ((shown.current || timer.current !== null || inflight.current) && !ready()) clear();
  };

  /** A tap or click on the gray text accepts it (tablets have no → key on screen). */
  const onGhostPointerDown = (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const el = ref.current;
    if (el && document.activeElement !== el) el.focus({ preventScroll: true });
    accept();
  };

  useEffect(() => () => {
    inflight.current?.abort();
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  const handlers = useMemo(
    () => ({ clear, onInput, onKeyDown, onSelection, onGhostPointerDown }),
    // the handlers only read refs, so one set per editor is enough
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  return { view, ...handlers };
}
