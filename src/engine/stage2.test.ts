import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { APDA } from "../config/formats/apda";
import { DEMO_MINI } from "../config/formats/demo";
import { applyOpsToDoc, readSnapshot, roomMap, cardsMap } from "../sync/doc";
import * as clash from "./clash";
import * as cmd from "./commands";
import { cardDrag, moveCardOps, movePointOps, moveThesisOps, pointDrag, stepSlot, thesisDrag } from "./moves";
import { layoutRows } from "./rows";
import * as timer from "./timer";
import { Sim } from "./testkit";

/**
 * Feature 02 stage 2 (clash) on "Ocean vs Space", we are the Opposition.
 * Same data as the stage-1 tests and e2e/flow.spec.ts.
 */
function prep() {
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
  return { s, t1, t2, t3, a1, a2, a3, a4, a5, a6 };
}

const PM_TEXT = ["Oceans are 95% unexplored", "Climate answers are in the ocean", "Cheaper per discovery", "Food security", "Space race is militarised"];

/** Criteria 3–4: PMC with OC1→PM1, OC2→PM2, OC3→PM3 by Answer, OC4 by "+" then linked to PM5. */
function pmc() {
  const ctx = prep();
  const { s } = ctx;
  s.go("PMC");
  const pm = PM_TEXT.map((t) => s.card("PMC", t));
  const oc1 = s.answer(pm[0], "Unexplored is not more valuable");
  const oc2 = s.answer(pm[1], "Satellites already watch the ocean");
  const oc3 = s.answer(pm[2], "Ignores spin-offs");
  const oc4 = s.card("LOC", "Treaties limit militarisation", { zone: "clash" });
  return { ...ctx, pm, oc: [oc1, oc2, oc3, oc4] };
}

/** Criterion 7: through LOC (said as in stage 1), MG answers OA1, MG2 new, OC5 → MG1, OC6 → PM4. */
function mgmo() {
  const ctx = pmc();
  const { s, pm, oc, a1, a3, a5 } = ctx;
  s.link(oc[3], pm[4]);
  s.go("LOC");
  for (const id of [a1, a3, a5, ...oc]) s.say(id);
  s.go("MG");
  const mg1 = s.answer(a1, "Asteroid mining is decades away");
  const mg2 = s.card("MG", "Earth's problems come first");
  const oc5 = s.answer(mg1, "Decades away is still a payoff");
  const oc6 = s.answer(pm[3], "Food security is solved on land");
  return { ...ctx, mg1, mg2, oc5, oc6 };
}

