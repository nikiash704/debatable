import { describe, expect, it } from "vitest";
import { BENCH_CORPUS, checkFormat } from "../../scripts/bench-corpus";
import { shouldSuggest } from "../ui/suggest/rules";
import { SUGGEST_LIMITS } from "./suggest";
import { buildMessages, MAX_SUGGEST_WORDS, postProcess } from "./suggest-prompt";

/** What the user would see once the suggestion is accepted. */
const accept = (before: string, raw: string) => before + postProcess(before, raw);

describe("postProcess: spacing", () => {
  it("mid-word: the echoed (completed) last word is removed, no space added", () => {
    expect(postProcess("Asteroid mining unl", "unlocks scarce metals")).toBe("ocks scarce metals");
    expect(accept("Space race is milit", "Militarised already")).toBe("Space race is militarised already");
    expect(accept("Treaties limit militar", "militarisation of space")).toBe("Treaties limit militarisation of space");
  });

  it("after a finished word with no space: one space before the new words", () => {
    expect(postProcess("Asteroid mining unlocks", "unlocks scarce metals")).toBe(" scarce metals");
    expect(postProcess("Asteroid mining unlocks", "scarce metals")).toBe(" scarce metals");
    expect(postProcess("Asteroid mining unlocks", " scarce metals")).toBe(" scarce metals");
  });

  it("after a trailing space: never a leading space", () => {
    expect(postProcess("Planetary backup for ", "for humanity")).toBe("humanity");
    expect(postProcess("Planetary backup for ", "humanity")).toBe("humanity");
    expect(postProcess("Planetary backup for ", "  humanity")).toBe("humanity");
    expect(accept("Planetary backup for  ", "humanity")).toBe("Planetary backup for  humanity");
  });

  it("after a trailing space, a new word that merely starts like the last word is not an echo", () => {
    expect(postProcess("the cost of mining ", "miners' safety")).toBe("miners' safety");
  });

  it("after a comma, a colon or a number", () => {
    expect(postProcess("Spin-offs: GPS, solar cells,", "cells, water filters")).toBe(" water filters");
    expect(postProcess("Spin-offs: GPS, solar cells,", "water filters")).toBe(" water filters");
    expect(postProcess("Two reasons:", "cost and risk")).toBe(" cost and risk");
    expect(postProcess("Oceans are 95%", "95% unexplored")).toBe(" unexplored");
    expect(postProcess("Oceans are 95%", "unexplored")).toBe(" unexplored");
    expect(postProcess("Deaths fell by 4", "40% since 2010")).toBe("0% since 2010");
  });

  it("punctuation that sticks to the previous word gets no space", () => {
    expect(postProcess("Cheaper per discovery", ", not per launch")).toBe(", not per launch");
    expect(postProcess("Earth", "'s problems come first")).toBe("'s problems come first");
  });

  it("after an opening bracket, a hyphen or a currency sign: no space", () => {
    expect(postProcess("Plumes travel far (", "hundreds of km)")).toBe("hundreds of km)");
    expect(postProcess("Costs over $", "$3 billion a year")).toBe("3 billion a year");
    expect(postProcess("Spin-", "Spin-offs like GPS")).toBe("offs like GPS");
  });

  it("Russian text, mid-word and after a space", () => {
    expect(accept("Океан изучен всего на пя", "пять процентов")).toBe("Океан изучен всего на пять процентов");
    expect(accept("Космос даёт больше технологий, чем ", "чем океан")).toBe("Космос даёт больше технологий, чем океан");
  });
});

describe("postProcess: echoes", () => {
  it("echo of the whole text", () => {
    expect(postProcess("Asteroid mining unlocks", "Asteroid mining unlocks scarce metals")).toBe(" scarce metals");
    expect(postProcess("Asteroid  mining\nunlocks ", "asteroid mining unlocks scarce metals")).toBe("scarce metals");
  });

  it("echo of the current sentence or of the last few words", () => {
    expect(postProcess("Mining is decades away. But the payoff", "But the payoff is huge")).toBe(" is huge");
    expect(postProcess("Satellites already watch the", "watch the ocean from orbit")).toBe(" ocean from orbit");
  });

  it("an answer that only repeats the text gives nothing", () => {
    expect(postProcess("Ocean research is already funded", "Ocean research is already funded")).toBe("");
    expect(postProcess("Ocean research is already ", "already")).toBe("");
  });

  it("typographic apostrophes and case do not hide an echo", () => {
    expect(postProcess("Earth's problems", "Earth’s Problems come first")).toBe(" come first");
  });
});

