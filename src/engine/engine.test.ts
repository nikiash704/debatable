import { describe, expect, it } from "vitest";
import { APDA } from "../config/formats/apda";
import type { FormatConfig } from "../config/types";
import * as cmd from "./commands";
import { stagesOf } from "./stages";
import { Sim } from "./testkit";

/**
 * Round "Ocean vs Space" (spec 02 acceptance criteria), we are the Opposition.
 * Motion: THW prioritise ocean exploration over space exploration.
 */
function oceanPrep() {
  const s = new Sim(APDA, "opp");
  const t1 = s.thesis("Space is the bigger long-term payoff");
  const t2 = s.thesis("Space tech already pays off on Earth", t1);
  const t3 = s.thesis("Ocean exploration harms what it studies", t2);
  const a1 = s.card("LOC", "Asteroid mining unlocks scarce metals", { thesis: t1, points: ["Platinum-group metals", "No seabed damage"] });
  const a3 = s.card("LOC", "Satellites run climate monitoring", { thesis: t2, points: ["Sea-level data comes from orbit"] });
  const a4 = s.card("LOC", "Spin-offs: GPS, solar cells, water filters", { thesis: t2, points: ["Everyday tech"] });
  const a5 = s.card("LOC", "Deep-sea mining destroys ecosystems", { thesis: t3, points: ["Plumes travel hundreds of km"] });
  const a6 = s.card("LOC", "Ocean research is already funded", { thesis: t3, points: ["Private and military money"] });
  return { s, t1, t2, t3, a1, a3, a4, a5, a6 };
}

describe("format config", () => {
  it("APDA stages come from the config", () => {
    expect(stagesOf(APDA).map((x) => x.label)).toEqual(["Prep", "PMC", "LOC", "MG", "MO", "LOR", "PMR", "Review"]);
  });
});

describe("numbering (live and locked)", () => {
  it("criterion 1: prep — 3 theses, OA1–OA6 with points; inserting in the middle renumbers in order", () => {
    const { s, t1, a1, a3, a4, a5, a6 } = oceanPrep();
    expect(s.col("LOC")).toEqual(["OA1", "OA2", "OA3", "OA4", "OA5"]);
    // insert "Planetary backup" between OA1 and the thesis-2 cards (end of thesis 1)
    const a2 = s.card("LOC", "Planetary backup for humanity", { thesis: t1, after: a1, points: ["Extinction-level risks"] });
    expect(s.col("LOC")).toEqual(["OA1", "OA2", "OA3", "OA4", "OA5", "OA6"]);
    expect([a1, a2, a3, a4, a5, a6].map((id) => s.label(id))).toEqual(["OA1", "OA2", "OA3", "OA4", "OA5", "OA6"]);
    expect(s.board().thesisNumbers.get(t1)).toBe(1);
    expect(s.board().cards.get(a1)!.pointLabels).toEqual(["1a", "1b"]);
    // and in the very middle of a thesis
    const mid = s.card("LOC", "temp", { thesis: t1, before: a2 });
    expect(s.label(mid)).toBe("OA2");
    expect(s.label(a6)).toBe("OA7");
    s.run(cmd.deleteCard(s.state, mid));
    expect(s.label(a6)).toBe("OA6");
  });

  it("criterion 2: PM1–PM5 and OC1–OC4; LO numbers stay live through PMC and LOC", () => {
    const { s, a1 } = oceanPrep();
    s.go("PMC");
    const pmIds = ["Oceans are 95% unexplored", "Climate answers are in the ocean", "Cheaper per discovery", "Food security", "Space race is militarised"].map(
      (t) => s.card("PMC", t),
    );
    expect(s.col("PMC")).toEqual(["PM1", "PM2", "PM3", "PM4", "PM5"]);
    expect(pmIds).toHaveLength(5);
    const oc = ["Unexplored ≠ more valuable", "Satellites already watch the ocean", "Ignores spin-offs", "Treaties limit militarisation"].map((t) =>
      s.card("LOC", t, { zone: "clash" }),
    );
    expect(oc.map((id) => s.label(id))).toEqual(["OC1", "OC2", "OC3", "OC4"]);
    s.go("LOC");
    // PM column locked at PMC → LOC; LO still live: inserting a response renumbers
    expect(s.board().columns.find((c) => c.speech.id === "PMC")!.state).toBe("locked");
    expect(s.board().columns.find((c) => c.speech.id === "LOC")!.state).toBe("live");
    const extra = s.card("LOC", "extra", { zone: "clash", atStart: true });
    expect(s.label(extra)).toBe("OC1");
    expect(s.label(oc[3])).toBe("OC5");
    s.run(cmd.deleteCard(s.state, extra));
    expect(s.label(oc[3])).toBe("OC4");
    // OA cards are unaffected by OC inserts
    expect(s.label(a1)).toBe("OA1");
  });

  it("locked numbers do not change on insert/delete; a late card gets the next number", () => {
    const { s } = oceanPrep();
    s.go("PMC");
    const pm = [1, 2, 3].map((i) => s.card("PMC", `pm ${i}`));
    s.go("LOC");
    s.run(cmd.deleteCard(s.state, pm[0]));
    expect(pm.slice(1).map((id) => s.label(id))).toEqual(["PM2", "PM3"]);
    const late = s.card("PMC", "forgot this one", { atStart: true });
    expect(s.label(late)).toBe("PM4");
    expect(s.card$(late).numberLocked).toBe(true);
  });
});

