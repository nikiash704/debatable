import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { APDA } from "../../config/formats/apda";
import { Sim } from "../../engine/testkit";
import type { FlowState } from "../../engine/types";
import { SUGGEST_LIMITS } from "../../shared/suggest";
import { applyOpsToDoc, motionText, readSnapshot, setRoomField } from "../../sync/doc";
import { buildSuggestInput, clip, suggestFromSession, type SuggestSource } from "./context";

/**
 * Phase 1d of docs/plans/ai-suggestions.md: the context each round field sends to /api/suggest,
 * on "Ocean vs Space" (we are the Opposition). Same data as e2e/ocean.ts and the engine tests.
 */
const MOTION = "THW prioritise ocean exploration over space exploration";
const ROOM = "OCEAN1";
const PM_TEXT = ["Oceans are 95% unexplored", "Climate answers are in the ocean", "Cheaper per discovery", "Food security", "Space race is militarised"];

/** Prep → PMC (OC1→PM1, OC2→PM2, OC3→PM3, OC4→PM5) → LOC → MG (MG1→OA1, MG2) with OC5→MG1, OC6→PM4. */
function ocean() {
  const s = new Sim(APDA, "opp");
  const t1 = s.thesis("Space is the bigger long-term payoff");
  const t2 = s.thesis("Space tech already pays off on Earth", t1);
  const t3 = s.thesis("Ocean exploration harms what it studies", t2);
  const a1 = s.card("LOC", "Asteroid mining unlocks scarce metals", { thesis: t1, points: ["Platinum-group metals", "No seabed damage"] });
  const a2 = s.card("LOC", "Planetary backup for humanity", { thesis: t1, points: ["Extinction-level risks"] });
  const a3 = s.card("LOC", "Satellites run climate monitoring", { thesis: t2, points: ["Sea-level data comes from orbit"] });
  const a4 = s.card("LOC", "Spin-offs: GPS, solar cells, water filters", { thesis: t2, points: ["Everyday tech"] });
  const a5 = s.card("LOC", "Deep-sea mining destroys ecosystems", { thesis: t3, points: ["Plumes travel hundreds of km"] });
  const a6 = s.card("LOC", "Ocean research is already funded", { thesis: t3, points: ["Private and military money"] });
  s.go("PMC");
  const pm = PM_TEXT.map((t) => s.card("PMC", t));
  const oc1 = s.answer(pm[0], "Unexplored is not more valuable");
  const oc2 = s.answer(pm[1], "Satellites already watch the ocean");
  const oc3 = s.answer(pm[2], "Ignores spin-offs");
  const oc4 = s.card("LOC", "Treaties limit militarisation", { zone: "clash" });
  s.link(oc4, pm[4]);
  s.go("LOC");
  for (const id of [a1, a3, a5, oc1, oc2, oc3, oc4]) s.say(id);
  s.go("MG");
  const mg1 = s.answer(a1, "Asteroid mining is decades away");
  const mg2 = s.card("MG", "Earth's problems come first");
  const oc5 = s.answer(mg1, "Decades away is still a payoff");
  const oc6 = s.answer(pm[3], "Food security is solved on land");
  const src = (flow: FlowState = s.state, motion = MOTION): SuggestSource => ({ room: ROOM, format: APDA, flow, motion });
  return { s, src, t1, t2, t3, a1, a2, a3, a4, a5, a6, pm, oc1, oc2, oc3, oc4, mg1, mg2, oc5, oc6 };
}