describe("answer links", () => {
  it("Answer picks the earliest live column of the other side after the target's speech", () => {
    const { s, pm, a1, oc } = pmc();
    // PM1 during PMC → LO's clash zone
    expect(s.card$(oc[0])).toMatchObject({ ownerSpeech: "LOC", zone: "clash", respondsTo: [pm[0]] });
    expect(oc.slice(0, 3).map((id) => s.label(id))).toEqual(["OC1", "OC2", "OC3"]);
    // our OA1 during PMC: MG is not live yet → disabled with a reason
    const blocked = clash.answerPlace(APDA, s.state, a1);
    expect(blocked.ok).toBe(false);
    expect(!blocked.ok && blocked.reason).toMatch(/No live Government column after LOC/);
    s.go("LOC");
    s.say(a1);
    s.go("MG");
    // OA1 during MG → MG; PM4 during MG → MO's clash zone; the same during MO
    expect(clash.answerPlace(APDA, s.state, a1)).toEqual({ ok: true, slot: { speech: "MG", zone: "own", thesisId: null } });
    expect(clash.answerPlace(APDA, s.state, pm[3])).toEqual({ ok: true, slot: { speech: "MO", zone: "clash", thesisId: null } });
    s.go("MO");
    expect(clash.answerPlace(APDA, s.state, pm[3])).toMatchObject({ ok: true, slot: { speech: "MO" } });
    // a PMR card can never be answered by the Opposition
    s.go("PMR");
    const pmr1 = s.card("PMR", "Final weighing");
    const no = clash.answerPlace(APDA, s.state, pmr1);
    expect(!no.ok && no.reason).toMatch(/No Opposition speech comes after PMR/);
  });

  it("Link toggles targets of the other side from earlier speeches only; unlink; delete cleans up", () => {
    const { s, pm, oc, a1 } = pmc();
    const oc4 = oc[3];
    expect(s.card$(oc4).respondsTo).toEqual([]);
    expect(clash.linkTargets(APDA, s.state, oc4)).toEqual(new Set(pm));
    s.link(oc4, pm[4]);
    expect(s.card$(oc4).respondsTo).toEqual([pm[4]]);
    // not eligible: own side, later speech, itself
    expect(s.link(oc4, a1).ops).toEqual([]);
    expect(s.link(pm[0], oc4).ops).toEqual([]);
    expect(s.link(oc4, oc4).ops).toEqual([]);
    // second target, then toggle it off again
    s.link(oc4, pm[1]);
    expect(s.card$(oc4).respondsTo).toEqual([pm[4], pm[1]]);
    s.run(clash.unlinkCard(s.state, oc4, pm[1]));
    expect(s.card$(oc4).respondsTo).toEqual([pm[4]]);
    // deleting a target removes it from every respondsTo
    s.run(cmd.deleteCard(s.state, pm[4]));
    expect(s.card$(oc4).respondsTo).toEqual([]);
  });

  it("Enter on an answer creates the next answer, unlinked", () => {
    const { s, oc } = pmc();
    const r = s.run(cmd.createCardBelow(APDA, s.state, oc[0], s.newId));
    const id = (r.focus as { id: string }).id;
    expect(s.card$(id)).toMatchObject({ zone: "clash", ownerSpeech: "LOC", respondsTo: [] });
  });
});