describe("postProcess: junk around the answer", () => {
  it("quotes", () => {
    expect(postProcess("Asteroid mining ", '"unlocks scarce metals"')).toBe("unlocks scarce metals");
    expect(postProcess("Asteroid mining ", "“unlocks scarce metals.”")).toBe("unlocks scarce metals.");
    expect(postProcess("Asteroid mining ", "'unlocks scarce metals'")).toBe("unlocks scarce metals");
    expect(postProcess("Asteroid mining ", "«unlocks scarce metals»")).toBe("unlocks scarce metals");
  });

  it("a closing quote stays when the note opened one", () => {
    expect(postProcess('They call it "the final', 'final frontier"')).toBe(' frontier"');
  });

  it("a possessive apostrophe at the end stays", () => {
    expect(postProcess("Costs fall on ", "the taxpayers'")).toBe("the taxpayers'");
  });

  it("markdown", () => {
    expect(postProcess("Asteroid mining ", "**unlocks scarce metals**")).toBe("unlocks scarce metals");
    expect(postProcess("Asteroid mining ", "`unlocks scarce metals`")).toBe("unlocks scarce metals");
    expect(postProcess("Asteroid mining ", "- unlocks scarce metals")).toBe("unlocks scarce metals");
    expect(postProcess("Asteroid mining ", "```\nunlocks scarce metals\n```")).toBe("unlocks scarce metals");
    expect(postProcess("Asteroid mining ", "*unlocks* scarce metals")).toBe("unlocks scarce metals");
  });

  it("prefaces and labels", () => {
    expect(postProcess("Asteroid mining ", "Sure! Here's the continuation: unlocks scarce metals")).toBe("unlocks scarce metals");
    expect(postProcess("Asteroid mining ", "Sure!\nunlocks scarce metals")).toBe("unlocks scarce metals");
    expect(postProcess("Asteroid mining ", "Here is the completed sentence:\n\nAsteroid mining unlocks scarce metals")).toBe("unlocks scarce metals");
    expect(postProcess("Asteroid mining ", "Continuation: unlocks scarce metals")).toBe("unlocks scarce metals");
    expect(postProcess("Asteroid mining unl", "Note: Asteroid mining unlocks scarce metals")).toBe("ocks scarce metals");
    expect(postProcess("Asteroid mining ", "Okay, unlocks scarce metals")).toBe("unlocks scarce metals");
  });

  it("an ellipsis that only means 'continued'", () => {
    expect(postProcess("Asteroid mining unl", "...ocks scarce metals")).toBe("ocks scarce metals");
    expect(postProcess("Asteroid mining ", "… unlocks scarce metals")).toBe("unlocks scarce metals");
  });

  it("reasoning tags", () => {
    expect(postProcess("Asteroid mining ", "<think>The user wants a debate note.</think>unlocks scarce metals")).toBe("unlocks scarce metals");
    expect(postProcess("Asteroid mining ", "<think>\nhmm\n</think>\n\nunlocks scarce metals")).toBe("unlocks scarce metals");
    expect(postProcess("Asteroid mining ", "<reasoning>x</reasoning> unlocks scarce metals")).toBe("unlocks scarce metals");
    // only the closing tag survives (the provider hid the reasoning)
    expect(postProcess("Asteroid mining ", "wants a note</think>unlocks scarce metals")).toBe("unlocks scarce metals");
    // still thinking when max_tokens cut it: nothing to show
    expect(postProcess("Asteroid mining ", "<think>The user is typing a debate note about")).toBe("");
  });

  it("several lines: the first answer line only", () => {
    expect(postProcess("Asteroid mining ", "unlocks scarce metals\nunlocks rare earths\nboosts industry")).toBe("unlocks scarce metals");
    expect(postProcess("Asteroid mining ", "\n\n  unlocks scarce metals  \n")).toBe("unlocks scarce metals");
  });

  it("empty, blank and placeholder answers give nothing", () => {
    expect(postProcess("Asteroid mining ", "")).toBe("");
    expect(postProcess("Asteroid mining ", "   \n ")).toBe("");
    expect(postProcess("Asteroid mining ", "N/A")).toBe("");
    expect(postProcess("Asteroid mining ", "[no continuation]")).toBe("");
    expect(postProcess("Asteroid mining unlocks", ".")).toBe("");
    expect(postProcess("Asteroid mining ", '""')).toBe("");
  });
});

