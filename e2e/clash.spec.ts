import { expect, test, type Page } from "@playwright/test";
import { card, lane, laneLabels, newDevice, openNewRoom, openRoom, showView, typeAndEscape, waitSynced } from "./helpers";
import { OUTLINE, prepInDoc } from "./ocean";

/**
 * Feature 02, stage 2 (clash) — acceptance criteria 1–13 on "Ocean vs Space" (we are the Opposition
 * unless a test says otherwise). Same data as e2e/flow.spec.ts.
 */

const OA = ["OA1", "OA2", "OA3", "OA4", "OA5", "OA6"];

async function stage(page: Page) {
  return page.getByTestId("stagebar").getAttribute("data-stage");
}

test("criterion 1: Doc prep — the outline is the board's data; a partner on the Board sees it live", async ({ browser }) => {
  const a = await newDevice(browser);
  const b = await newDevice(browser);
  const code = await openNewRoom(a.page, { view: "doc" });
  // a new round is in Prep and opens in the Doc view
  await expect(a.page.getByTestId("doc-view")).toBeVisible();
  await expect(a.page.getByTestId("view-doc")).toHaveAttribute("aria-checked", "true");
  await waitSynced(a.page);
  await openRoom(b.page, code, { view: "board" });
  await waitSynced(b.page);

  await prepInDoc(a.page);
  await expect(a.page.getByTestId("doc-thesis")).toHaveCount(3);
  await expect(a.page.getByTestId("doc-label")).toHaveText(OA);
  await expect(a.page.getByTestId("doc-point")).toHaveCount(7);
  await expect(a.page.locator('[data-testid="doc-thesis"] .doc__marker')).toHaveText(["1.", "2.", "3."]);
  await expect(a.page.locator('[data-testid="doc-card"] .doc__marker')).toHaveText(["a.", "b.", "a.", "b.", "a.", "b."]);

  // the partner's Board shows the same 3 theses and OA1–OA6 with points, live
  await expect.poll(() => laneLabels(b.page, "LOC")).toEqual(OA);
  await expect(lane(b.page, "LOC").getByTestId("thesis-title")).toHaveText(OUTLINE.map((t) => t.thesis));
  await expect(card(b.page, "OA1")).toContainText("Asteroid mining unlocks scarce metals");
  await expect(card(b.page, "OA1").getByTestId("card-more")).toHaveText("•2");
  await expect(card(b.page, "OA6")).toContainText("Ocean research is already funded");

  // the partner edits on the board; it shows in the doc at once
  await card(b.page, "OA2").dblclick();
  await b.page.keyboard.press("End");
  await typeAndEscape(b.page, " (long term)");
  await expect(a.page.locator('[data-doc-key] textarea').nth(4)).toHaveValue("Planetary backup for humanity (long term)");

  // Enter in the middle of a line splits it; Backspace on an empty line removes it
  const point = a.page.locator('[data-testid="doc-point"] textarea').first();
  await point.click();
  await a.page.keyboard.press("End");
  await a.page.keyboard.press("Enter");
  await expect(a.page.getByTestId("doc-point")).toHaveCount(8);
  await a.page.keyboard.press("Backspace");
  await expect(a.page.getByTestId("doc-point")).toHaveCount(7);

  // switching views loses nothing
  await showView(a.page, "board");
  expect(await laneLabels(a.page, "LOC")).toEqual(OA);
  await expect(card(a.page, "OA2")).toContainText("(long term)");
  await showView(a.page, "doc");
  await expect(a.page.getByTestId("doc-label")).toHaveText(OA);
  await a.page.keyboard.press("d");
  await expect(a.page.getByTestId("board")).toBeVisible();
  await a.ctx.close();
  await b.ctx.close();
});

test("criterion 2: prep timer — same countdown on both devices, PMC exactly once at 0, both go to the Board, Undo", async ({ browser }) => {
  const a = await newDevice(browser);
  const b = await newDevice(browser);
  const t0 = new Date("2026-11-10T15:00:00Z");
  await a.page.clock.install({ time: t0 });
  await b.page.clock.install({ time: t0 });
  const code = await openNewRoom(a.page, { closeSetup: false, view: "doc" });
  await a.page.getByTestId("time-prep").fill("1");
  await a.page.getByTestId("time-prep").press("Enter");
  await a.page.getByTestId("setup-close").click();
  await waitSynced(a.page);
  await openRoom(b.page, code, { view: "doc" });
  await waitSynced(b.page);
  for (const p of [a.page, b.page]) await expect(p.getByTestId("prep-clock")).toHaveText("01:00");

  await a.page.getByTestId("prep-toggle").click();
  await expect(b.page.getByTestId("prep-timer")).toHaveAttribute("data-running", "true");
  await a.page.clock.fastForward(30_000);
  await b.page.clock.fastForward(30_000);
  for (const p of [a.page, b.page]) await expect(p.getByTestId("prep-clock")).toHaveText(/00:(29|30|31)/);

  // +1 min on B shows on A; reset on B stops it at the full prep length on both
  await b.page.getByTestId("prep-plus").click();
  await expect(a.page.getByTestId("prep-clock")).toHaveText(/01:(29|30|31)/);
  await b.page.getByTestId("prep-reset").click();
  await expect(a.page.getByTestId("prep-clock")).toHaveText("01:00");
  await expect(a.page.getByTestId("prep-timer")).toHaveAttribute("data-running", "false");
  await a.page.keyboard.press("Shift+Space"); // hotkey: start
  await expect(b.page.getByTestId("prep-timer")).toHaveAttribute("data-running", "true");

  // both devices reach 0 at the same time: the round moves to PMC exactly once
  await Promise.all([a.page.clock.fastForward(61_000), b.page.clock.fastForward(61_000)]);
  for (const p of [a.page, b.page]) {
    await expect(p.getByTestId("stagebar")).toHaveAttribute("data-stage", "PMC");
    await expect(p.getByTestId("board")).toBeVisible();
    await expect(p.getByTestId("toast-text")).toHaveText("Prep over — board");
  }
  await Promise.all([a.page.clock.fastForward(2_000), b.page.clock.fastForward(2_000)]);
  expect([await stage(a.page), await stage(b.page)]).toEqual(["PMC", "PMC"]);

  // Undo returns to Prep (both devices, Doc view) and the finished run does not fire again
  await b.page.getByTestId("toast-action").click();
  for (const p of [a.page, b.page]) {
    await expect(p.getByTestId("stagebar")).toHaveAttribute("data-stage", "prep");
    await expect(p.getByTestId("doc-view")).toBeVisible();
  }
  await Promise.all([a.page.clock.fastForward(5_000), b.page.clock.fastForward(5_000)]);
  expect([await stage(a.page), await stage(b.page)]).toEqual(["prep", "prep"]);
  await expect(a.page.getByTestId("prep-clock")).toHaveText("00:00");
  await a.ctx.close();
  await b.ctx.close();
});