function oceanThroughLOC() {
  const ctx = oceanPrep();
  const { s, t1, a1 } = ctx;
  const a2 = s.card("LOC", "Planetary backup for humanity", { thesis: t1, after: a1 });
  s.go("PMC");
  const pm = ["Oceans are 95% unexplored", "Climate answers are in the ocean", "Cheaper per discovery", "Food security", "Space race is militarised"].map(
    (t) => s.card("PMC", t),
  );
  const oc = ["Unexplored ≠ more valuable", "Satellites already watch the ocean", "Ignores spin-offs", "Treaties limit militarisation"].map((t) =>
    s.card("LOC", t, { zone: "clash" }),
  );
  s.go("LOC");
  return { ...ctx, a2, pm, oc };
}

describe("speech mode, counter and carry-over", () => {
  it("criterion 3: said strikes the card; counter said 7 / 10", () => {
    const { s, a1, a3, a5, oc } = oceanThroughLOC();
    for (const id of [a1, a3, a5, ...oc]) s.say(id);
    const b = s.board();
    expect(b.cards.get(a1)!.struck).toBe(true);
    expect(b.columns.find((c) => c.speech.id === "LOC")!.counter).toEqual({ said: 7, total: 10 });
    // toggling again un-says
    s.say(a1);
    expect(s.board().cards.get(a1)!.struck).toBe(false);
    s.say(a1);
    expect(s.card$(a1).saidIn).toBe("LOC");
  });

  it("criterion 4: LOC → MG locks LO numbers and moves unsaid OA2, OA4, OA6 to MO with 'from LO'", () => {
    const { s, t1, t2, t3, a1, a2, a3, a4, a5, a6, oc } = oceanThroughLOC();
    for (const id of [a1, a3, a5, ...oc]) s.say(id);
    s.go("MG");
    for (const id of [a1, a2, a3, a4, a5, a6, ...oc]) expect(s.card$(id).numberLocked).toBe(true);
    expect(s.col("LOC")).toEqual(["OC1", "OC2", "OC3", "OC4", "OA1", "OA3", "OA5"]);
    expect(s.col("MO")).toEqual(["OA2", "OA4", "OA6"]);
    const b = s.board();
    for (const id of [a2, a4, a6]) {
      expect(b.cards.get(id)!.fromLabel).toBe("from LO");
      expect(s.card$(id).ownerSpeech).toBe("MO");
      expect(s.card$(id).carriedFrom).toBe("LOC");
    }
    expect([a2, a4, a6].map((id) => s.card$(id).thesisId)).toEqual([t1, t2, t3]);
    // inserting into the (locked) LO column does not renumber
    const late = s.card("LOC", "late", { thesis: t1, atStart: true });
    expect(s.label(a1)).toBe("OA1");
    expect(s.label(late)).toBe("OA7");
  });

  it("criterion 5: in MO a new response is OC5 and a new own argument OA7; strike + counter work", () => {
    const { s, t1, a1, a2, a3, a5, oc } = oceanThroughLOC();
    for (const id of [a1, a3, a5, ...oc]) s.say(id);
    s.go("MG");
    const mg1 = s.card("MG", "Asteroid mining is decades away");
    s.card("MG", "Earth's problems come first");
    expect(s.col("MG")).toEqual(["MG1", "MG2"]);
    const oc5 = s.card("MO", "Decades away is still a payoff", { zone: "clash" });
    const oa7 = s.card("MO", "Space inspires STEM careers", { thesis: t1 });
    expect(s.label(oc5)).toBe("OC5");
    expect(s.label(oa7)).toBe("OA7");
    expect(s.board().columns.find((c) => c.speech.id === "MO")!.state).toBe("live");
    s.go("MO");
    s.say(oc5);
    s.say(a2);
    const b = s.board();
    expect(b.cards.get(oc5)!.struck).toBe(true);
    expect(b.cards.get(a2)!.label).toBe("OA2");
    expect(b.columns.find((c) => c.speech.id === "MO")!.counter).toEqual({ said: 2, total: 5 });
    expect(mg1).toBeTruthy();
  });
});