describe("rows (layoutRows)", () => {
  it("answers sit in their target's row; unlinked cards start new rows; gaps stay empty", () => {
    const { s, pm, oc } = pmc();
    const L = s.rows();
    // PM rows come first (PMC is the first lane), each with its answer beside it
    for (let i = 0; i < 3; i++) expect(L.rowOf.get(oc[i])).toBe(L.rowOf.get(pm[i]));
    // PM4 and PM5 rows have nothing in LO's lane (OC4 is unlinked → its own row after the PM rows)
    expect(L.rows[L.rowOf.get(pm[3])!].cells.get("LOC")).toBeUndefined();
    expect(L.rowOf.get(oc[3])).toBeGreaterThan(L.rowOf.get(pm[4])!);
    expect(s.col("LOC").slice(0, 4)).toEqual(["OC1", "OC2", "OC3", "OC4"]);
    // linking OC4 to PM5 moves it into PM5's row
    s.link(oc[3], pm[4]);
    expect(s.row(oc[3])).toBe(s.row(pm[4]));
    expect(s.rows().rows[s.row(pm[3])].cells.get("LOC")).toBeUndefined();
  });

  it("chains stay in one row: OA1 ← MG1 ← OC5; a skip-lane answer sits in PM4's row; MG2 is a new row", () => {
    const { s, a1, mg1, mg2, oc5, oc6, pm } = mgmo();
    expect(s.row(mg1)).toBe(s.row(a1));
    expect(s.row(oc5)).toBe(s.row(a1));
    expect(s.row(oc6)).toBe(s.row(pm[3]));
    const L = s.rows();
    expect(L.rows[s.row(mg2)].key).toBe(mg2);
    expect(L.rows[s.row(mg2)].origin).toBe("MG");
    // the PM4 row has nothing in LO's or MG's lane: the arrow goes straight across
    expect(L.rows[s.row(pm[3])].cells.get("LOC")).toBeUndefined();
    expect(L.rows[s.row(pm[3])].cells.get("MG")).toBeUndefined();
  });

  it("carried cards keep the row they had in LO", () => {
    const { s, a2, a4, a6, a1, a3 } = pmc();
    s.go("LOC");
    const before = [a1, a2, a3, a4].map((id) => s.row(id));
    expect(before.map((r) => r - before[0])).toEqual([0, 1, 2, 3]);
    for (const id of [a1, a3]) s.say(id);
    s.go("MG"); // OA2, OA4 (and unsaid others) move to MO
    expect(s.card$(a2).ownerSpeech).toBe("MO");
    // same rows relative to LO's cards (locked LO gains an empty "Responses" placeholder above them)
    const after = [a1, a2, a3, a4].map((id) => s.row(id));
    expect(after.map((r) => r - after[0])).toEqual([0, 1, 2, 3]);
    expect(s.rows().rows[s.row(a2)].cells.get("LOC")).toBeUndefined();
    expect(s.rows().rows[s.row(a2)].cells.get("MO")).toEqual([a2]);
    // unsaid answers carried along stay beside their PM targets
    expect(s.col("MO").slice(0, 5)).toEqual(["OC1", "OC2", "OC3", "OC4", "OA2"]);
    expect(a6).toBeTruthy();
  });

  it("two targets: the card stays in its first target's row; the extra target only adds an arrow", () => {
    const { s, pm, oc } = pmc();
    s.link(oc[2], pm[1]); // OC3 answers PM3 and PM2
    expect(s.card$(oc[2]).respondsTo).toEqual([pm[2], pm[1]]);
    expect(s.row(oc[2])).toBe(s.row(pm[2]));
    const b = s.board();
    expect(b.links.filter((l) => l.from === oc[2]).map((l) => l.to)).toEqual([pm[2], pm[1]]);
    expect(b.cards.get(oc[2])!.targetLabels).toEqual(["PM3", "PM2"]);
  });

  it("several answers of one lane in one row stack; the row holds both", () => {
    const { s, pm, oc } = pmc();
    const extra = s.answer(pm[0], "Also: unexplored ≠ valuable");
    const cell = s.rows().rows[s.row(pm[0])].cells.get("LOC");
    expect(cell).toEqual([oc[0], extra]);
  });

  it("live columns renumber when rows reorder; locked numbers never change", () => {
    const { s, pm, oc } = pmc();
    // OC4 (unlinked, below the PM rows) linked to PM1 jumps into PM1's row → it becomes OC2
    s.link(oc[3], pm[0]);
    expect([oc[0], oc[3], oc[1], oc[2]].map((id) => s.label(id))).toEqual(["OC1", "OC2", "OC3", "OC4"]);
    s.run(clash.unlinkCard(s.state, oc[3], pm[0]));
    expect(oc.map((id) => s.label(id))).toEqual(["OC1", "OC2", "OC3", "OC4"]);
    // lock LO (LOC → MG), then reorder rows: locked labels stay
    s.go("LOC");
    s.go("MG");
    s.link(oc[3], pm[0]);
    expect(oc.map((id) => s.label(id))).toEqual(["OC1", "OC2", "OC3", "OC4"]);
  });

  it("MO numbers answers MG first, then what is left from PM (OC5 → MG1, OC6 → PM4)", () => {
    const { s, oc5, oc6 } = mgmo();
    expect(s.label(oc5)).toBe("OC5");
    expect(s.label(oc6)).toBe("OC6");
    // on screen OC6 (PM4's row) is above OC5 (OA1's row)
    expect(s.row(oc6)).toBeLessThan(s.row(oc5));
  });

  it("is deterministic: the same state in any card order gives the same layout", () => {
    const { s } = mgmo();
    const a = layoutRows(APDA, s.state);
    const shuffled = { ...s.state, cards: [...s.state.cards].reverse(), theses: [...s.state.theses].reverse() };
    const b = layoutRows(APDA, shuffled);
    expect(b.rows.map((r) => [r.key, [...r.cells.entries()].sort()])).toEqual(a.rows.map((r) => [r.key, [...r.cells.entries()].sort()]));
    expect([...b.lanes.values()].map((l) => l.cards)).toEqual([...a.lanes.values()].map((l) => l.cards));
  });

  it("lanes: own region with labels, thesis segments, add buttons and gaps like stage 1", () => {
    const { s, t1, t2, t3, a1, a2, a6, oc } = pmc();
    const lo = s.rows().lanes.get("LOC")!;
    expect(lo.labels.map((l) => l.zone)).toEqual(["clash", "own"]);
    expect(lo.segments.map((g) => g.thesisId)).toEqual([t1, t2, t3]);
    expect(lo.segments[0].cards).toEqual([a1, a2]);
    // live: an add button for the clash group and each thesis; the footer after the last thesis
    expect(lo.adds.map((a) => a.group.thesisId)).toEqual([null, t1, t2, t3]);
    expect(lo.footer).toBe(s.row(a6));
    // gaps exist only between cards of the own region: OC4 (unlinked) and the OA cards
    expect(lo.gaps.map((g) => g.cardId)).toEqual([oc[3], a1, a2, ...lo.gaps.slice(3).map((g) => g.cardId)]);
    expect(lo.gaps.find((g) => g.cardId === a2)!.prevId).toBe(a1);
    // an empty live thesis gets a placeholder row with its header and add button
    const t4 = s.thesis("Empty thesis", t3);
    const lo2 = s.rows().lanes.get("LOC")!;
    const seg = lo2.segments.find((g) => g.thesisId === t4)!;
    expect(seg.cards).toEqual([]);
    expect(s.rows().rows[seg.from].slot).toEqual({ speech: "LOC", zone: "own", thesisId: t4 });
  });
});

