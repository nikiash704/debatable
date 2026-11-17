/**
 * Prompt builder and post-processing for AI sentence suggestions. Pure: used by the Worker
 * (worker/suggest.ts) and by the benchmark (scripts/bench-suggest.ts), so the benchmark tests
 * exactly what ships. Owner: the evaluation agent (docs/plans/ai-suggestions-bench.md).
 *
 * Convention between the prompt and `postProcess` ("echo the last word"):
 * the model answers with the note's LAST WORD (finished if it is cut off), then the rest of the
 * sentence. `postProcess` removes that echoed word, so the spacing comes out right on its own,
 * whether the user stopped mid-word ("unl" → "ocks scarce metals") or after a space
 * ("for " → "humanity"). A chat model cannot be trusted to emit a leading space; it can be trusted
 * to write whole words. Answers that ignore the convention are still handled (see `postProcess`).
 */
import { FORMATS } from "../config/formats";
import type { SuggestField, SuggestRequest } from "./suggest";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const FIELD_STYLE: Record<SuggestField, string> = {
  card: "argument card title",
  point: "supporting point under an argument card",
  thesis: "thesis title (groups several arguments)",
  motion: "the debate motion (e.g. THW ban zoos / THBT …)",
  "doc-thesis": "thesis title in a prep outline",
  "doc-card": "argument line in a prep outline",
  "doc-point": "supporting point in a prep outline",
};

const SYSTEM = [
  "You autocomplete a debater's notes (a parliamentary debate flow).",
  "Reply with one line: the note's last word (completed if it is cut off), then the words that finish the note's current sentence.",
  "Write like the nearby notes: terse, no filler, no final full stop unless they use one. Same language as the note. At most 12 words.",
  "Nothing else: no quotes, labels, explanations or options.",
].join("\n");

/** Two short examples teach the reply shape (mid-word, and after a space) better than more rules. */
const EXAMPLES: ChatMessage[] = [
  {
    role: "user",
    content: [
      "Motion: THW ban zoos",
      "Opposition's flow, our own LOC speech. Field: argument card title.",
      "Nearby notes: Zoos fund conservation | Breeding saves species",
      "Note: Kids learn empathy from se",
    ].join("\n"),
  },
  { role: "assistant", content: "seeing real animals" },
  {
    role: "user",
    content: [
      "Motion: THW ban zoos",
      "Government's flow, our own MG speech. Field: argument card title.",
      "Answers the opponent's note: Zoos fund conservation",
      "Note: Most of that money goes to ",
    ].join("\n"),
  },
  { role: "assistant", content: "to marketing, not habitats" },
];

/** "Opposition's flow, our own LOC speech" / "…, notes on the Government's PMC speech", from the format config. */
function whereLine(format: string, side: string, speech: string | undefined): string {
  const f = Object.hasOwn(FORMATS, format) ? FORMATS[format] : undefined;
  const sideLabel = (id: string) => f?.sides.find((s) => s.id === id)?.label ?? id;
  const ours = `${sideLabel(side)}'s flow`;
  if (!speech) return ours;
  const sp = f?.speeches.find((s) => s.label === speech || s.id === speech);
  if (!sp) return `${ours}, ${speech} column`;
  return sp.side === side ? `${ours}, our own ${speech} speech` : `${ours}, notes on the ${sideLabel(sp.side)}'s ${speech} speech`;
}

/** Builds the chat messages for one suggestion. */
export function buildMessages(req: Pick<SuggestRequest, "field" | "before" | "context">): ChatMessage[] {
  const c = req.context;
  const f = Object.hasOwn(FORMATS, c.format) ? FORMATS[c.format] : undefined;
  const lines: string[] = [];
  if (c.motion) lines.push(`Motion: ${c.motion}`);
  else if (req.field !== "motion") lines.push(`Format: ${f?.name ?? c.format}`);
  lines.push(`${whereLine(c.format, c.side, c.speech)}. Field: ${FIELD_STYLE[req.field]}.`);
  if (c.thesis) lines.push(`Thesis: ${c.thesis}`);
  if (c.card) lines.push(`Card: ${c.card}`);
  if (c.answers?.length) lines.push(`Answers the opponent's note: ${c.answers.join(" | ")}`);
  if (c.siblings?.length) lines.push(`Nearby notes: ${c.siblings.join(" | ")}`);
  lines.push(`Note: ${req.before}`);
  return [{ role: "system", content: SYSTEM }, ...EXAMPLES, { role: "user", content: lines.join("\n") }];
}