describe("rebuttals", () => {
  function toLOR() {
    const ctx = oceanThroughLOC();
    const { s, t1, a1, a2, a3, a5, oc } = ctx;
    for (const id of [a1, a3, a5, ...oc]) s.say(id);
    s.go("MG");
    s.card("MG", "Asteroid mining is decades away");
    const oc5 = s.card("MO", "Decades away is still a payoff", { zone: "clash" });
    const oa7 = s.card("MO", "Space inspires STEM careers", { thesis: t1 });
    s.go("MO");
    s.say(oc5);
    s.say(a2);
    s.go("LOR");
    return { ...ctx, oc5, oa7 };
  }

  it("criterion 6: strikes cleared, unsaid cards red, POO available, OR numbers renumber on insert", () => {
    const { s, a1, a2, a4, a6, oc5, oa7 } = toLOR();
    const b = s.board();
    expect(b.cards.get(a1)!.struck).toBe(false);
    expect(s.card$(a1).saidIn).toBe("LOC"); // data kept
    expect(b.cards.get(a2)!.struck).toBe(false);
    for (const id of [a4, a6, oa7]) expect(b.cards.get(id)!.red).toBe(true);
    for (const id of [a1, a2, oc5]) expect(b.cards.get(id)!.red).toBe(false);
    expect(b.pooAvailable).toBe(true);
    const r1 = s.card("LOR", "They dropped asteroid mining");
    const r2 = s.card("LOR", "Weigh: long term beats short term");
    expect([r1, r2].map((id) => s.label(id))).toEqual(["OR1", "OR2"]);
    const r0 = s.card("LOR", "Opening crystallisation", { atStart: true });
    expect([r0, r1, r2].map((id) => s.label(id))).toEqual(["OR1", "OR2", "OR3"]);
    expect(s.board().cards.get(r0)!.red).toBe(false);
    // MO's numbers locked at MO → LOR
    expect(s.card$(oc5).numberLocked).toBe(true);
  });

  it("POO only in rebuttals", () => {
    const { s } = oceanPrep();
    s.go("PMC");
    const pm1 = s.card("PMC", "Oceans are unexplored");
    expect(s.tag(pm1, "poo").ops).toHaveLength(0);
    expect(cmd.tagAvailable(APDA, s.state, "poo")).toBe(false);
    s.go("LOC");
    expect(s.tag(pm1, "poo").ops).toHaveLength(0);
    s.go("LOR");
    expect(cmd.tagAvailable(APDA, s.state, "poo")).toBe(true);
    s.tag(pm1, "poo");
    expect(s.card$(pm1).tags).toEqual([{ type: "poo" }]);
    s.go("PMR");
    expect(cmd.tagAvailable(APDA, s.state, "poo")).toBe(true);
    s.go("review");
    expect(cmd.tagAvailable(APDA, s.state, "poo")).toBe(false);
  });

  it("no red for the Opposition during PMR", () => {
    const { s, a4 } = toLOR();
    expect(s.board().cards.get(a4)!.red).toBe(true);
    s.go("PMR");
    expect(s.board().cards.get(a4)!.red).toBe(false);
  });

  it("going back reverses carry-over and locks", () => {
    const { s, a2, a4, a6, a1 } = oceanThroughLOC();
    s.say(a1);
    s.go("MG");
    expect(s.card$(a2).ownerSpeech).toBe("MO");
    s.go("LOC");
    for (const id of [a2, a4, a6]) {
      expect(s.card$(id).ownerSpeech).toBe("LOC");
      expect(s.card$(id).carriedFrom).toBeNull();
      expect(s.card$(id).numberLocked).toBe(false);
    }
    expect(s.col("LOC").filter((l) => l.startsWith("OA"))).toEqual(["OA1", "OA2", "OA3", "OA4", "OA5", "OA6"]);
    // jump forward several stages at once
    s.go("LOR");
    expect(s.board().stage).toBe("LOR");
    expect(s.card$(a2).ownerSpeech).toBe("MO");
  });
});

