import type { FormatConfig } from "../types";

/**
 * A made-up mini format (hidden). It exists to prove that a different format is only config:
 * other sides, speeches, series letters and stage names, with no engine or UI changes.
 * Used by the end-to-end test for spec 02 criterion 10.
 */
export const DEMO_MINI: FormatConfig = {
  id: "demo-mini",
  name: "Demo mini format",
  short: "MINI",
  hidden: true,
  prepMinutes: 5,
  graceSeconds: 0,
  prepStage: { id: "warmup", label: "Warm-up" },
  reviewStage: { id: "debrief", label: "Debrief" },
  sides: [
    { id: "north", label: "North", short: "N", prefix: "N", members: [{ id: "N1", name: "North first" }, { id: "N2", name: "North second" }] },
    { id: "south", label: "South", short: "S", prefix: "S", members: [{ id: "S1", name: "South first" }] },
  ],
  speeches: [
    { id: "SOUTH", label: "SOUTH", title: "South opening", side: "south", speaker: "S1", minutes: 3, allowsNew: true, prefixSeries: { own: "X" }, opponentLabel: "SO", carriesTo: null, liveFrom: "warmup", defaultTargets: [] },
    { id: "NORTH", label: "NORTH", title: "North opening", side: "north", speaker: "N1", minutes: 3, allowsNew: true, prefixSeries: { clash: "Q", own: "P" }, opponentLabel: "NO", carriesTo: null, liveFrom: "warmup", defaultTargets: ["SOUTH"] },
    { id: "NSUM", label: "N-SUM", title: "North summary", side: "north", speaker: "N2", minutes: 2, allowsNew: false, prefixSeries: { clash: "Z" }, opponentLabel: "NS", carriesTo: null, liveFrom: "NSUM", defaultTargets: [] },
  ],
  tags: [
    { type: "turn", label: "Turn", hotkey: "T" },
    { type: "poo", label: "POO", hotkey: "P", rebuttalOnly: true, tone: "alert" },
  ],
  defaults: { side: "north", role: { north: "N1", south: "S1" } },
};