describe("answered status, counters, unanswered list", () => {
  it("criterion 4: PM4 unanswered, LO counter 'PM answered 4/5', the list holds PM4", () => {
    const { s, pm, oc } = pmc();
    s.link(oc[3], pm[4]);
    const b = s.board();
    expect(b.cards.get(pm[3])!.unanswered).toBe(true);
    expect(b.cards.get(pm[3])!.tone).toBe("unanswered");
    expect(b.cards.get(pm[0])!.tone).toBe("neutral");
    expect(b.columns.find((c) => c.speech.id === "LOC")!.answerCounter!.map((p) => p.text)).toEqual(["PM answered 4/5"]);
    expect(b.unanswered.map((v) => v.label)).toEqual(["PM4"]);
    // answered also counts unsaid answers; our cards are never "unanswered"
    expect(b.cards.get(oc[0])!.status).toBeNull();
  });

  it("criterion 7: MO counter 'MG answered 1/2 · from PM left 0'; the list holds MG2", () => {
    const { s, mg2 } = mgmo();
    const b = s.board();
    expect(b.columns.find((c) => c.speech.id === "MO")!.answerCounter!.map((p) => p.text)).toEqual(["MG answered 1/2", "from PM left 0"]);
    expect(b.unanswered.map((v) => v.card.id)).toEqual([mg2]);
    // LO is locked during MG: no counter
    expect(b.columns.find((c) => c.speech.id === "LOC")!.answerCounter).toBeNull();
  });

  it("PMR cards are unanswerable for the Opposition: never red, never counted", () => {
    const { s } = mgmo();
    s.go("PMR");
    const pmr1 = s.card("PMR", "They dropped the weighing");
    const b = s.board();
    expect(b.status.get(pmr1)).toBe("unanswerable");
    expect(b.cards.get(pmr1)!.unanswered).toBe(false);
    expect(b.unanswered.some((v) => v.card.id === pmr1)).toBe(false);
  });

  it("arrow colour follows the answer card's status", () => {
    const { s, mg1, mg2, oc5, a1 } = mgmo();
    const b = s.board();
    expect(b.links.find((l) => l.from === oc5)!.tone).toBe("ours");
    expect(b.links.find((l) => l.from === mg1 && l.to === a1)!.tone).toBe("neutral"); // MG1 is answered by OC5
    s.link(mg2, a1);
    expect(s.board().links.find((l) => l.from === mg2)!.tone).toBe("red"); // MG2 is unanswered
  });
});