describe("tags", () => {
  it("same-as / contradicts reference a card by id and show its current number; deleting the target cleans up", () => {
    const { s } = oceanPrep();
    s.go("PMC");
    const pm1 = s.card("PMC", "Oceans are unexplored");
    const pm2 = s.card("PMC", "We know nothing about the deep sea");
    s.tag(pm2, "same-as", pm1);
    expect(s.card$(pm2).tags).toEqual([{ type: "same-as", refCardId: pm1 }]);
    s.tag(pm2, "same-as", pm1); // same ref again removes
    expect(s.card$(pm2).tags).toEqual([]);
    s.tag(pm2, "contradicts", pm1);
    s.tag(pm2, "no-warrant");
    s.tag(pm2, "turn");
    expect(s.card$(pm2).tags.map((t) => t.type)).toEqual(["contradicts", "no-warrant", "turn"]);
    s.tag(pm2, "turn");
    expect(s.card$(pm2).tags.map((t) => t.type)).toEqual(["contradicts", "no-warrant"]);
    s.run(cmd.deleteCard(s.state, pm1));
    expect(s.card$(pm2).tags.map((t) => t.type)).toEqual(["no-warrant"]);
    s.run(cmd.toggleStrong(s.state, pm2));
    expect(s.card$(pm2).strong).toBe(true);
  });
});

describe("levels (Tab / Shift+Tab)", () => {
  it("card → point of the card above, point → card, card → thesis, thesis → card", () => {
    const s = new Sim(APDA, "opp");
    const t1 = s.thesis("Space pays");
    const a = s.card("LOC", "Mining", { thesis: t1 });
    const b = s.card("LOC", "Rare metals", { thesis: t1 });
    const c = s.card("LOC", "Backup planet", { thesis: t1 });
    // Tab on b: b becomes a point of a
    s.run(cmd.indentCard(APDA, s.state, b, s.newId));
    expect(s.card$(a).points.map((p) => p.text)).toEqual(["Rare metals"]);
    expect(s.col("LOC")).toEqual(["OA1", "OA2"]);
    // Shift+Tab on that point: back to a card right after a
    const pid = s.card$(a).points[0].id;
    s.run(cmd.outdentPoint(APDA, s.state, a, pid, s.newId));
    expect(s.state.cards.filter((x) => x.thesisId === t1).length).toBe(3);
    expect(s.board().columns.find((x) => x.speech.id === "LOC")!.order.map((x) => x.card.text)).toEqual(["Mining", "Rare metals", "Backup planet"]);
    // Shift+Tab on c: becomes thesis 2
    const r = s.run(cmd.outdentCard(APDA, s.state, c, s.newId));
    const t2 = (r.focus as { id: string }).id;
    expect(s.state.theses.find((t) => t.id === t2)!.title).toBe("Backup planet");
    expect(s.board().thesisNumbers.get(t2)).toBe(2);
    const d = s.card("LOC", "Extinction risk", { thesis: t2 });
    // Tab on thesis 2: its title becomes a card in thesis 1, its cards follow
    s.run(cmd.indentThesis(APDA, s.state, t2, "LOC", s.newId));
    expect(s.state.theses).toHaveLength(1);
    expect(s.card$(d).thesisId).toBe(t1);
    expect(s.board().columns.find((x) => x.speech.id === "LOC")!.order.map((x) => x.card.text)).toEqual([
      "Mining",
      "Rare metals",
      "Backup planet",
      "Extinction risk",
    ]);
  });
});