describe("suggest context: each field kind on the Ocean board", () => {
  it("motion: format and side only (the motion is the text being typed)", () => {
    const o = ocean();
    expect(buildSuggestInput(o.src(), { kind: "motion" })).toEqual({ room: ROOM, field: "motion", context: { format: "apda", side: "opp" } });
  });

  it("thesis title: the column's speech, the motion and the other theses", () => {
    const o = ocean();
    expect(buildSuggestInput(o.src(), { kind: "thesis", id: o.t2, speech: "LOC" })).toEqual({
      room: ROOM,
      field: "thesis",
      context: {
        format: "apda",
        side: "opp",
        speech: "LOC",
        motion: MOTION,
        siblings: ["Space is the bigger long-term payoff", "Ocean exploration harms what it studies"],
      },
    });
  });

  it("our card: speech, thesis, nearby arguments of the same column (not itself), then nearby responses", () => {
    const o = ocean();
    // after the LOC, the unsaid OA2 / OA4 / OA6 were carried to the MO: LOC keeps OA1, OA3, OA5 + OC1–OC4
    expect(buildSuggestInput(o.src(), { kind: "card", id: o.a1 })).toEqual({
      room: ROOM,
      field: "card",
      context: {
        format: "apda",
        side: "opp",
        speech: "LOC",
        motion: MOTION,
        thesis: "Space is the bigger long-term payoff",
        siblings: ["Ignores spin-offs", "Treaties limit militarisation", "Satellites run climate monitoring", "Deep-sea mining destroys ecosystems"],
      },
    });
    // in the MO: the other carried arguments, then the MO responses (in on-screen order)
    expect(buildSuggestInput(o.src(), { kind: "card", id: o.a4 })!.context).toMatchObject({
      speech: "MO",
      thesis: "Space tech already pays off on Earth",
      siblings: ["Food security is solved on land", "Decades away is still a payoff", "Planetary backup for humanity", "Ocean research is already funded"],
    });
  });

  it("point: its card, thesis, the card's other points first", () => {
    const o = ocean();
    const pt = o.s.card$(o.a1).points[1]; // "No seabed damage"
    const r = buildSuggestInput(o.src(), { kind: "point", cardId: o.a1, pointId: pt.id });
    expect(r).toEqual({
      room: ROOM,
      field: "point",
      context: {
        format: "apda",
        side: "opp",
        speech: "LOC",
        motion: MOTION,
        thesis: "Space is the bigger long-term payoff",
        card: "Asteroid mining unlocks scarce metals",
        siblings: ["Platinum-group metals", "Ignores spin-offs", "Treaties limit militarisation", "Satellites run climate monitoring"],
      },
    });
    expect(r!.context.siblings).not.toContain("No seabed damage");
  });

  it("answer card (respondsTo): the text of the card it answers, nearby responses first", () => {
    const o = ocean();
    expect(buildSuggestInput(o.src(), { kind: "card", id: o.oc1 })).toEqual({
      room: ROOM,
      field: "card",
      context: {
        format: "apda",
        side: "opp",
        speech: "LOC",
        motion: MOTION,
        answers: ["Oceans are 95% unexplored"],
        siblings: ["Satellites already watch the ocean", "Ignores spin-offs", "Treaties limit militarisation", "Asteroid mining unlocks scarce metals"],
      },
    });
    // linked after creation with "+" then L
    expect(buildSuggestInput(o.src(), { kind: "card", id: o.oc4 })!.context.answers).toEqual(["Space race is militarised"]);
    // MO answers MG1, which itself answers OA1
    const oc5 = buildSuggestInput(o.src(), { kind: "card", id: o.oc5 })!;
    expect(oc5.context.speech).toBe("MO");
    expect(oc5.context.answers).toEqual(["Asteroid mining is decades away"]);
    // the opponent's MG1 (written down on our flow) answers our OA1
    expect(buildSuggestInput(o.src(), { kind: "card", id: o.mg1 })!.context).toMatchObject({ speech: "MG", answers: ["Asteroid mining unlocks scarce metals"] });
  });

  it("point of an answer card carries the card's answers too", () => {
    const o = ocean();
    o.s.run({ ops: [{ t: "point.insert", cardId: o.oc5, index: 0, point: { id: "p-oc5", text: "" } }] });
    expect(buildSuggestInput(o.src(), { kind: "point", cardId: o.oc5, pointId: "p-oc5" })!.context).toMatchObject({
      speech: "MO",
      card: "Decades away is still a payoff",
      answers: ["Asteroid mining is decades away"],
    });
  });

  it("opponent card: the opponent's speech label, siblings from that column", () => {
    const o = ocean();
    expect(buildSuggestInput(o.src(), { kind: "card", id: o.pm[2] })!.context).toEqual({
      format: "apda",
      side: "opp",
      speech: "PMC",
      motion: MOTION,
      siblings: ["Oceans are 95% unexplored", "Climate answers are in the ocean", "Food security", "Space race is militarised"],
    });
  });

  it("Doc view lines: doc-thesis / doc-card / doc-point with the same context as the board", () => {
    const o = ocean();
    const pt = o.s.card$(o.a3).points[0];
    const doc = (t: Parameters<typeof buildSuggestInput>[1]) => buildSuggestInput(o.src(), t, { doc: true });
    const board = (t: Parameters<typeof buildSuggestInput>[1]) => buildSuggestInput(o.src(), t);
    expect(doc({ kind: "card", id: o.a3 })).toEqual({ ...board({ kind: "card", id: o.a3 }), field: "doc-card" });
    expect(doc({ kind: "point", cardId: o.a3, pointId: pt.id })).toEqual({ ...board({ kind: "point", cardId: o.a3, pointId: pt.id }), field: "doc-point" });
    // no column given (Doc view): the thesis takes its cards' column
    expect(doc({ kind: "thesis", id: o.t3 })).toEqual({ ...board({ kind: "thesis", id: o.t3, speech: "LOC" }), field: "doc-thesis" });
  });

  it("empty thesis without a column: our live arguments column; empty values are omitted", () => {
    const s = new Sim(APDA, "opp");
    const t = s.thesis("");
    const r = buildSuggestInput({ room: ROOM, format: APDA, flow: s.state, motion: "  " }, { kind: "thesis", id: t }, { doc: true });
    expect(r).toEqual({ room: ROOM, field: "doc-thesis", context: { format: "apda", side: "opp", speech: "LOC" } });
  });

  it("a field that no longer exists gives null", () => {
    const o = ocean();
    expect(buildSuggestInput(o.src(), { kind: "card", id: "gone" })).toBeNull();
    expect(buildSuggestInput(o.src(), { kind: "point", cardId: o.a1, pointId: "gone" })).toBeNull();
    expect(buildSuggestInput(o.src(), { kind: "thesis", id: "gone" })).toBeNull();
  });
});

