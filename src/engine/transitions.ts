import type { FormatConfig, StageId } from "../config/types";
import { computeNumbers } from "./numbering";
import { applyOps, type Op } from "./ops";
import { speechById, stageAt, stageIndex } from "./stages";
import type { FlowState } from "./types";

/**
 * Stage changes (spec 02 «Поведение по стадиям»), one step at a time:
 *
 * Forward, when speech S ends:
 *  1. numbers of S's column are locked (snapshot of the live numbers);
 *  2. if S is ours and has `carriesTo`, its unsaid cards move there, keeping number and thesis,
 *     with `carriedFrom = S` ("from LO").
 * Backward, when we return into speech S: the exact reverse (cards carried from S come back,
 * S's own numbers become live again). Everything else (strike-throughs cleared in rebuttals,
 * red "new — don't say", POO) is derived from the stage, so it reverts by itself.
 */
export function planStageChange(f: FormatConfig, state: FlowState, target: StageId): Op[] {
  const goal = stageIndex(f, target);
  let s = state;
  const ops: Op[] = [];
  let guard = 0;
  while (stageIndex(f, s.stage) !== goal && guard++ < 100) {
    const step = stageIndex(f, s.stage) < goal ? forwardStep(f, s) : backwardStep(f, s);
    ops.push(...step);
    s = applyOps(s, step);
  }
  return ops;
}

export function nextStage(f: FormatConfig, stage: StageId): StageId {
  return stageAt(f, stageIndex(f, stage) + 1);
}

export function prevStage(f: FormatConfig, stage: StageId): StageId {
  return stageAt(f, stageIndex(f, stage) - 1);
}

function forwardStep(f: FormatConfig, s: FlowState): Op[] {
  const ops: Op[] = [];
  const ending = speechById(f, s.stage);
  if (ending) {
    const numbers = computeNumbers(f, s);
    for (const c of s.cards) {
      if (c.ownerSpeech === ending.id && !c.numberLocked) {
        ops.push({ t: "card.update", id: c.id, patch: { numberLocked: true, displayNumber: numbers.get(c.id) ?? null } });
      }
    }
    if (ending.carriesTo && ending.side === s.perspective && speechById(f, ending.carriesTo)) {
      for (const c of s.cards) {
        if (c.ownerSpeech === ending.id && c.side === s.perspective && !c.saidIn) {
          ops.push({ t: "card.update", id: c.id, patch: { ownerSpeech: ending.carriesTo, carriedFrom: ending.id } });
        }
      }
    }
  }
  ops.push({ t: "stage.set", stage: nextStage(f, s.stage) });
  return ops;
}

function backwardStep(f: FormatConfig, s: FlowState): Op[] {
  const ops: Op[] = [];
  const back = prevStage(f, s.stage);
  const reopened = speechById(f, back);
  if (reopened) {
    for (const c of s.cards) {
      if (c.carriedFrom === reopened.id) {
        ops.push({ t: "card.update", id: c.id, patch: { ownerSpeech: reopened.id, carriedFrom: null, numberLocked: false } });
      } else if (c.ownerSpeech === reopened.id && !c.carriedFrom && c.numberLocked) {
        ops.push({ t: "card.update", id: c.id, patch: { numberLocked: false } });
      }
    }
  }
  ops.push({ t: "stage.set", stage: back });
  return ops;
}