describe("Government mirror", () => {
  it("criterion 7: the same round for the Government gives GA / GC / GR", () => {
    const s = new Sim(APDA, "gov");
    const t1 = s.thesis("The ocean is the nearer frontier");
    const g1 = s.card("PMC", "Oceans are 95% unexplored", { thesis: t1 });
    const g2 = s.card("PMC", "Climate answers are in the ocean", { thesis: t1 });
    const g3 = s.card("PMC", "Cheaper per discovery", { thesis: t1 });
    expect(s.col("PMC")).toEqual(["GA1", "GA2", "GA3"]);
    // PMC has no clash zone (nothing to answer yet)
    expect(s.board().columns.find((c) => c.speech.id === "PMC")!.zones.map((z) => z.zone)).toEqual(["own"]);
    s.go("PMC");
    s.say(g1);
    s.say(g3);
    s.go("LOC");
    // unsaid PM card goes to MG
    expect(s.card$(g2).ownerSpeech).toBe("MG");
    expect(s.board().cards.get(g2)!.fromLabel).toBe("from PM");
    const lo1 = s.card("LOC", "Space pays off long term");
    expect(s.label(lo1)).toBe("LO1");
    const gc1 = s.card("MG", "Long term is speculative", { zone: "clash" });
    expect(s.label(gc1)).toBe("GC1");
    s.go("MG");
    const ga4 = s.card("MG", "Food security", { thesis: t1 });
    expect(s.label(ga4)).toBe("GA4");
    s.say(gc1);
    s.go("MO");
    expect(s.label(s.card("MO", "STEM inspiration"))).toBe("MO1");
    s.go("LOR");
    const lor1 = s.card("LOR", "New: tourism argument");
    expect(s.label(lor1)).toBe("LOR1");
    // no red for the Government during LOR (not our rebuttal)
    expect(s.board().cards.get(g2)!.red).toBe(false);
    s.go("PMR");
    const gr1 = s.card("PMR", "Answer to MO's new STEM point");
    expect(s.label(gr1)).toBe("GR1");
    const b = s.board();
    expect(b.cards.get(gr1)!.red).toBe(false);
    expect(b.cards.get(g2)!.red).toBe(true);
    expect(b.cards.get(ga4)!.red).toBe(true);
    expect(b.cards.get(g1)!.red).toBe(false);
    expect(b.cards.get(gc1)!.red).toBe(false);
    expect(b.pooAvailable).toBe(true);
  });
});

