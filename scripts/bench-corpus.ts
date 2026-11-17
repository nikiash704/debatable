/**
 * Benchmark corpus for AI sentence suggestions (docs/plans/ai-suggestions-bench.md).
 *
 * Each item is what a round field really sends to `POST /api/suggest` (src/shared/suggest.ts), minus
 * `room` / `device` / `model`, which the benchmark fills in. Contexts were produced by
 * `buildSuggestInput` (src/ui/suggest/context.ts) on the "Ocean vs Space" board (e2e/ocean.ts, we are
 * the Opposition) at the stage the note is typed, and on two generic APDA flows. `before` is the text
 * up to the caret, cut after 3–8 words, mid-word or after a space, as a pause would find it; every
 * item passes the client's trigger rule (`shouldSuggest`). `reference` is what the debater actually
 * wrote, when known (for the judge; not a single right answer).
 */
import type { SuggestContext, SuggestRequest } from "../src/shared/suggest";

export interface BenchItem extends Omit<SuggestRequest, "room" | "device" | "model"> {
  id: string;
  /** What the item exercises: field kind, cut style, edge case. */
  tags: string[];
  reference?: string;
}

const OCEAN = "THW prioritise ocean exploration over space exploration";
const T1 = "Space is the bigger long-term payoff";
const T2 = "Space tech already pays off on Earth";
const T3 = "Ocean exploration harms what it studies";
const A = {
  a1: "Asteroid mining unlocks scarce metals",
  a2: "Planetary backup for humanity",
  a3: "Satellites run climate monitoring",
  a4: "Spin-offs: GPS, solar cells, water filters",
  a5: "Deep-sea mining destroys ecosystems",
  a6: "Ocean research is already funded",
};
const PM = ["Oceans are 95% unexplored", "Climate answers are in the ocean", "Cheaper per discovery", "Food security", "Space race is militarised"];
const OC = ["Unexplored is not more valuable", "Satellites already watch the ocean", "Ignores spin-offs", "Treaties limit militarisation"];

const opp = (c: Omit<SuggestContext, "format" | "side">): SuggestContext => ({ format: "apda", side: "opp", ...c });
const gov = (c: Omit<SuggestContext, "format" | "side">): SuggestContext => ({ format: "apda", side: "gov", ...c });

/** Prep: our LOC arguments (siblings as buildSuggestInput gives them on the finished prep board). */
const prepCard = (thesis: string, siblings: string[]) => opp({ speech: "LOC", motion: OCEAN, thesis, siblings });
const prepPoint = (thesis: string, card: string, siblings: string[]) => opp({ speech: "LOC", motion: OCEAN, thesis, card, siblings });
const SIB_A1 = [A.a2, A.a3, A.a4, A.a5];
const SIB_A3 = [A.a1, A.a2, A.a4, A.a5];
const SIB_A5 = [A.a2, A.a3, A.a4, A.a6];
const SIB_A6 = [A.a2, A.a3, A.a4, A.a5];
const pmCol = (i: number) => opp({ speech: "PMC", motion: OCEAN, siblings: PM.filter((_, j) => j !== i) });
const ocCol = (i: number) => opp({ speech: "LOC", motion: OCEAN, answers: [PM[i === 3 ? 4 : i]], siblings: [...OC.filter((_, j) => j !== i), A.a1] });

const TESTS = "THW abolish standardized testing in college admissions";
const SOCIAL = "THBT social media has done more harm than good";