describe("rebuttal highlights (requirement 11)", () => {
  it("criterion 8: in LOR cards said in LOC / MO are green 'said', unsaid are red, links stay", () => {
    const { s, a1, a2, a4, oc5 } = mgmo();
    s.go("MO");
    s.say(oc5);
    s.say(a2);
    s.go("LOR");
    const b = s.board();
    expect(b.cards.get(a1)!).toMatchObject({ saidGreen: true, saidMeta: "said in LOC", tone: "said", struck: false });
    expect(b.cards.get(oc5)!).toMatchObject({ saidGreen: true, saidMeta: "said in MO" });
    expect(b.cards.get(a4)!).toMatchObject({ red: true, saidGreen: false, tone: "red" });
    expect(b.links.length).toBeGreaterThanOrEqual(6);
    // a card said during LOR itself strikes (stage 1) and is not "said in" green
    const or1 = s.card("LOR", "They dropped asteroid mining");
    s.say(or1);
    expect(s.board().cards.get(or1)!).toMatchObject({ struck: true, saidGreen: false });
    // not in PMR (not our rebuttal)
    s.go("PMR");
    expect(s.board().cards.get(a1)!.saidGreen).toBe(false);
  });
});

describe("Government mirror", () => {
  it("criterion 10: GA / GC / GR; LO's cards are red until MG answers them", () => {
    const s = new Sim(APDA, "gov");
    const t1 = s.thesis("The ocean is the nearer frontier");
    const g1 = s.card("PMC", "Oceans are 95% unexplored", { thesis: t1 });
    s.go("PMC");
    s.say(g1);
    s.go("LOC");
    const lo1 = s.card("LOC", "Space pays off long term");
    const lo2 = s.answer(g1, "Unexplored is not more valuable");
    expect([lo1, lo2].map((id) => s.label(id)).sort()).toEqual(["LO1", "LO2"]);
    expect(s.row(lo2)).toBe(s.row(g1));
    let b = s.board();
    expect(b.cards.get(lo1)!.unanswered).toBe(true);
    expect(b.cards.get(lo2)!.unanswered).toBe(true);
    // MG (our column, live during LOC) answers LO2 → GC1 in G1's row (chain GA1 ← LO2 ← GC1)
    const gc1 = s.answer(lo2, "Unexplored means unknown upside");
    expect(s.card$(gc1)).toMatchObject({ ownerSpeech: "MG", zone: "clash" });
    expect(s.label(gc1)).toBe("GC1");
    expect(s.row(gc1)).toBe(s.row(g1));
    b = s.board();
    expect(b.cards.get(lo2)!.unanswered).toBe(false);
    expect(b.cards.get(lo1)!.unanswered).toBe(true);
    expect(b.columns.find((c) => c.speech.id === "MG")!.answerCounter!.map((p) => p.text)).toEqual(["LO answered 1/2"]);
    s.go("PMR");
    const gr1 = s.answer(lo1, "Long term is speculative");
    expect(s.label(gr1)).toBe("GR1");
    expect(s.board().cards.get(lo1)!.unanswered).toBe(false);
  });
});

describe("another format through config only", () => {
  it("criterion 12: the demo format gets rows, links and counters from defaultTargets", () => {
    const s = new Sim(DEMO_MINI, "north");
    s.go("SOUTH");
    const so1 = s.card("SOUTH", "Their opener");
    const so2 = s.card("SOUTH", "Their second");
    const q1 = s.answer(so1, "Our answer");
    expect(s.card$(q1)).toMatchObject({ ownerSpeech: "NORTH", zone: "clash" });
    expect(s.label(q1)).toBe("NQ1");
    expect(s.row(q1)).toBe(s.row(so1));
    const b = s.board();
    expect(b.columns.find((c) => c.speech.id === "NORTH")!.answerCounter!.map((p) => p.text)).toEqual(["SO answered 1/2"]);
    expect(b.unanswered.map((v) => v.card.id)).toEqual([so2]);
    expect(b.links).toEqual([{ from: q1, to: so1, tone: "ours" }]);
  });
});