describe("suggest context: limits", () => {
  it("clip collapses whitespace and caps at contextItem with an ellipsis", () => {
    expect(clip("  Food \n security  ")).toBe("Food security");
    const long = "x".repeat(SUGGEST_LIMITS.contextItem + 50);
    const c = clip(long);
    expect(c.length).toBe(SUGGEST_LIMITS.contextItem);
    expect(c.endsWith("…")).toBe(true);
    expect(clip("x".repeat(SUGGEST_LIMITS.contextItem))).toBe("x".repeat(SUGGEST_LIMITS.contextItem));
    // never half of a surrogate pair at the cut
    const emoji = `${"x".repeat(SUGGEST_LIMITS.contextItem - 2)}😀😀😀`;
    expect(clip(emoji)).not.toMatch(/[\uD800-\uDBFF]…$/);
  });

  it("every string is truncated and every list capped", () => {
    const o = ocean();
    const big = (t: string) => `${t} ${"very ".repeat(100)}long`;
    const flow: FlowState = {
      ...o.s.state,
      theses: o.s.state.theses.map((t) => ({ ...t, title: big(t.title) })),
      cards: o.s.state.cards.map((c) => ({
        ...c,
        text: big(c.text),
        // OC5 answers every Gov card (more than the list cap)
        respondsTo: c.id === o.oc5 ? o.s.state.cards.filter((x) => x.side === "gov").map((x) => x.id) : c.respondsTo,
      })),
    };
    expect(o.s.state.cards.filter((x) => x.side === "gov").length).toBeGreaterThan(SUGGEST_LIMITS.listItems);
    const all = [
      buildSuggestInput(o.src(flow, big(MOTION)), { kind: "card", id: o.oc5 })!,
      buildSuggestInput(o.src(flow, big(MOTION)), { kind: "point", cardId: o.a1, pointId: o.s.card$(o.a1).points[0].id })!,
      buildSuggestInput(o.src(flow, big(MOTION)), { kind: "thesis", id: o.t1, speech: "LOC" })!,
    ];
    expect(all[0].context.answers).toHaveLength(SUGGEST_LIMITS.listItems);
    for (const r of all) {
      const c = r.context;
      for (const v of [c.format, c.side, c.speech, c.motion, c.thesis, c.card, ...(c.answers ?? []), ...(c.siblings ?? [])]) {
        if (v !== undefined) expect(v.length).toBeLessThanOrEqual(SUGGEST_LIMITS.contextItem);
      }
      expect((c.answers ?? []).length).toBeLessThanOrEqual(SUGGEST_LIMITS.listItems);
      expect((c.siblings ?? []).length).toBeLessThanOrEqual(SUGGEST_LIMITS.listItems);
      expect(c.motion!.endsWith("…")).toBe(true);
    }
    expect(all[1].context.card!.endsWith("…")).toBe(true);
    expect(JSON.stringify({ ...all[0], before: "x".repeat(SUGGEST_LIMITS.before), device: "d" }).length).toBeLessThan(SUGGEST_LIMITS.body);
  });

  it("empty cards are never siblings", () => {
    const s = new Sim(APDA, "opp");
    const t = s.thesis("Space is the bigger long-term payoff");
    const a = s.card("LOC", "Asteroid mining unlocks scarce metals", { thesis: t });
    s.card("LOC", "", { thesis: t });
    s.card("LOC", "   ", { thesis: t });
    const b = s.card("LOC", "", { thesis: t });
    const r = buildSuggestInput({ room: ROOM, format: APDA, flow: s.state, motion: MOTION }, { kind: "card", id: b })!;
    expect(r.context.siblings).toEqual(["Asteroid mining unlocks scarce metals"]);
    expect(buildSuggestInput({ room: ROOM, format: APDA, flow: s.state, motion: MOTION }, { kind: "card", id: a })!.context.siblings).toBeUndefined();
  });
});