describe("postProcess: one sentence, short", () => {
  it("stops at the first sentence end, keeping its punctuation", () => {
    expect(postProcess("Asteroid mining ", "unlocks scarce metals. It also creates jobs.")).toBe("unlocks scarce metals.");
    expect(postProcess("Is space worth", "worth it? Yes. Absolutely")).toBe(" it?");
    expect(postProcess("Space race is ", "militarised! Treaties fail")).toBe("militarised!");
  });

  it("abbreviations, decimals and initials are not sentence ends", () => {
    expect(postProcess("Spin-offs ", "pay off, e.g. GPS and solar cells. More")).toBe("pay off, e.g. GPS and solar cells.");
    expect(postProcess("Spin-offs, e.g.", "e.g. GPS and solar cells")).toBe(" GPS and solar cells");
    expect(postProcess("Ocean ", "vs. space funding is lopsided")).toBe("vs. space funding is lopsided");
    expect(postProcess("NASA got ", "$25.4 billion in 2025")).toBe("$25.4 billion in 2025");
    expect(postProcess("Backed by the ", "U.S. Navy and NOAA. Also")).toBe("U.S. Navy and NOAA.");
  });

  it("a trailing ellipsis or dangling comma is dropped", () => {
    expect(postProcess("Asteroid mining ", "unlocks scarce metals...")).toBe("unlocks scarce metals");
    expect(postProcess("Asteroid mining ", "unlocks scarce metals,")).toBe("unlocks scarce metals");
    expect(postProcess("Asteroid mining ", "unlocks scarce metals —")).toBe("unlocks scarce metals");
  });

  it(`caps the suggestion at ${MAX_SUGGEST_WORDS} words`, () => {
    const long = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen";
    const t = postProcess("Count ", long);
    expect(t.split(/\s+/).length).toBe(MAX_SUGGEST_WORDS);
    expect(t.endsWith("fifteen")).toBe(true);
  });

  it("a very long note still works", () => {
    const before = `${"Mining is decades away. ".repeat(20)}But the payoff is`;
    expect(postProcess(before, "is enormous")).toBe(" enormous");
  });
});

describe("buildMessages", () => {
  const card = {
    field: "card" as const,
    before: "Unexplored is not",
    context: {
      format: "apda",
      side: "opp",
      speech: "LOC",
      motion: "THW prioritise ocean exploration over space exploration",
      answers: ["Oceans are 95% unexplored"],
      siblings: ["Satellites already watch the ocean", "Ignores spin-offs"],
    },
  };

  it("system, two examples, then the request", () => {
    const m = buildMessages(card);
    expect(m.map((x) => x.role)).toEqual(["system", "user", "assistant", "user", "assistant", "user"]);
    expect(m.at(-1)!.content).toBe(
      [
        "Motion: THW prioritise ocean exploration over space exploration",
        "Opposition's flow, our own LOC speech. Field: argument card title.",
        "Answers the opponent's note: Oceans are 95% unexplored",
        "Nearby notes: Satellites already watch the ocean | Ignores spin-offs",
        "Note: Unexplored is not",
      ].join("\n"),
    );
  });

  it("the examples follow the echo-the-last-word convention postProcess expects", () => {
    const m = buildMessages(card);
    for (const i of [1, 3]) {
      const before = m[i].content.split("\nNote: ")[1];
      const t = postProcess(before, m[i + 1].content);
      expect(t).not.toBe("");
      expect(/\s$/.test(before) ? !/^\s/.test(t) : true).toBe(true);
    }
    expect(accept("Kids learn empathy from se", m[2].content)).toBe("Kids learn empathy from seeing real animals");
    expect(accept("Most of that money goes to ", m[4].content)).toBe("Most of that money goes to marketing, not habitats");
  });

  it("names whose speech the column is, from the format config", () => {
    const pm = buildMessages({ ...card, context: { format: "apda", side: "opp", speech: "PMC" } }).at(-1)!.content;
    expect(pm).toContain("Opposition's flow, notes on the Government's PMC speech.");
    expect(pm).toContain("Format: American Parliamentary");
    const unknown = buildMessages({ ...card, context: { format: "bp", side: "og", speech: "PM" } }).at(-1)!.content;
    expect(unknown).toContain("og's flow, PM column.");
  });

  it("point: the card and the thesis; motion: no column", () => {
    const p = buildMessages({
      field: "point",
      before: "Platinum-group metals are",
      context: { format: "apda", side: "opp", speech: "LOC", thesis: "Space is the bigger long-term payoff", card: "Asteroid mining unlocks scarce metals" },
    }).at(-1)!.content;
    expect(p).toContain("Field: supporting point under an argument card.");
    expect(p).toContain("Thesis: Space is the bigger long-term payoff\nCard: Asteroid mining unlocks scarce metals");
    const mo = buildMessages({ field: "motion", before: "THW ban", context: { format: "apda", side: "gov" } }).at(-1)!.content;
    expect(mo).toBe("Government's flow. Field: the debate motion (e.g. THW ban zoos / THBT …).\nNote: THW ban");
  });

  it("stays small: the biggest corpus request is well under 1k tokens (~4 chars/token)", () => {
    const sizes = BENCH_CORPUS.map((c) => buildMessages(c).reduce((n, m) => n + m.content.length, 0));
    expect(Math.max(...sizes)).toBeLessThan(4000);
  });
});

