/**
 * Ghost-text decision logic (pure, no DOM): when to ask for a suggestion, what to send, and what
 * to show as the user keeps typing. Plan: docs/plans/ai-suggestions.md (3.1, 3.3, Phase 1c).
 */
import { SUGGEST_CONFIG } from "../../config/suggest";
import { SUGGEST_LIMITS, type SuggestRequest } from "../../shared/suggest";

/** The longest continuation the editor will show (the Worker caps it too). */
export const MAX_GHOST = 300;

/**
 * A word that ends in "." without ending the sentence: e.g. i.e. vs. cf. Mr. Dr. … and dotted
 * initials (U.S., U.K.). `head` is the text up to (not including) that dot.
 * "etc." and "no." are left out on purpose: they often do end a sentence.
 */
const ABBREVIATION = /(?:^|[\s(["'“‘«])(?:e\.g|i\.e|vs|cf|approx|incl|esp|mr|mrs|ms|dr|prof|fig|\p{L}(?:\.\p{L})+)$/iu;
const isAbbreviation = (head: string) => ABBREVIATION.test(head);

/** Text of the sentence being typed: after the last newline or sentence end (. ! ? … then a space). */
export function currentSentence(text: string): string {
  let start = 0;
  const re = /\n|[.!?…]+(?=\s)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[0] === "." && isAbbreviation(text.slice(0, m.index))) continue; // "vs. ", "e.g. "
    start = m.index + m[0].length;
  }
  return text.slice(start);
}

export function countWords(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

/** True when the text has just finished a sentence (ends in . ! ? …, maybe followed by quotes or spaces; not after "vs.", "e.g." …). */
export function endsSentence(text: string): boolean {
  const m = /([.!?…]+)["'”’)\]]*\s*$/.exec(text);
  if (!m) return false;
  return !(m[1] === "." && isAbbreviation(text.slice(0, m.index)));
}

/** Whether a typing pause at the end of `text` should ask for a continuation. */
export function shouldSuggest(text: string, minWords: number = SUGGEST_CONFIG.minWords): boolean {
  if (!text.trim() || endsSentence(text)) return false;
  return countWords(currentSentence(text)) >= minWords;
}

/** The last SUGGEST_LIMITS.before characters (never starting in the middle of a surrogate pair). */
export function trimBefore(text: string, limit: number = SUGGEST_LIMITS.before): string {
  if (text.length <= limit) return text;
  let s = text.slice(text.length - limit);
  const c = s.charCodeAt(0);
  if (c >= 0xdc00 && c <= 0xdfff) s = s.slice(1);
  return s;
}

/** Normalises a continuation from the server: one line, capped length; "" = nothing to show. */
export function cleanGhost(text: unknown): string {
  if (typeof text !== "string") return "";
  const line = text.split(/\r?\n/)[0] ?? "";
  const out = line.length > MAX_GHOST ? line.slice(0, MAX_GHOST) : line;
  return out.trim() ? out.replace(/\s+$/, "") : "";
}

/**
 * What is left of a ghost after the user typed on (type-through) or deleted back.
 * `base` is the text the continuation `full` was made for; `current` is the text now.
 * Returns the rest to show, or "" when the user typed something else (or typed it all).
 */
export function ghostFor(base: string, full: string, current: string): string {
  if (!full || !current.startsWith(base)) return "";
  const whole = base + full;
  if (current.length >= whole.length || !whole.startsWith(current)) return "";
  return whole.slice(current.length);
}

/** Collapsed caret at the very end of the text. */
export function caretAtEnd(value: string, selectionStart: number, selectionEnd: number): boolean {
  return selectionStart === selectionEnd && selectionEnd === value.length;
}

export interface KeyLike {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  isComposing?: boolean;
}

/** → with no modifiers accepts the ghost (only meaningful with the caret at the end). */
export function isAcceptKey(e: KeyLike): boolean {
  return e.key === "ArrowRight" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && !e.isComposing;
}

/** Keys that end the suggestion before doing what they always do. */
export function isDismissKey(e: KeyLike): boolean {
  return e.key === "Escape" || e.key === "Enter" || e.key === "Tab";
}

/** In-memory cache key: same room, field, context and text → same continuation. */
export function cacheKey(req: SuggestRequest): string {
  return [req.room, req.field, JSON.stringify(req.context), req.before].join("\u0000");
}