// ---------------------------------------------------------------------------------------------
// Post-processing

/** Most words a suggestion may have (the prompt asks for 12). */
export const MAX_SUGGEST_WORDS = 15;

const QUOTE_CHARS = `"'“”‘’«»„\``;
const LEADING_QUOTES = new RegExp(`^[${QUOTE_CHARS}]+`);
const TRAILING_DOUBLE_QUOTES = /["“”«»„`]+$/;
const TRAILING_SINGLE_QUOTES = /['‘’]+$/;
/** Tokens ending in "." that do not end a sentence: e.g. i.e. vs. etc., initials, U.S. */
const ABBREVIATION = /^(?:e\.g|i\.e|vs|cf|etc|approx|incl|esp|mr|mrs|ms|dr|prof|st|no|fig|[\p{L}](?:\.[\p{L}])*)\.$/iu;
const WORD_CHAR = /[\p{L}\p{N}]/u;
const REASONING_TAGS = "think|thinking|reasoning|thought|analysis";
/** A whole line that is only a preface or label ("Sure!", "Here's the continuation:"). */
const PREFACE_LINE = /^(?:sure|okay|ok|certainly|of course|absolutely|got it|here(?:'s| is| are)\b.*|.*\b(?:continuation|completion|completed|suggestion|answer|output)\b.*:)\s*[!.:]?$/i;
const PREFACE_INLINE = [
  /^(?:Sure|Okay|OK|Ok|Certainly|Of course|Absolutely|Got it)[!.,:]\s*/,
  /^Here(?:'s| is| are)\b[^:\n]{0,60}:\s*/i,
  /^(?:continuation|completion|completed (?:sentence|text|note)|suggestion|answer|output|note|text|reply)\s*:\s*/i,
];
const NOTHING = /^(?:n\/?a|none|null|undefined|nil|-+|\[[^\]]*\]|\([^)]*\)|<[^>]*>)$/i;

/** Removes reasoning blocks; null when the answer is all unfinished reasoning. */
function stripReasoning(t: string): string | null {
  const block = new RegExp(`<(${REASONING_TAGS})\\b[^>]*>[\\s\\S]*?</\\1\\s*>`, "gi");
  t = t.replace(block, "");
  if (new RegExp(`<(?:${REASONING_TAGS})\\b`, "i").test(t)) return null; // opened, never closed (cut by max_tokens)
  const close = new RegExp(`</(?:${REASONING_TAGS})\\s*>`, "gi");
  let last = -1;
  for (let m = close.exec(t); m; m = close.exec(t)) last = m.index + m[0].length;
  return last >= 0 ? t.slice(last) : t; // only a closing tag: the reasoning before it was hidden
}

/** The first line that is an answer (not empty, not a code fence, not a preface). */
function answerLine(t: string): string {
  const lines = t
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !/^```/.test(l));
  return lines.find((l) => !PREFACE_LINE.test(l)) ?? "";
}

/** Whether `before` has an opening quote that is not closed yet (then a closing quote is legitimate). */
function quoteOpen(before: string): boolean {
  const n = (re: RegExp) => before.match(re)?.length ?? 0;
  return n(/"/g) % 2 === 1 || n(/“/g) > n(/”/g) || n(/«/g) > n(/»/g);
}

const fold = (ch: string) => ch.toLowerCase().replace(/[’‘`]/g, "'").replace(/[“”«»„]/g, '"');

/**
 * If `t` starts with `s` (case-insensitive; any whitespace run in `s` matches any whitespace run
 * in `t`), the number of characters of `t` it covers; else -1.
 */
function matchPrefix(t: string, s: string): number {
  let i = 0;
  let j = 0;
  while (j < s.length) {
    if (/\s/.test(s[j])) {
      if (i >= t.length || !/\s/.test(t[i])) return -1;
      while (j < s.length && /\s/.test(s[j])) j++;
      while (i < t.length && /\s/.test(t[i])) i++;
      continue;
    }
    if (i >= t.length || fold(t[i]) !== fold(s[j])) return -1;
    i++;
    j++;
  }
  return i;
}

/**
 * Removes an echo of the end of `before` from the start of `t`: the whole text, the current
 * sentence, the last few words or just the last (maybe unfinished) word. Longest match wins.
 * Returns null when nothing was echoed.
 */
function stripEcho(before: string, t: string): string | null {
  const words = before.trim().split(/\s+/).filter(Boolean);
  const lastWordDone = /\s$/.test(before);
  const tt = t.trimStart();
  for (let k = words.length; k >= 1; k--) {
    const len = matchPrefix(tt, words.slice(-k).join(" "));
    if (len < 0) continue;
    const rest = tt.slice(len);
    // after a space the last word is finished: "mining" must not match the start of "miners"
    if (lastWordDone && rest && WORD_CHAR.test(rest[0])) continue;
    return rest;
  }
  return null;
}

/** Index in `t` just after the first sentence end, or -1. `stem` is the unfinished token of `before`. */
function sentenceEnd(stem: string, t: string): number {
  const joined = stem + t;
  const re = /[.!?…]+/g;
  for (let m = re.exec(joined); m; m = re.exec(joined)) {
    let end = m.index + m[0].length;
    if (end <= stem.length) continue;
    while (end < joined.length && /[)"'”’»\]]/.test(joined[end])) end++;
    if (end < joined.length && !/\s/.test(joined[end])) continue; // 3.5, e.g.x, U.S.A
    if (m[0] === ".") {
      const token = joined.slice(0, m.index + 1).split(/\s/).pop() ?? "";
      if (ABBREVIATION.test(token.replace(/^[("'“‘«]+/, ""))) continue;
    }
    return end - stem.length;
  }
  return -1;
}

/**
 * Cleans a raw model answer into the continuation of `before` (what goes right after it).
 * Returns "" when nothing usable is left. Spacing: no leading space when `before` ends with
 * whitespace; one space before a new word; none when the answer finishes a cut-off word.
 */
export function postProcess(before: string, raw: string): string {
  const unthought = stripReasoning(raw.replace(/\r/g, ""));
  if (unthought === null) return "";
  let t = answerLine(unthought);
  for (const re of PREFACE_INLINE) t = t.replace(re, "");
  // markdown: list / heading markers, emphasis and code marks
  t = t.replace(/^(?:[-*+>]\s+|#{1,6}\s+)/, "").replace(/\*\*|__|\*|`/g, "");
  // quotes around the answer (a closing quote stays when the note has an open one)
  const lead = /^['’]s\b/.test(t) ? "" : (LEADING_QUOTES.exec(t)?.[0] ?? ""); // "'s problems" is not a quote
  t = t.slice(lead.length);
  if (!quoteOpen(before)) t = t.replace(TRAILING_DOUBLE_QUOTES, "");
  if (/['‘’]/.test(lead)) t = t.replace(TRAILING_SINGLE_QUOTES, "");
  // "...ocks scarce metals" / "… scarce metals": the dots only mean "continued"; glued to a letter = mid-word
  const dots = /^\s*(?:\.{2,}|…)/.exec(t)?.[0] ?? "";
  t = t.slice(dots.length);
  const midWord = dots !== "" && WORD_CHAR.test(t[0] ?? "");

  const endsWithSpace = /\s$/.test(before);
  const echo = stripEcho(before, t);
  if (echo !== null) {
    // the model's own spacing after the echoed word is right: "mining unlocks" → " unlocks"
    t = echo.replace(/^\s+/, " ");
  } else {
    t = t.trimStart();
    const b = before.slice(-1);
    const glued = /^(?:[,.;:!?)\]}%…]|['’]s\b)/u.test(t);
    const afterWord = WORD_CHAR.test(b) || /[,;:.!?)\]}%"”’»]/.test(b);
    if (t && before && !endsWithSpace && !glued && !midWord && afterWord) t = ` ${t}`;
  }
  if (endsWithSpace) t = t.trimStart();

  const stem = endsWithSpace ? "" : (before.match(/\S+$/)?.[0] ?? "");
  const end = sentenceEnd(stem, t);
  if (end >= 0) t = t.slice(0, end);

  // at most MAX_SUGGEST_WORDS words
  const parts = t.split(/(\s+)/);
  let words = 0;
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].trim() && ++words > MAX_SUGGEST_WORDS) {
      t = parts.slice(0, i).join("");
      break;
    }
  }
  // nothing dangling at the end: trailing ellipsis, open clause punctuation, spaces
  t = t.replace(/(?:\s*(?:\.{2,}|…)|[\s,;:(\-–—]+)+$/u, "");
  if (!WORD_CHAR.test(t) || NOTHING.test(t.trim())) return "";
  return t;
}
