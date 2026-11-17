/**
 * Prompt builder and post-processing for AI sentence suggestions. Pure: used by the Worker
 * (worker/suggest.ts) and by the benchmark (scripts/bench-suggest.ts), so the benchmark tests
 * exactly what ships. First version by the lead; the evaluation agent tunes it.
 */
import type { SuggestRequest } from "./suggest";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const FIELD_STYLE: Record<SuggestRequest["field"], string> = {
  card: "an argument title on a debate flow card: terse, a few words, no filler",
  point: "a short supporting point under an argument: terse note style",
  thesis: "a thesis title grouping arguments: very short",
  motion: "a debate motion (e.g. 'This House would …')",
  "doc-thesis": "a thesis title in a prep outline: very short",
  "doc-card": "an argument line in a prep outline: terse",
  "doc-point": "a supporting point in a prep outline: terse",
};

const SYSTEM = [
  "You complete text in a parliamentary debate note-taking app (flowing).",
  "The user is typing; you write ONLY the continuation that finishes their current sentence.",
  "Rules:",
  "- Output only the missing words, never repeat any of the given text.",
  "- Finish the current sentence and stop. At most 15 words.",
  "- Match the language, register and terse note-taking style of the given text.",
  "- No quotes, no explanations, no prefaces, no markdown.",
  "- If the text needs a leading space before your continuation, start with a space.",
].join("\n");

/** Builds the chat messages for one suggestion. */
export function buildMessages(req: Pick<SuggestRequest, "field" | "before" | "context">): ChatMessage[] {
  const c = req.context;
  const lines: string[] = [];
  if (c.motion) lines.push(`Motion: ${c.motion}`);
  lines.push(`Format: ${c.format}. This is the flow (notes) kept by the ${c.side} side${c.speech ? `; the note sits in the column of the ${c.speech} speech` : ""}.`);
  if (c.thesis) lines.push(`Thesis: ${c.thesis}`);
  if (c.card) lines.push(`Argument this point supports: ${c.card}`);
  if (c.answers?.length) lines.push(`This answers the opponent's argument(s): ${c.answers.map((a) => `"${a}"`).join("; ")}`);
  if (c.siblings?.length) lines.push(`Nearby notes (style reference): ${c.siblings.map((a) => `"${a}"`).join("; ")}`);
  lines.push(`Field: ${FIELD_STYLE[req.field]}.`);
  lines.push("", "Text so far (continue right after it):", req.before);
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: lines.join("\n") },
  ];
}

const SENTENCE_END = /[.!?…](?=\s|$)/;

/**
 * Cleans a raw model answer into a continuation of `before`. Returns "" when nothing usable is left.
 */
export function postProcess(before: string, raw: string): string {
  let t = raw.replace(/\r/g, "").split("\n").find((l) => l.trim() !== "") ?? "";
  t = t.replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, "");
  // the model echoed the text: keep only what comes after it
  const tail = before.trimEnd();
  if (tail && t.trimStart().toLowerCase().startsWith(tail.toLowerCase())) t = t.trimStart().slice(tail.length);
  else {
    // partial echo: the model repeated the last word(s)
    const lastWords = tail.split(/\s+/).slice(-3).join(" ");
    if (lastWords && t.trimStart().toLowerCase().startsWith(lastWords.toLowerCase())) t = t.trimStart().slice(lastWords.length);
  }
  const m = SENTENCE_END.exec(t);
  if (m) t = t.slice(0, m.index + 1);
  if (!t.trim()) return "";
  // spacing: one space between a finished word and the continuation, none inside a word
  const endsWithSpace = /\s$/.test(before);
  const startsWithWordChar = /^[\p{L}\p{N}]/u.test(t);
  if (endsWithSpace) t = t.trimStart();
  else if (startsWithWordChar && before && /[\p{L}\p{N}]$/u.test(before) && raw.startsWith(" ")) t = ` ${t}`;
  else if (/^[\p{L}\p{N}(]/u.test(t.trimStart()) && /[,;:]$/.test(before)) t = ` ${t.trimStart()}`;
  return t.replace(/\s+$/, "");
}
