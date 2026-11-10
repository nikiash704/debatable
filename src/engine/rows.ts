import type { FormatConfig, SpeechConfig, SpeechId } from "../config/types";
import { byOrder, thesesOf } from "./order";
import { columnState, effectiveZone, hasTheses, speechIndex, zonesFor } from "./stages";
import type { Card, FlowState, Zone } from "./types";

/**
 * Rows ("строки-нити", spec 02 stage 2): the board is a set of rows shared by all lanes, so an answer
 * sits beside what it answers, like the team's Excel flow.
 *
 * 1. A card with a visible target goes in the row of its first target (top-aligned); chains stay in one
 *    row: PM1 ← OC1 ← MG2 ← OC5. A target is visible when it exists and lives in an earlier lane.
 * 2. Every other card starts a new row. Rows are ordered by their starting card: by lane (speech order),
 *    then by that lane's stage-1 order (clash zone, then own zone by thesis, then `order`). A card carried
 *    from LO to MO counts as an LO card here, so it keeps the row it had in LO.
 * 3. Several cards of one lane in one row stack inside it (stage-1 order).
 * 4. A lane with nothing in a row leaves the space empty: the visible "not answered here" cue.
 * 5. Extra targets never move a card; they only add arrows.
 * 6. Theses keep their header and left line over the rows of their cards ("segments").
 *
 * Each lane therefore reads top to bottom as: cards in rows started by earlier lanes (answers next to
 * their targets, carried cards in their old rows), then its own region (rows started by its own cards),
 * which looks exactly like a stage-1 column: zone labels, theses, "+" gaps and "+ Add …" buttons.
 * Live groups with no cards get a placeholder row so their header and add button have a place.
 *
 * Pure and deterministic: both devices compute the same board from the same state.
 */

export interface GroupKey {
  speech: SpeechId;
  zone: Zone;
  thesisId: string | null;
}

export interface LayoutRow {
  index: number;
  /** Starting card id, or `slot:<speech>:<zone>:<thesis>` for a placeholder row. */
  key: string;
  /** Lane whose card (or empty group) started this row. */
  origin: SpeechId;
  /** Card ids per lane, in stack order. */
  cells: Map<SpeechId, string[]>;
  /** Placeholder row: the empty group of `origin` it holds. */
  slot: GroupKey | null;
}

export interface Segment {
  thesisId: string;
  from: number;
  to: number;
  cards: string[];
}

export interface LaneGap {
  /** Insert before this card… */
  cardId: string;
  /** …which is the first card of its group (gap-before-X) or follows `prevId` (gap-after-prev). */
  prevId: string | null;
  group: GroupKey;
}

export interface LaneLayout {
  speech: SpeechId;
  /** Cards top to bottom (visual order; ↑/↓ follow it). */
  cards: string[];
  /** First row of the lane's own region, or null when it has none. */
  ownFrom: number | null;
  segments: Segment[];
  /** Zone label ("Responses" / "Arguments") above a row of the own region (two-zone lanes only). */
  labels: { zone: Zone; row: number }[];
  /** "+ Add …" button at the end of the lane's cell in `row`. */
  adds: { row: number; group: GroupKey }[];
  /** Row whose cell ends with "+ Argument" / "+ Thesis" (live lanes with theses). */
  footer: number | null;
  /** "+" insert gaps between cards of the own region. */
  gaps: LaneGap[];
}

export interface RowLayout {
  rows: LayoutRow[];
  rowOf: Map<string, number>;
  /** Position of a card inside its cell's stack. */
  stackIndex: Map<string, number>;
  /** The card whose row a card follows (its first visible target), or null for row starters. */
  parent: Map<string, string | null>;
  /** Lane the card's row ordering counts it in: `carriedFrom` for carried cards, else its own lane. */
  origin: Map<string, SpeechId>;
  lanes: Map<SpeechId, LaneLayout>;
}

type SortKey = [number, number, number, string, string];

function cmpKey(a: SortKey, b: SortKey): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