describe("prep timer (pure)", () => {
  const D = 60_000;
  it("start, pause, +1 min, reset and expiry", () => {
    let t = timer.readPrepTimer(null, D);
    expect(timer.timerRemaining(t, 0)).toBe(D);
    t = timer.startTimer(t, 1000, "r1");
    expect(t.runId).toBe("r1");
    expect(timer.timerRemaining(t, 31_000)).toBe(30_000);
    t = timer.pauseTimer(t, 31_000);
    expect(timer.timerRunning(t, 40_000)).toBe(false);
    expect(timer.timerRemaining(t, 99_000)).toBe(30_000);
    t = timer.addMinute(t, 99_000);
    expect(timer.timerRemaining(t, 99_000)).toBe(90_000);
    t = timer.startTimer(t, 100_000, "r2");
    t = timer.addMinute(t, 100_000);
    expect(timer.timerRemaining(t, 100_000)).toBe(150_000);
    expect(timer.timerExpired(t, 250_000)).toBe(true);
    expect(timer.formatClock(61_000)).toBe("01:01");
    t = timer.resetTimer(D, "r3");
    expect(t).toEqual({ runId: "r3", endsAt: null, remainingMs: D, totalMs: D });
  });

  it("ends prep at most once per run", () => {
    const t = timer.startTimer(timer.readPrepTimer(null, D), 0, "run");
    const base = { isPrep: true, timer: t, advancedRun: null as string | null, now: D - 1, enabled: true };
    expect(timer.shouldAdvance(base)).toBe(false);
    expect(timer.shouldAdvance({ ...base, now: D })).toBe(true);
    expect(timer.shouldAdvance({ ...base, now: D, advancedRun: "run" })).toBe(false); // already done (Undo → Prep stays)
    expect(timer.shouldAdvance({ ...base, now: D, isPrep: false })).toBe(false);
    expect(timer.shouldAdvance({ ...base, now: D, enabled: false })).toBe(false); // prep minutes = 0
    expect(timer.shouldAdvance({ ...base, timer: timer.readPrepTimer(null, D), now: 10 * D })).toBe(false); // never started
  });
});