export const BENCH_CORPUS: BenchItem[] = [
  // ---- Ocean vs Space: prep (thesis titles, our arguments, points) -------------------------------
  { id: "ocean-thesis-1", tags: ["thesis", "word-end"], field: "thesis", before: "Space is the bigger", reference: " long-term payoff", context: opp({ speech: "LOC", motion: OCEAN, siblings: [T2, T3] }) },
  { id: "ocean-thesis-3", tags: ["thesis", "space-end"], field: "thesis", before: "Ocean exploration harms what ", reference: "it studies", context: opp({ speech: "LOC", motion: OCEAN, siblings: [T1, T2] }) },
  { id: "ocean-a1", tags: ["card", "word-end"], field: "card", before: "Asteroid mining unlocks", reference: " scarce metals", context: prepCard(T1, SIB_A1) },
  { id: "ocean-a1-mid", tags: ["card", "mid-word"], field: "card", before: "Asteroid mining unl", reference: "ocks scarce metals", context: prepCard(T1, SIB_A1) },
  { id: "ocean-a2", tags: ["card", "space-end"], field: "card", before: "Planetary backup for ", reference: "humanity", context: prepCard(T1, [A.a1, A.a3, A.a4, A.a5]) },
  { id: "ocean-a3-mid", tags: ["card", "mid-word"], field: "card", before: "Satellites run climate monit", reference: "oring", context: prepCard(T2, SIB_A3) },
  { id: "ocean-a4-comma", tags: ["card", "comma-end", "edge"], field: "card", before: "Spin-offs: GPS, solar cells,", reference: " water filters", context: prepCard(T2, [A.a2, A.a3, A.a5, A.a6]) },
  { id: "ocean-a5", tags: ["card", "word-end"], field: "card", before: "Deep-sea mining destroys", reference: " ecosystems", context: prepCard(T3, SIB_A5) },
  { id: "ocean-a6", tags: ["card", "space-end"], field: "card", before: "Ocean research is already ", reference: "funded", context: prepCard(T3, SIB_A6) },
  { id: "ocean-a1-p0", tags: ["point", "word-end"], field: "point", before: "Platinum-group metals are", context: prepPoint(T1, A.a1, ["No seabed damage", A.a2, A.a3, A.a4]) },
  { id: "ocean-a2-p0", tags: ["point", "mid-word"], field: "point", before: "Extinction-level risks like aster", context: prepPoint(T1, A.a2, [A.a1, A.a3, A.a4, A.a5]) },
  { id: "ocean-a3-p0", tags: ["point", "word-end"], field: "point", before: "Sea-level data comes", reference: " from orbit", context: prepPoint(T2, A.a3, SIB_A3) },
  { id: "ocean-a5-p0", tags: ["point", "space-end"], field: "point", before: "Plumes travel hundreds of ", reference: "km", context: prepPoint(T3, A.a5, SIB_A5) },
  { id: "ocean-a6-p0", tags: ["point", "word-end"], field: "point", before: "Private and military", reference: " money", context: prepPoint(T3, A.a6, SIB_A6) },

  // ---- Ocean vs Space: Doc view (prep outline) -------------------------------------------------
  { id: "ocean-doc-thesis", tags: ["doc-thesis", "word-end"], field: "doc-thesis", before: "Space tech already pays", reference: " off on Earth", context: opp({ speech: "LOC", motion: OCEAN, siblings: [T1, T3] }) },
  { id: "ocean-doc-card", tags: ["doc-card", "space-end"], field: "doc-card", before: "Satellites run climate ", reference: "monitoring", context: prepCard(T2, SIB_A3) },
  { id: "ocean-doc-card-2", tags: ["doc-card", "word-end"], field: "doc-card", before: "Asteroids hold more platinum than", context: prepCard(T1, SIB_A1) },
  { id: "ocean-doc-point", tags: ["doc-point", "space-end"], field: "doc-point", before: "Everyday tech such as ", context: prepPoint(T2, A.a4, [A.a2, A.a3, A.a5, A.a6]) },
  { id: "ocean-doc-point-2", tags: ["doc-point", "mid-word"], field: "doc-point", before: "No seabed damage, unlike deep-sea dre", context: prepPoint(T1, A.a1, ["Platinum-group metals", A.a2, A.a3, A.a4]) },

  // ---- Ocean vs Space: flowing the PMC (the opponent's arguments) ------------------------------
  { id: "ocean-pm1-num", tags: ["card", "opponent", "number-end", "edge"], field: "card", before: "Oceans are 95%", reference: " unexplored", context: pmCol(0) },
  { id: "ocean-pm2", tags: ["card", "opponent", "word-end"], field: "card", before: "Climate answers are in", reference: " the ocean", context: pmCol(1) },
  { id: "ocean-pm3", tags: ["card", "opponent", "word-end"], field: "card", before: "Cheaper per discovery than", context: pmCol(2) },
  { id: "ocean-pm5-mid", tags: ["card", "opponent", "mid-word"], field: "card", before: "Space race is milit", reference: "arised", context: pmCol(4) },

  // ---- Ocean vs Space: our answers (respondsTo) -------------------------------------------------
  { id: "ocean-oc1", tags: ["card", "answer", "word-end"], field: "card", before: "Unexplored is not", reference: " more valuable", context: ocCol(0) },
  { id: "ocean-oc2", tags: ["card", "answer", "space-end"], field: "card", before: "Satellites already watch ", reference: "the ocean", context: ocCol(1) },
  { id: "ocean-oc3", tags: ["card", "answer", "word-end"], field: "card", before: "Ignores spin-offs like", context: ocCol(2) },
  { id: "ocean-oc4-mid", tags: ["card", "answer", "mid-word"], field: "card", before: "Treaties limit militar", reference: "isation", context: ocCol(3) },
  { id: "ocean-mg1", tags: ["card", "opponent", "answer", "word-end"], field: "card", before: "Asteroid mining is decades", reference: " away", context: opp({ speech: "MG", motion: OCEAN, answers: [A.a1], siblings: ["Earth's problems come first"] }) },
  { id: "ocean-mg2-apos", tags: ["card", "opponent", "apostrophe", "edge"], field: "card", before: "Earth's problems come", reference: " first", context: opp({ speech: "MG", motion: OCEAN, siblings: ["Asteroid mining is decades away"] }) },
  { id: "ocean-oc5", tags: ["card", "answer", "word-end"], field: "card", before: "Decades away is still", reference: " a payoff", context: opp({ speech: "MO", motion: OCEAN, answers: ["Asteroid mining is decades away"], siblings: ["Food security is solved on land", A.a2, A.a4, A.a6] }) },
  { id: "ocean-oc6", tags: ["card", "answer", "space-end"], field: "card", before: "Food security is solved on ", reference: "land", context: opp({ speech: "MO", motion: OCEAN, answers: ["Food security"], siblings: ["Decades away is still a payoff", A.a2, A.a4, A.a6] }) },
  { id: "ocean-oc5-point", tags: ["point", "answer", "word-end"], field: "point", before: "Long-term payoffs still count because", context: opp({ speech: "MO", motion: OCEAN, card: "Decades away is still a payoff", answers: ["Asteroid mining is decades away"], siblings: ["Food security is solved on land", A.a2, A.a4, A.a6] }) },
  { id: "ocean-or1", tags: ["card", "rebuttal", "word-end"], field: "card", before: "They never answered the", reference: " spin-offs", context: opp({ speech: "LOR", motion: OCEAN }) },

  // ---- Motions ----------------------------------------------------------------------------------
  { id: "motion-ocean", tags: ["motion", "word-end"], field: "motion", before: "THW prioritise ocean exploration", reference: " over space exploration", context: opp({}) },
  { id: "motion-ban", tags: ["motion", "space-end"], field: "motion", before: "This House would ban ", context: gov({}) },
  { id: "motion-thbt", tags: ["motion", "word-end"], field: "motion", before: "THBT developing nations should", context: opp({}) },

  // ---- Generic APDA, Government: standardized testing ------------------------------------------
  { id: "tests-thesis", tags: ["thesis", "word-end"], field: "thesis", before: "Better alternatives to testing", context: gov({ speech: "PMC", motion: TESTS, siblings: ["Tests entrench inequality"] }) },
  { id: "tests-ga1", tags: ["card", "word-end"], field: "card", before: "Tests favour wealthy students who", reference: " can pay for prep", context: gov({ speech: "PMC", motion: TESTS, thesis: "Tests entrench inequality", siblings: ["Scores track family income", "Holistic review captures more than one exam"] }) },
  { id: "tests-ga1-p0", tags: ["point", "space-end"], field: "point", before: "Test prep costs thousands of ", reference: "dollars", context: gov({ speech: "PMC", motion: TESTS, thesis: "Tests entrench inequality", card: "Tests favour wealthy students who can pay for prep", siblings: ["Scores track family income", "Holistic review captures more than one exam"] }) },
  { id: "tests-ga3-mid", tags: ["card", "mid-word"], field: "card", before: "Holistic review captures more than one ex", reference: "am", context: gov({ speech: "PMC", motion: TESTS, thesis: "Better alternatives exist", siblings: ["Tests favour wealthy students who can pay for prep", "Scores track family income"] }) },
  { id: "tests-lo1", tags: ["card", "opponent", "word-end"], field: "card", before: "Tests are the only common", reference: " yardstick", context: gov({ speech: "LOC", motion: TESTS, siblings: ["Grades are inflated", "Abolition hurts poor high-achievers"] }) },
  { id: "tests-gc1", tags: ["card", "answer", "word-end"], field: "card", before: "Grades inflate less than test", reference: " prep distorts", context: gov({ speech: "MG", motion: TESTS, answers: ["Tests are the only common yardstick"], siblings: ["Tests favour wealthy students who can pay for prep", "Scores track family income", "Holistic review captures more than one exam", "Poor high-achievers shine in holistic review"] }) },
  { id: "tests-gc2", tags: ["card", "answer", "space-end"], field: "card", before: "Poor high-achievers shine in ", reference: "holistic review", context: gov({ speech: "MG", motion: TESTS, answers: ["Abolition hurts poor high-achievers"], siblings: ["Tests favour wealthy students who can pay for prep", "Scores track family income", "Holistic review captures more than one exam", "Grades inflate less than test prep distorts"] }) },
  { id: "tests-pmr", tags: ["card", "rebuttal", "word-end"], field: "card", before: "Even if tests predict grades, they", context: gov({ speech: "PMR", motion: TESTS }) },

  // ---- Generic APDA, Opposition: social media --------------------------------------------------
  { id: "social-card", tags: ["card", "word-end"], field: "card", before: "Teen mental health data is", context: opp({ speech: "LOC", motion: SOCIAL, thesis: "Harms are overstated", siblings: ["Connects isolated people", "Mobilises protest movements"] }) },
  { id: "social-answer", tags: ["card", "answer", "word-end"], field: "card", before: "Correlation is not", reference: " causation", context: opp({ speech: "LOC", motion: SOCIAL, answers: ["Teen depression rose with smartphones"], siblings: ["Connects isolated people"] }) },
  { id: "social-eg", tags: ["card", "abbreviation", "edge"], field: "card", before: "Mobilises protest movements, e.g. Arab Spring and", context: opp({ speech: "LOC", motion: SOCIAL, thesis: "Real-world goods", siblings: ["Connects isolated people", "Small businesses reach customers"] }) },
  { id: "social-weigh", tags: ["card", "rebuttal", "space-end"], field: "card", before: "Weigh this round on ", context: opp({ speech: "LOR", motion: SOCIAL }) },

  // ---- Edge cases -------------------------------------------------------------------------------
  { id: "edge-number", tags: ["point", "number-end", "edge"], field: "point", before: "NASA's budget is about $25", context: opp({ speech: "LOC", motion: OCEAN, thesis: T1, card: "Space already gets the money", siblings: ["Ocean research is already funded"] }) },
  { id: "edge-colon", tags: ["card", "colon-end", "edge"], field: "card", before: "Two reasons space wins:", context: prepCard(T1, SIB_A1) },
  { id: "edge-paren", tags: ["point", "bracket", "edge"], field: "point", before: "Plumes travel far (NOAA data shows", context: prepPoint(T3, A.a5, SIB_A5) },
  { id: "edge-vs", tags: ["card", "abbreviation", "edge"], field: "card", before: "Ocean vs. space funding is", context: ocCol(2) },
  { id: "edge-second-sentence", tags: ["card", "multi-sentence", "edge"], field: "card", before: "Mining is decades away. But the payoff", context: opp({ speech: "MO", motion: OCEAN, answers: ["Asteroid mining is decades away"], siblings: [A.a2, A.a4] }) },
  { id: "edge-comma-space", tags: ["card", "comma-end", "space-end", "edge"], field: "card", before: "Cheaper, faster, and ", context: ocCol(2) },
  { id: "edge-hyphen", tags: ["point", "hyphen", "edge"], field: "point", before: "Spin-offs reach everyday life via long-", context: prepPoint(T2, A.a4, [A.a2, A.a3, A.a5, A.a6]) },
  { id: "edge-ru-mixed", tags: ["card", "russian", "mid-word", "edge"], field: "card", before: "Океан изучен всего на пя", context: pmCol(0) },
  {
    id: "edge-ru",
    tags: ["card", "russian", "space-end", "edge"],
    field: "card",
    before: "Космос даёт больше технологий, чем ",
    context: opp({ speech: "LOC", motion: "ЭП отдаст приоритет исследованию океана, а не космоса", thesis: "Космос окупается на Земле", siblings: ["Спутники следят за климатом", "GPS и солнечные батареи"] }),
  },
  {
    id: "edge-long",
    tags: ["doc-card", "long", "multi-sentence", "edge"],
    field: "doc-card",
    before:
      "Satellites already give us most of what we know about the ocean: sea-surface temperature, sea level, chlorophyll, ice cover and storm tracks. " +
      "Argo floats are cheap, but they only sample the top two kilometres and they are calibrated against satellite data. " +
      "Every serious climate model the PM relies on is fed by orbital sensors, not by submarines. " +
      "So money moved from space to the ocean would blind the very research the Government says it cares about. " +
      "The real question is whether",
    context: prepCard(T2, SIB_A3),
  },
];