export function layoutRows(f: FormatConfig, state: FlowState): RowLayout {
  const persp = state.perspective;
  const speeches = new Map(f.speeches.map((s) => [s.id, s]));
  const lane = (id: string) => speechIndex(f, id);
  const cards = state.cards.filter((c) => speeches.has(c.ownerSpeech));
  const byId = new Map(cards.map((c) => [c.id, c]));
  const theses = thesesOf(state, persp);
  const tRank = new Map(theses.map((t, i) => [t.id, i]));
  const knownThesis = (c: Card) => !!c.thesisId && tRank.has(c.thesisId);

  /** [zone rank, thesis rank] of a card inside a lane's stage-1 order. */
  const rankIn = (c: Card, sp: SpeechConfig): [number, number] => {
    const zones = zonesFor(persp, sp);
    const zone = effectiveZone(persp, sp, c);
    const zr = zones.indexOf(zone);
    const tr = hasTheses(state, sp, zone) ? (knownThesis(c) ? tRank.get(c.thesisId!)! : theses.length) : 0;
    return [zr, tr];
  };

  const originOf = (c: Card): SpeechId =>
    c.carriedFrom && speeches.has(c.carriedFrom) && lane(c.carriedFrom) < lane(c.ownerSpeech) ? c.carriedFrom : c.ownerSpeech;

  // 1. Row parent = first visible target (exists, other side, earlier lane). Lanes strictly decrease
  //    along a chain, so there are no cycles.
  const parent = new Map<string, string | null>();
  for (const c of cards) {
    let p: string | null = null;
    for (const t of c.respondsTo) {
      const tc = byId.get(t);
      if (tc && tc.id !== c.id && tc.side !== c.side && lane(tc.ownerSpeech) < lane(c.ownerSpeech)) {
        p = tc.id;
        break;
      }
    }
    parent.set(c.id, p);
  }
  const rootCache = new Map<string, string>();
  const rootOf = (id: string): string => {
    const hit = rootCache.get(id);
    if (hit) return hit;
    const p = parent.get(id);
    const r = p ? rootOf(p) : id;
    rootCache.set(id, r);
    return r;
  };

  const origin = new Map<string, SpeechId>();
  for (const c of cards) origin.set(c.id, originOf(c));

  // 2. Row starters and placeholder rows, sorted.
  type Entry = { key: SortKey; id: string; origin: SpeechId; slot: GroupKey | null };
  const entries: Entry[] = [];
  for (const c of cards) {
    if (parent.get(c.id)) continue;
    const o = origin.get(c.id)!;
    const [zr, tr] = rankIn(c, speeches.get(o)!);
    entries.push({ key: [lane(o), zr, tr, c.order, c.id], id: c.id, origin: o, slot: null });
  }

  // Own-region starters per lane (lane cards whose row starts in that lane), grouped.
  const groupId = (g: GroupKey) => `${g.speech}|${g.zone}|${g.thesisId ?? ""}`;
  const groupOfCard = (c: Card, sp: SpeechConfig): GroupKey => {
    const zone = effectiveZone(persp, sp, c);
    return { speech: sp.id, zone, thesisId: hasTheses(state, sp, zone) && knownThesis(c) ? c.thesisId : null };
  };
  const ownStarters = new Map<SpeechId, Card[]>();
  for (const c of cards) {
    if (parent.get(c.id) || origin.get(c.id) !== c.ownerSpeech) continue;
    const list = ownStarters.get(c.ownerSpeech) ?? [];
    list.push(c);
    ownStarters.set(c.ownerSpeech, list);
  }

  // Placeholders for empty groups (only where stage 1 shows an empty group: flat groups of open lanes,
  // theses of live lanes, and the own zone of a live lane with no theses and no cards).
  const slotFor = (sp: SpeechConfig, zone: Zone, thesisId: string | null, tr: number): Entry => {
    const zr = zonesFor(persp, sp).indexOf(zone);
    const g: GroupKey = { speech: sp.id, zone, thesisId };
    return { key: [lane(sp.id), zr, tr, "", `slot:${groupId(g)}`], id: `slot:${groupId(g)}`, origin: sp.id, slot: g };
  };
  for (const sp of f.speeches) {
    const st = columnState(f, persp, sp, state.stage);
    if (st === "future") continue;
    const mine = ownStarters.get(sp.id) ?? [];
    const has = new Set(mine.map((c) => groupId(groupOfCard(c, sp))));
    for (const zone of zonesFor(persp, sp)) {
      if (hasTheses(state, sp, zone)) {
        if (st !== "live") continue;
        theses.forEach((t, i) => {
          if (!has.has(groupId({ speech: sp.id, zone, thesisId: t.id }))) entries.push(slotFor(sp, zone, t.id, i));
        });
        const anyInZone = mine.some((c) => effectiveZone(persp, sp, c) === zone);
        if (!theses.length && !anyInZone) entries.push(slotFor(sp, zone, null, theses.length));
      } else if (!has.has(groupId({ speech: sp.id, zone, thesisId: null }))) {
        entries.push(slotFor(sp, zone, null, 0));
      }
    }
  }
  entries.sort((a, b) => cmpKey(a.key, b.key));

  const rows: LayoutRow[] = entries.map((e, i) => ({ index: i, key: e.id, origin: e.origin, cells: new Map(), slot: e.slot }));
  const starterRow = new Map(entries.map((e, i) => [e.id, i]));

  // 3. Every card joins the row of its root; stacks follow the lane's stage-1 order.
  const rowOf = new Map<string, number>();
  for (const c of cards) {
    const r = starterRow.get(rootOf(c.id))!;
    rowOf.set(c.id, r);
    const cell = rows[r].cells.get(c.ownerSpeech) ?? [];
    cell.push(c.id);
    rows[r].cells.set(c.ownerSpeech, cell);
  }
  const stackIndex = new Map<string, number>();
  for (const row of rows) {
    for (const [sid, ids] of row.cells) {
      const sp = speeches.get(sid)!;
      ids.sort((a, b) => {
        const ca = byId.get(a)!;
        const cb = byId.get(b)!;
        const ra = rankIn(ca, sp);
        const rb = rankIn(cb, sp);
        return ra[0] - rb[0] || ra[1] - rb[1] || byOrder(ca, cb);
      });
      ids.forEach((id, i) => stackIndex.set(id, i));
    }
  }

  // 4. Per-lane view: visual order, own region, labels, theses, add buttons, gaps.
  const lanes = new Map<SpeechId, LaneLayout>();
  for (const sp of f.speeches) {
    const st = columnState(f, persp, sp, state.stage);
    const laneCards = cards
      .filter((c) => c.ownerSpeech === sp.id)
      .sort((a, b) => rowOf.get(a.id)! - rowOf.get(b.id)! || stackIndex.get(a.id)! - stackIndex.get(b.id)!)
      .map((c) => c.id);

    // own-region entries in row order: lane starters (origin = this lane) and placeholders
    const own: { row: number; card: Card | null; group: GroupKey }[] = [];
    rows.forEach((row) => {
      if (row.origin !== sp.id) return;
      if (row.slot) {
        own.push({ row: row.index, card: null, group: row.slot });
        return;
      }
      const c = byId.get(row.key);
      if (c && c.ownerSpeech === sp.id) own.push({ row: row.index, card: c, group: groupOfCard(c, sp) });
    });

    const zones = zonesFor(persp, sp);
    const labels: LaneLayout["labels"] = [];
    if (zones.length > 1) {
      for (const zone of zones) {
        const first = own.find((e) => e.group.zone === zone);
        if (first) labels.push({ zone, row: first.row });
      }
    }

    const adds: LaneLayout["adds"] = [];
    const gaps: LaneGap[] = [];
    let footer: number | null = null;
    if (st !== "future") {
      const seen = new Map<string, { last: number; prev: string | null; count: number; g: GroupKey; slot: boolean }>();
      for (const e of own) {
        const k = groupId(e.group);
        const s = seen.get(k) ?? { last: e.row, prev: null, count: 0, g: e.group, slot: !e.card };
        if (e.card) {
          gaps.push({ cardId: e.card.id, prevId: s.prev, group: e.group });
          s.prev = e.card.id;
          s.count++;
          s.slot = false;
        }
        s.last = e.row;
        seen.set(k, s);
      }
      for (const s of seen.values()) {
        const ownEmpty = s.slot && s.g.thesisId === null && hasTheses(state, sp, s.g.zone);
        if (ownEmpty) continue; // "+ Argument / + Thesis" footer instead
        if (st === "live" || s.count === 0) adds.push({ row: s.last, group: s.g });
      }
      if (st === "live") {
        for (const zone of zones) {
          if (!hasTheses(state, sp, zone)) continue;
          const inZone = own.filter((e) => e.group.zone === zone);
          if (inZone.length) footer = inZone[inZone.length - 1].row;
        }
      }
    }

    // thesis segments: runs of consecutive lane cards of one thesis, plus empty theses (placeholders)
    const segments: Segment[] = [];
    let cur: Segment | null = null;
    for (const id of laneCards) {
      const c = byId.get(id)!;
      const zone = effectiveZone(persp, sp, c);
      const t = hasTheses(state, sp, zone) && knownThesis(c) ? c.thesisId! : null;
      if (t && cur && cur.thesisId === t) {
        cur.to = rowOf.get(id)!;
        cur.cards.push(id);
        continue;
      }
      cur = t ? { thesisId: t, from: rowOf.get(id)!, to: rowOf.get(id)!, cards: [id] } : null;
      if (cur) segments.push(cur);
    }
    for (const e of own) {
      if (!e.card && e.group.thesisId) segments.push({ thesisId: e.group.thesisId, from: e.row, to: e.row, cards: [] });
    }
    segments.sort((a, b) => a.from - b.from);

    lanes.set(sp.id, {
      speech: sp.id,
      cards: laneCards,
      ownFrom: own.length ? own[0].row : null,
      segments,
      labels,
      adds,
      footer,
      gaps,
    });
  }

  return { rows, rowOf, stackIndex, parent, origin, lanes };
}