describe("bench corpus", () => {
  it("every item is a valid request the client could send", () => {
    const ids = new Set<string>();
    for (const c of BENCH_CORPUS) {
      expect(ids.has(c.id), c.id).toBe(false);
      ids.add(c.id);
      expect(c.before.length, c.id).toBeLessThanOrEqual(SUGGEST_LIMITS.before);
      expect(shouldSuggest(c.before), `${c.id}: the client would not ask`).toBe(true);
      for (const v of [c.context.motion, c.context.thesis, c.context.card, ...(c.context.answers ?? []), ...(c.context.siblings ?? [])])
        if (v !== undefined) expect(v.length, c.id).toBeLessThanOrEqual(SUGGEST_LIMITS.contextItem);
      expect((c.context.answers ?? []).length).toBeLessThanOrEqual(SUGGEST_LIMITS.listItems);
      expect((c.context.siblings ?? []).length).toBeLessThanOrEqual(SUGGEST_LIMITS.listItems);
    }
    expect(BENCH_CORPUS.length).toBeGreaterThanOrEqual(40);
  });
});

describe("bench format checks", () => {
  it("every reference continuation passes, and survives postProcess when echoed the way the prompt asks", () => {
    for (const c of BENCH_CORPUS.filter((x) => x.reference !== undefined)) {
      const ref = c.reference!;
      expect(checkFormat(c.before, ref, c.tags), c.id).toEqual([]);
      const lastWord = c.before.match(/\S+\s*$/)![0];
      const raw = /\s$/.test(c.before) ? `${lastWord.trim()} ${ref}` : lastWord + ref;
      expect(postProcess(c.before, raw), c.id).toBe(ref);
    }
  });

  it("flags the usual failures", () => {
    const b = "Asteroid mining unlocks";
    expect(checkFormat(b, " scarce metals", ["word-end"])).toEqual([]);
    expect(checkFormat(b, "scarce metals", ["word-end"])).toEqual(["spacing"]);
    expect(checkFormat("Asteroid mining unl", " scarce metals", ["mid-word"])).toEqual(["spacing"]);
    expect(checkFormat("Planetary backup for ", " humanity")).toEqual(["spacing"]);
    expect(checkFormat(b, " unlocks scarce metals")).toEqual(["echo"]);
    expect(checkFormat(b, ' "scarce metals"')).toContain("quotes");
    expect(checkFormat(b, " **scarce** metals")).toEqual(["markdown"]);
    expect(checkFormat(b, " scarce metals. And jobs.")).toEqual(["multi-sentence"]);
    expect(checkFormat(b, " scarce metals, e.g. platinum.")).toEqual([]);
    expect(checkFormat(b, " a b c d e f g h i j k l m n o p")).toEqual(["too-long"]);
    expect(checkFormat(b, " scarce metals\nmore")).toContain("newline");
    expect(checkFormat(b, " <think>")).toContain("reasoning");
    expect(checkFormat("Океан изучен всего на ", "five percent")).toEqual(["language"]);
    expect(checkFormat(b, " редкие металлы")).toEqual(["language"]);
  });
});