describe("suggestFromSession: lazy getter on the room document", () => {
  it("reads the session's state when called, not when created", () => {
    const o = ocean();
    const doc = new Y.Doc();
    setRoomField(doc, "side", "opp");
    applyOpsToDoc(doc, "opp", [
      ...o.s.state.theses.map((thesis) => ({ t: "thesis.create" as const, thesis })),
      ...o.s.state.cards.map((card) => ({ t: "card.create" as const, card })),
      { t: "stage.set", stage: o.s.state.stage },
    ]);
    const session = { code: ROOM, getSnapshot: () => readSnapshot(doc) };
    const getter = () => suggestFromSession(session, { kind: "card", id: o.oc1 });

    expect(getter()).toEqual(buildSuggestInput(o.src(o.s.state, ""), { kind: "card", id: o.oc1 }));
    motionText(doc).insert(0, MOTION);
    expect(getter()).toEqual(buildSuggestInput(o.src(), { kind: "card", id: o.oc1 }));
    expect(suggestFromSession(session, { kind: "motion" })).toEqual({ room: ROOM, field: "motion", context: { format: "apda", side: "opp" } });
    applyOpsToDoc(doc, "opp", [{ t: "card.delete", id: o.oc1 }]);
    expect(getter()).toBeNull();
  });
});