/** Index of a speech in a lane's `defaultTargets` (answers are numbered MG first, then PM…), else last. */
function targetRank(sp: SpeechConfig, layout: RowLayout, state: FlowState, c: Card): number {
  const p = layout.parent.get(c.id);
  const target = p ? state.cards.find((x) => x.id === p) : null;
  const i = target ? sp.defaultTargets.indexOf(target.ownerSpeech) : -1;
  return i < 0 ? sp.defaultTargets.length : i;
}

/**
 * Order in which a lane's live numbers are given: clash zone first (as in stage 1), grouped by the
 * answered speech in the lane's `defaultTargets` order (MO: MG answers, then what is left from PM —
 * spec 02 stage 2), each group top to bottom; then the own zone top to bottom.
 */
export function numberingOrder(f: FormatConfig, state: FlowState, layout: RowLayout, speechId: SpeechId): Card[] {
  const sp = f.speeches.find((s) => s.id === speechId);
  const ln = layout.lanes.get(speechId);
  if (!sp || !ln) return [];
  const byId = new Map(state.cards.map((c) => [c.id, c]));
  const zones = zonesFor(state.perspective, sp);
  const ours = sp.side === state.perspective;
  const pos = new Map(ln.cards.map((id, i) => [id, i]));
  return ln.cards
    .map((id) => byId.get(id)!)
    .sort((a, b) => {
      const za = zones.indexOf(effectiveZone(state.perspective, sp, a));
      const zb = zones.indexOf(effectiveZone(state.perspective, sp, b));
      if (za !== zb) return za - zb;
      const clash = ours && effectiveZone(state.perspective, sp, a) === "clash";
      if (clash) {
        const d = targetRank(sp, layout, state, a) - targetRank(sp, layout, state, b);
        if (d) return d;
      }
      return pos.get(a.id)! - pos.get(b.id)!;
    });
}
