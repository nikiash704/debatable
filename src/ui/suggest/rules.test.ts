import { describe, expect, it } from "vitest";
import {
  cacheKey,
  caretAtEnd,
  cleanGhost,
  countWords,
  currentSentence,
  endsSentence,
  ghostFor,
  isAcceptKey,
  isDismissKey,
  MAX_GHOST,
  shouldSuggest,
  trimBefore,
} from "./rules";
import type { SuggestRequest } from "../../shared/suggest";

const key = (k: string, mods: Partial<{ shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean; isComposing: boolean }> = {}) => ({
  key: k,
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  ...mods,
});

describe("currentSentence", () => {
  it("is the text after the last sentence end or newline", () => {
    expect(currentSentence("Ocean is close. Space is far")).toBe(" Space is far");
    expect(currentSentence("First line\nsecond line here")).toBe("second line here");
    expect(currentSentence("Why? Because it is")).toBe(" Because it is");
    expect(currentSentence("No end yet")).toBe("No end yet");
  });
  it("does not split inside numbers", () => {
    expect(currentSentence("Costs 3.5 billion a year")).toBe("Costs 3.5 billion a year");
  });
});

describe("shouldSuggest", () => {
  it("needs at least minWords in the current sentence", () => {
    expect(shouldSuggest("Ocean exploration", 3)).toBe(false);
    expect(shouldSuggest("Ocean exploration is", 3)).toBe(true);
    expect(shouldSuggest("Ocean exploration is cheaper. Space", 3)).toBe(false);
    expect(shouldSuggest("Ocean exploration is cheaper. Space is far", 3)).toBe(true);
  });
  it("not after a finished sentence, an empty line or blank text", () => {
    expect(shouldSuggest("Ocean exploration is cheaper.", 3)).toBe(false);
    expect(shouldSuggest("Is ocean exploration cheaper?  ", 3)).toBe(false);
    expect(shouldSuggest("We must act now!", 3)).toBe(false);
    expect(shouldSuggest("Ocean exploration is cheaper\n", 3)).toBe(false);
    expect(shouldSuggest("   ", 3)).toBe(false);
    expect(shouldSuggest("", 3)).toBe(false);
  });
  it("uses the config default", () => {
    expect(shouldSuggest("one two three four five")).toBe(true);
  });
});

describe("endsSentence / countWords", () => {
  it("sees closing quotes and brackets", () => {
    expect(endsSentence('He said "no."')).toBe(true);
    expect(endsSentence("(see above.)")).toBe(true);
    expect(endsSentence("e.g")).toBe(false);
  });
  it("counts words across any whitespace", () => {
    expect(countWords("  a  b\tc ")).toBe(3);
    expect(countWords("")).toBe(0);
  });
});

describe("trimBefore", () => {
  it("keeps the end of the text", () => {
    expect(trimBefore("abcdef", 3)).toBe("def");
    expect(trimBefore("abc", 3)).toBe("abc");
    expect(trimBefore("x".repeat(700)).length).toBe(600);
  });
  it("never starts with half a surrogate pair", () => {
    expect(trimBefore("a😀bc", 3)).toBe("bc");
  });
});

describe("cleanGhost", () => {
  it("keeps leading space, drops trailing space and later lines", () => {
    expect(cleanGhost(" cheaper than space.  ")).toBe(" cheaper than space.");
    expect(cleanGhost("first line\nsecond")).toBe("first line");
  });
  it("is empty for blanks and non-strings", () => {
    expect(cleanGhost("   ")).toBe("");
    expect(cleanGhost(undefined)).toBe("");
    expect(cleanGhost(42)).toBe("");
  });
  it("caps the length", () => {
    expect(cleanGhost("a".repeat(1000)).length).toBe(MAX_GHOST);
  });
});

describe("ghostFor (type-through)", () => {
  const base = "Ocean exploration is";
  const full = " cheaper than space.";
  it("shows the whole ghost when nothing was typed", () => {
    expect(ghostFor(base, full, base)).toBe(full);
  });
  it("keeps the rest while the user types the ghost's letters", () => {
    expect(ghostFor(base, full, base + " ch")).toBe("eaper than space.");
    expect(ghostFor(base, full, base + " cheaper than space")).toBe(".");
  });
  it("comes back when typed-through letters are deleted", () => {
    expect(ghostFor(base, full, base + " c")).toBe("heaper than space.");
    expect(ghostFor(base, full, base)).toBe(full);
  });
  it("is gone when the user types something else, deletes before the base, or typed it all", () => {
    expect(ghostFor(base, full, base + " x")).toBe("");
    expect(ghostFor(base, full, base + " C")).toBe("");
    expect(ghostFor(base, full, "Ocean exploration i")).toBe("");
    expect(ghostFor(base, full, base + full)).toBe("");
    expect(ghostFor(base, "", base)).toBe("");
  });
});

describe("keys", () => {
  it("→ without modifiers accepts", () => {
    expect(isAcceptKey(key("ArrowRight"))).toBe(true);
    expect(isAcceptKey(key("ArrowRight", { shiftKey: true }))).toBe(false);
    expect(isAcceptKey(key("ArrowRight", { altKey: true }))).toBe(false);
    expect(isAcceptKey(key("ArrowRight", { ctrlKey: true }))).toBe(false);
    expect(isAcceptKey(key("ArrowRight", { metaKey: true }))).toBe(false);
    expect(isAcceptKey(key("ArrowRight", { isComposing: true }))).toBe(false);
    expect(isAcceptKey(key("Tab"))).toBe(false);
    expect(isAcceptKey(key("ArrowLeft"))).toBe(false);
  });
  it("Esc, Enter and Tab dismiss; letters and arrows do not", () => {
    for (const k of ["Escape", "Enter", "Tab"]) expect(isDismissKey(key(k))).toBe(true);
    for (const k of ["a", "ArrowLeft", "Shift", "Backspace"]) expect(isDismissKey(key(k))).toBe(false);
  });
});

describe("caretAtEnd", () => {
  it("only a collapsed caret after the last character", () => {
    expect(caretAtEnd("abc", 3, 3)).toBe(true);
    expect(caretAtEnd("abc", 2, 2)).toBe(false);
    expect(caretAtEnd("abc", 0, 3)).toBe(false);
    expect(caretAtEnd("", 0, 0)).toBe(true);
  });
});

describe("cacheKey", () => {
  const req: SuggestRequest = {
    room: "ABCDE",
    device: "dev-1",
    field: "card",
    before: "Ocean exploration is",
    context: { format: "apda", side: "gov", speech: "PMC" },
  };
  it("ignores the device, depends on room, field, context and text", () => {
    expect(cacheKey({ ...req, device: "dev-2" })).toBe(cacheKey(req));
    expect(cacheKey({ ...req, before: "Ocean exploration was" })).not.toBe(cacheKey(req));
    expect(cacheKey({ ...req, field: "point" })).not.toBe(cacheKey(req));
    expect(cacheKey({ ...req, room: "ZZZZZ" })).not.toBe(cacheKey(req));
    expect(cacheKey({ ...req, context: { ...req.context, speech: "LOC" } })).not.toBe(cacheKey(req));
  });
});