describe("drag moves", () => {
  it("a card moves inside its lane and between theses; live numbers follow, locked do not", () => {
    const { s, t3, a3, a5, a6 } = prep();
    const d = cardDrag(APDA, s.state, s.rows(), a3)!;
    expect(d.mode).toBe("lane");
    // to the top of thesis 3
    const slot = d.slots.find((x) => x.before === a5)!;
    expect(slot.thesisId).toBe(t3);
    s.run({ ops: moveCardOps(s.state, a3, slot) });
    expect(s.card$(a3).thesisId).toBe(t3);
    expect(s.col("LOC")).toEqual(["OA1", "OA2", "OA3", "OA4", "OA5", "OA6"]);
    expect([a3, a5, a6].map((id) => s.label(id))).toEqual(["OA4", "OA5", "OA6"]);
    // keyboard: Alt+↑ twice walks back over the thesis boundary
    const k = cardDrag(APDA, s.state, s.rows(), a3)!;
    const up = stepSlot(k.current, k.slots.length, -1)!;
    s.run({ ops: moveCardOps(s.state, a3, k.slots[up]) });
    expect(s.label(a3)).toBe("OA4");
    expect(s.card$(a3).thesisId).not.toBe(t3);
  });

  it("locked columns keep their numbers when cards are reordered", () => {
    const { s, a1, a3, a5 } = prep();
    s.go("PMC");
    s.go("LOC");
    for (const id of [a1, a3, a5]) s.say(id); // they stay in LO; the others move to MO
    s.go("MG"); // LO is locked now
    const d = cardDrag(APDA, s.state, s.rows(), a1)!;
    s.run({ ops: moveCardOps(s.state, a1, d.slots[d.slots.length - 1]) }); // OA1 to the end of thesis 3
    expect(s.col("LOC").filter((l) => l.startsWith("OA"))).toEqual(["OA3", "OA5", "OA1"]);
    expect([a1, a3, a5].map((id) => s.label(id))).toEqual(["OA1", "OA3", "OA5"]);
  });

  it("a linked answer moves only inside its row's stack", () => {
    const { s, pm, oc } = pmc();
    const extra = s.answer(pm[0], "Second answer to PM1");
    const d = cardDrag(APDA, s.state, s.rows(), extra)!;
    expect(d.mode).toBe("row");
    expect(d.slots.map((x) => x.before)).toEqual([oc[0], null]);
    s.run({ ops: moveCardOps(s.state, extra, d.slots[0]) });
    expect(s.rows().rows[s.row(pm[0])].cells.get("LOC")).toEqual([extra, oc[0]]);
    expect(s.label(extra)).toBe("OC1");
    expect(stepSlot(0, d.slots.length, -1)).toBeNull();
  });

  it("theses reorder with their cards; points move inside and between cards", () => {
    const { s, t1, t2, a1, a3 } = prep();
    const d = thesisDrag(s.state, t2)!;
    s.run({ ops: moveThesisOps(t2, d.slots.find((x) => x.before === t1)!) });
    expect(s.board().thesisNumbers.get(t2)).toBe(1);
    expect(s.col("LOC").length).toBe(6);
    expect(s.label(a3)).toBe("OA1");
    expect(s.label(a1)).toBe("OA3");
    const p = s.card$(a1).points[1];
    const pd = pointDrag(s.state, s.rows(), a1, p.id)!;
    // up inside the card
    s.run({ ops: movePointOps(s.state, a1, p.id, pd.slots[stepSlot(pd.current, pd.slots.length, -1)!]) });
    expect(s.card$(a1).points.map((x) => x.text)).toEqual(["No seabed damage", "Platinum-group metals"]);
    // into another card (end of OA… a3)
    const pd2 = pointDrag(s.state, s.rows(), a1, p.id)!;
    const slot = pd2.slots.find((x) => x.cardId === a3 && x.index === 1)!;
    s.run({ ops: movePointOps(s.state, a1, p.id, slot) });
    expect(s.card$(a3).points.map((x) => x.text)).toEqual(["Sea-level data comes from orbit", "No seabed damage"]);
    expect(s.card$(a1).points.map((x) => x.text)).toEqual(["Platinum-group metals"]);
  });
});

describe("sync: respondsTo is a Y.Array", () => {
  it("two devices linking the same card at once keep both targets; old plain arrays still load", () => {
    const { s, pm, oc } = pmc();
    const a = new Y.Doc();
    roomMap(a).set("side", "opp");
    applyOpsToDoc(a, "opp", s.state.cards.map((card) => ({ t: "card.create", card }) as const));
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    applyOpsToDoc(a, "opp", [{ t: "card.link", id: oc[3], target: pm[4] }]);
    applyOpsToDoc(b, "opp", [{ t: "card.link", id: oc[3], target: pm[3] }]);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const ra = readSnapshot(a).flow.cards.find((c) => c.id === oc[3])!.respondsTo;
    const rb = readSnapshot(b).flow.cards.find((c) => c.id === oc[3])!.respondsTo;
    expect(new Set(ra)).toEqual(new Set([pm[4], pm[3]]));
    expect(ra).toEqual(rb); // same order on both devices
    // a stage-1 room stored a plain array
    cardsMap(a, "opp").get(oc[0])!.set("respondsTo", [pm[0]]);
    expect(readSnapshot(a).flow.cards.find((c) => c.id === oc[0])!.respondsTo).toEqual([pm[0]]);
    applyOpsToDoc(a, "opp", [{ t: "card.link", id: oc[0], target: pm[1] }]);
    expect(cardsMap(a, "opp").get(oc[0])!.get("respondsTo")).toBeInstanceOf(Y.Array);
    expect(readSnapshot(a).flow.cards.find((c) => c.id === oc[0])!.respondsTo).toEqual([pm[0], pm[1]]);
  });
});