/** A made-up format with different sides, speeches and stage names — no engine changes. */
const FAKE: FormatConfig = {
  id: "fake",
  name: "Fake test format",
  short: "FAKE",
  prepMinutes: 0,
  graceSeconds: 0,
  prepStage: { id: "warmup", label: "Warm-up" },
  reviewStage: { id: "debrief", label: "Debrief" },
  sides: [
    { id: "north", label: "North", short: "N", prefix: "N", members: [{ id: "N1", name: "North first" }, { id: "N2", name: "North second" }] },
    { id: "south", label: "South", short: "S", prefix: "S", members: [{ id: "S1", name: "South first" }, { id: "S2", name: "South second" }] },
  ],
  speeches: [
    { id: "s1", label: "S-OPEN", title: "South opening", side: "south", speaker: "S1", minutes: 3, allowsNew: true, prefixSeries: { own: "X" }, opponentLabel: "SO", carriesTo: "s3", liveFrom: "warmup", defaultTargets: [] },
    { id: "n1", label: "N-OPEN", title: "North opening", side: "north", speaker: "N1", minutes: 3, allowsNew: true, prefixSeries: { clash: "Q", own: "P" }, opponentLabel: "NO", carriesTo: "n2", liveFrom: "warmup", defaultTargets: ["s1"] },
    { id: "s3", label: "S-MID", title: "South middle", side: "south", speaker: "S2", minutes: 3, allowsNew: true, prefixSeries: { clash: "Y", own: "X" }, opponentLabel: "SM", carriesTo: null, liveFrom: "n1", defaultTargets: ["n1"] },
    { id: "n2", label: "N-MID", title: "North middle", side: "north", speaker: "N2", minutes: 3, allowsNew: true, prefixSeries: { clash: "Q", own: "P" }, opponentLabel: "NM", carriesTo: null, liveFrom: "s3", defaultTargets: ["s3"] },
    { id: "n9", label: "N-END", title: "North summary", side: "north", speaker: "N1", minutes: 2, allowsNew: false, prefixSeries: { clash: "Z" }, opponentLabel: "NE", carriesTo: null, liveFrom: "n9", defaultTargets: [] },
  ],
  tags: [
    { type: "turn", label: "Turn", hotkey: "T" },
    { type: "poo", label: "POO", hotkey: "P", rebuttalOnly: true, tone: "alert" },
  ],
  defaults: { side: "north", role: { north: "N1", south: "S1" } },
};

describe("a different format through config only", () => {
  it("criterion 10: stages, columns, series, carry-over and red follow the fake config", () => {
    const s = new Sim(FAKE, "north");
    expect(stagesOf(FAKE).map((x) => x.label)).toEqual(["Warm-up", "S-OPEN", "N-OPEN", "S-MID", "N-MID", "N-END", "Debrief"]);
    expect(s.board().columns.map((c) => c.speech.label)).toEqual(["S-OPEN", "N-OPEN", "S-MID", "N-MID", "N-END"]);
    expect(s.board().columns.map((c) => c.state)).toEqual(["future", "live", "future", "future", "future"]);
    const t = s.thesis("Main line");
    const p1 = s.card("n1", "First", { thesis: t });
    const p2 = s.card("n1", "Second", { thesis: t });
    expect([p1, p2].map((id) => s.label(id))).toEqual(["NP1", "NP2"]);
    s.go("s1");
    const so1 = s.card("s1", "Their opener");
    expect(s.label(so1)).toBe("SO1");
    const q1 = s.card("n1", "Answer", { zone: "clash" });
    expect(s.label(q1)).toBe("NQ1");
    s.go("n1");
    s.say(p1);
    s.go("s3");
    expect(s.card$(p2).ownerSpeech).toBe("n2");
    expect(s.card$(q1).ownerSpeech).toBe("n2");
    expect(s.board().cards.get(p2)!.fromLabel).toBe("from N1");
    s.go("n2");
    expect(s.label(s.card("n2", "New answer", { zone: "clash" }))).toBe("NQ2");
    expect(s.label(s.card("n2", "New arg", { thesis: t }))).toBe("NP3");
    s.go("n9");
    const b = s.board();
    expect(b.cards.get(p2)!.red).toBe(true);
    expect(b.cards.get(p1)!.red).toBe(false);
    expect(b.pooAvailable).toBe(true);
    expect(s.label(s.card("n9", "Summary"))).toBe("NZ1");
    expect(b.steps.find((x) => x.state === "current")!.label).toBe("N-END");
  });
});