// ---------------------------------------------------------------------------------------------
// Automatic format checks on a (post-processed) suggestion. Quality is judged separately.

/** Most words a suggestion may have to pass. */
export const MAX_WORDS = 15;

export type FormatFailure =
  | "newline"
  | "quotes"
  | "markdown"
  | "reasoning"
  | "echo"
  | "too-long"
  | "multi-sentence"
  | "spacing"
  | "language";

const ABBREV = /^(?:e\.g|i\.e|vs|cf|etc|approx|incl|esp|mr|mrs|ms|dr|prof|st|no|fig|[\p{L}](?:\.[\p{L}])*)\.$/iu;
const CYRILLIC = /\p{Script=Cyrillic}/u;
const LETTER = /\p{L}/u;
const fold = (s: string) => s.toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, " ");

/** Sentence ends in `t` (".", "!", "?", "…" before a space or the end; not abbreviations or decimals). */
function sentenceEnds(t: string): number[] {
  const out: number[] = [];
  const re = /[.!?…]+["'”’)\]]*(?=\s|$)/g;
  for (let m = re.exec(t); m; m = re.exec(t)) {
    const token = t.slice(0, m.index + 1).split(/\s/).pop() ?? "";
    if (m[0].startsWith(".") && !m[0].startsWith("..") && ABBREV.test(token.replace(/^[("'“‘«]+/, ""))) continue;
    out.push(m.index + m[0].length);
  }
  return out;
}

/**
 * Which format rules a suggestion breaks, given the text before the caret and the item's tags
 * ("word-end": the cut is after a finished word, so a new word needs a space; "mid-word": the cut is
 * inside a word, so the suggestion must start with the rest of it). Empty list = passes.
 */
export function checkFormat(before: string, text: string, tags: readonly string[] = []): FormatFailure[] {
  const fails: FormatFailure[] = [];
  const t = text;
  if (/[\r\n]/.test(t)) fails.push("newline");
  const quoteOpen = (before.match(/"/g)?.length ?? 0) % 2 === 1 || (before.match(/“/g)?.length ?? 0) > (before.match(/”/g)?.length ?? 0);
  if (/^\s*["“”«»„`]/.test(t) || /^\s*['‘’](?!s\b)/.test(t) || (!quoteOpen && /["“”«»„`]\s*$/.test(t))) fails.push("quotes");
  if (/\*\*|`|^\s*(?:[-*+>]\s|#{1,6}\s)/.test(t)) fails.push("markdown");
  if (/<\/?(?:think|thinking|reasoning)\b/i.test(t)) fails.push("reasoning");

  const endsSpace = /\s$/.test(before);
  const words = before.trim().split(/\s+/);
  const last = words.at(-1) ?? "";
  const tt = fold(t.trimStart());
  const lastWordEcho = last.length >= 2 && tt.startsWith(fold(last)) && (!endsSpace || !/^[\p{L}\p{N}]/u.test(tt.slice(last.length)));
  const wholeEcho = words.length >= 3 && fold(t).includes(fold(before.trim()));
  if (lastWordEcho || wholeEcho) fails.push("echo");

  if (t.split(/\s+/).filter(Boolean).length > MAX_WORDS) fails.push("too-long");
  const ends = sentenceEnds(t);
  if (ends.length > 1 || (ends.length === 1 && t.slice(ends[0]).trim() !== "")) fails.push("multi-sentence");

  const startsWord = /^[\p{L}\p{N}]/u.test(t);
  const badSpace = endsSpace ? /^\s/.test(t) : /^\s{2,}/.test(t);
  if (badSpace || (tags.includes("word-end") && startsWord) || (tags.includes("mid-word") && !startsWord)) fails.push("spacing");

  if (LETTER.test(t)) {
    const ru = CYRILLIC.test(before);
    if (ru ? !CYRILLIC.test(t) : CYRILLIC.test(t)) fails.push("language");
  }
  return fails;
}
