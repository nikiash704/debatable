import { expect, test, type Page } from "@playwright/test";
import { card, lane, laneLabels, MOD, newDevice, openNewRoom, openRoom, showView, typeAndEscape, waitSynced } from "./helpers";
import { OUTLINE, pmcWithAnswers, prepInDoc, prepOnBoard } from "./ocean";

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

  // Alt+↓ moves a line (the same move as on the board): "Planetary backup" goes to the top of thesis 2
  await a.page.locator('[data-testid="doc-card"] textarea').nth(1).click();
  const markers = a.page.locator('[data-testid="doc-card"] .doc__marker');
  await a.page.keyboard.press("Alt+ArrowDown");
  await expect(markers).toHaveText(["a.", "a.", "b.", "c.", "a.", "b."]); // thesis 1 has one argument left
  await expect(a.page.locator('[data-testid="doc-card"] textarea').nth(1)).toHaveValue("Planetary backup for humanity (long term)");
  await a.page.keyboard.press("Alt+ArrowUp");
  await expect(markers).toHaveText(["a.", "b.", "a.", "b.", "a.", "b."]);
  await expect(card(b.page, "OA2")).toContainText("Planetary backup");

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

/** Top edge of a card, in page pixels (cards in one row are top-aligned). */
async function top(page: Page, label: string) {
  return Math.round((await card(page, label).boundingBox())!.y);
}

async function laneDim(page: Page, speech: string) {
  return lane(page, speech).getAttribute("data-dim");
}

test("criteria 3–8 and 11: Answer, Link, unanswered, two targets, focus, MG / MO, LOR — on two devices", async ({ browser }) => {
  const a = await newDevice(browser);
  const b = await newDevice(browser);
  const code = await openNewRoom(a.page);
  await waitSynced(a.page);
  await openRoom(b.page, code);
  await waitSynced(b.page);
  const pa = a.page;
  await prepOnBoard(pa);

  // ---------- 3. Answer (R) and Link (L) ----------
  await pmcWithAnswers(pa);
  expect(await laneLabels(pa, "PMC")).toEqual(["PM1", "PM2", "PM3", "PM4", "PM5"]);
  for (const [oc, pm] of [["OC1", "PM1"], ["OC2", "PM2"], ["OC3", "PM3"], ["OC4", "PM5"]]) {
    await expect(lane(pa, "LOC").locator(`[data-label="${oc}"]`)).toHaveCount(1);
    expect(await top(pa, oc)).toBe(await top(pa, pm));
    await expect(pa.getByTestId(`arrow-${oc}-${pm}`)).toHaveCount(1);
    await expect(card(pa, oc).getByTestId("card-responding")).toHaveText(`Responding to ${pm}`);
  }
  // the hotkey hints are there
  await card(pa, "PM2").hover();
  await card(pa, "PM2").getByTestId("tool-answer").hover();
  await expect(pa.getByRole("tooltip").locator("kbd")).toHaveText("R");

  // ---------- 4. Unanswered ----------
  await expect(card(pa, "PM4")).toHaveAttribute("data-unanswered", "true");
  await expect(card(pa, "PM4")).toHaveClass(/card--unanswered/);
  await expect(card(pa, "PM1")).toHaveAttribute("data-unanswered", "false");
  // LO's lane is empty in PM4's row
  const pm4Top = await top(pa, "PM4");
  for (const l of await laneLabels(pa, "LOC")) expect(await top(pa, l)).not.toBe(pm4Top);
  await expect(pa.getByTestId("answer-counter-LOC")).toHaveText("PM answered 4/5");
  await expect(pa.getByTestId("unanswered-count")).toHaveText("1 unanswered");
  await expect(pa.getByTestId("unanswered-pill")).toContainText("PM4");
  await card(pa, "PM1").click();
  await pa.getByTestId("unanswered-PM4").click();
  await expect(card(pa, "PM4")).toHaveClass(/card--selected/);
  await expect(card(pa, "PM4")).toBeInViewport();
  // 11: the partner sees links, arrows, unanswered state and counters
  await expect(b.page.getByTestId("arrow-OC4-PM5")).toHaveCount(1);
  await expect(card(b.page, "PM4")).toHaveAttribute("data-unanswered", "true");
  await expect(b.page.getByTestId("answer-counter-LOC")).toHaveText("PM answered 4/5");
  await expect(b.page.getByTestId("unanswered-pill")).toContainText("PM4");

  // ---------- 5. Two targets ----------
  await card(pa, "OC3").click();
  await pa.keyboard.press("l");
  await expect(pa.getByTestId("pick-banner")).toBeVisible();
  await expect(card(pa, "PM2")).toHaveAttribute("data-eligible", "true");
  await expect(card(pa, "OA1")).toHaveAttribute("data-eligible", "false");
  await expect(card(pa, "OA1")).toHaveClass(/card--ineligible/);
  await expect(b.page.getByTestId("pick-banner")).toHaveCount(0); // pick mode is this device only
  await card(pa, "PM2").click();
  await pa.keyboard.press("Escape");
  await expect(pa.getByTestId("pick-banner")).toHaveCount(0);
  await expect(pa.locator('[data-testid^="arrow-OC3-"]')).toHaveCount(2);
  await expect(card(pa, "OC3").getByTestId("card-responding")).toHaveText("Responding to PM3, PM2");
  expect(await top(pa, "OC3")).toBe(await top(pa, "PM3")); // the extra target does not move it
  await expect(b.page.locator('[data-testid^="arrow-OC3-"]')).toHaveCount(2);
  // unlink with the × on the line
  await pa.mouse.click(1300, 820); // clear the selection
  await pa.getByTestId("arrow-hit-OC3-PM2").hover();
  await pa.getByTestId("unlink-x").click();
  await expect(pa.locator('[data-testid^="arrow-OC3-"]')).toHaveCount(1);
  await expect(pa.getByTestId("arrow-OC3-PM3")).toHaveCount(1);
  await expect(b.page.locator('[data-testid^="arrow-OC3-"]')).toHaveCount(1);

  // ---------- 6. Focus (this device only) ----------
  await card(pa, "OC4").dblclick();
  await expect(pa.getByTestId("card-editor")).toBeFocused();
  await expect(card(pa, "PM5")).toHaveAttribute("data-focus", "true");
  await expect(card(pa, "PM1")).toHaveAttribute("data-focus", "false");
  for (const s of ["MG", "MO", "LOR"]) expect(await laneDim(pa, s)).toBe("true");
  for (const s of ["PMC", "LOC"]) expect(await laneDim(pa, s)).toBe("false");
  for (const s of ["PMC", "LOC", "MG", "MO", "LOR"]) expect(await laneDim(b.page, s)).toBe("false");
  await pa.keyboard.press("Escape");
  await pa.keyboard.press("Escape");
  for (const s of ["MG", "MO", "LOR"]) expect(await laneDim(pa, s)).toBe("false");

  // ---------- 7. MG / MO ----------
  await pa.keyboard.press("]"); // LOC: speech mode for LO
  await expect(pa.getByTestId("stagebar")).toHaveAttribute("data-stage", "LOC");
  for (const l of ["OC1", "OC2", "OC3", "OC4", "OA1", "OA3", "OA5"]) await card(pa, l).click();
  await pa.keyboard.press("]");
  await expect(pa.getByTestId("stagebar")).toHaveAttribute("data-stage", "MG");
  await card(pa, "OA1").click();
  await pa.keyboard.press("r");
  await typeAndEscape(pa, "Asteroid mining is decades away");
  await expect(lane(pa, "MG").locator('[data-label="MG1"]')).toHaveCount(1);
  expect(await top(pa, "MG1")).toBe(await top(pa, "OA1"));
  await pa.getByTestId("add-MG-own").click();
  await typeAndEscape(pa, "Earth's problems come first");
  const mg2Top = await top(pa, "MG2");
  for (const l of [...(await laneLabels(pa, "PMC")), ...(await laneLabels(pa, "LOC"))]) expect(await top(pa, l)).not.toBe(mg2Top);
  await card(pa, "MG1").click();
  await pa.keyboard.press("r");
  await typeAndEscape(pa, "Decades away is still a payoff");
  await expect(lane(pa, "MO").locator('[data-label="OC5"]')).toHaveCount(1);
  expect(await top(pa, "OC5")).toBe(await top(pa, "OA1"));
  await card(pa, "PM4").click();
  await pa.keyboard.press("r");
  await typeAndEscape(pa, "Food security is solved on land");
  await expect(lane(pa, "MO").locator('[data-label="OC6"]')).toHaveCount(1);
  expect(await top(pa, "OC6")).toBe(await top(pa, "PM4"));
  // a straight arrow from MO across LO and MG to PM4
  const line = pa.getByTestId("arrow-OC6-PM4").locator(".arrow__line");
  const [y1, y2, x1, x2] = await Promise.all(["y1", "y2", "x1", "x2"].map(async (k) => Number(await line.getAttribute(k))));
  expect(Math.abs(y1 - y2)).toBeLessThan(1);
  const loBox = (await lane(pa, "LOC").boundingBox())!;
  const mgBox = (await lane(pa, "MG").boundingBox())!;
  const pmBox = (await card(pa, "PM4").boundingBox())!;
  const moBox = (await card(pa, "OC6").boundingBox())!;
  expect(x2 - x1).toBeLessThan(0); // drawn from the answer (right) to the target (left)
  expect(moBox.x - pmBox.x - pmBox.width).toBeGreaterThan(loBox.width + mgBox.width);
  await expect(pa.getByTestId("answer-counter-MO")).toHaveText("MG answered 1/2 · from PM left 0");
  await expect(pa.getByTestId("unanswered-count")).toHaveText("1 unanswered");
  await expect(pa.getByTestId("unanswered-pill")).toContainText("MG2");
  await expect(b.page.getByTestId("answer-counter-MO")).toHaveText("MG answered 1/2 · from PM left 0");

  // ---------- 8. LOR ----------
  await pa.keyboard.press("]"); // MO
  await card(pa, "OC5").click();
  await pa.keyboard.press(`${MOD}+Enter`);
  await card(pa, "OA2").click();
  await pa.keyboard.press(`${MOD}+Enter`);
  await pa.keyboard.press("]"); // LOR
  await expect(pa.getByTestId("stagebar")).toHaveAttribute("data-stage", "LOR");
  for (const [l, where] of [["OA1", "LOC"], ["OC1", "LOC"], ["OC4", "LOC"], ["OC5", "MO"], ["OA2", "MO"]]) {
    await expect(card(pa, l)).toHaveAttribute("data-said-green", "true");
    await expect(card(pa, l)).toHaveClass(/card--said/);
    await expect(card(pa, l).getByTestId("card-meta")).toHaveText(`said in ${where}`);
    await expect(card(pa, l)).toHaveAttribute("data-struck", "false");
  }
  for (const l of ["OA4", "OA6", "OC6"]) {
    await expect(card(pa, l)).toHaveAttribute("data-red", "true");
    await expect(card(pa, l).getByTestId("plate-new")).toHaveText("new — don't say");
  }
  // every arrow stays visible
  const arrows = pa.locator('[data-testid^="arrow-"]:not([data-testid^="arrow-hit-"])');
  await expect(arrows).toHaveCount(7);
  for (const g of await arrows.all()) await expect(g).not.toHaveCSS("display", "none");
  // PMR cards are never counted as unanswered
  await pa.keyboard.press("]");
  await pa.getByTestId("add-PMR-own").click();
  await typeAndEscape(pa, "They never answered the weighing");
  await expect(card(pa, "PMR1")).toHaveAttribute("data-unanswered", "false");
  await expect(pa.getByTestId("unanswered-pill")).not.toContainText("PMR1");
  await a.ctx.close();
  await b.ctx.close();
});

test("criterion 10: the Government mirror gives GA / GC / GR; LO's cards are red until MG answers them", async ({ page }) => {
  await openNewRoom(page, { closeSetup: false });
  await page.getByTestId("side-gov").click();
  await page.getByTestId("setup-done").click();
  await page.getByTestId("add-thesis-PMC").click();
  await page.keyboard.type("The ocean is the nearer frontier");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Oceans are 95% unexplored");
  await page.keyboard.press("Enter");
  await typeAndEscape(page, "Climate answers are in the ocean");
  await page.getByTestId("stage-next").click(); // PMC
  await card(page, "GA1").click(); // speech mode (PM): said
  await page.getByTestId("stage-next").click(); // LOC
  await page.getByTestId("add-LOC-own").click();
  await page.keyboard.type("Space pays off long term");
  await page.keyboard.press("Enter");
  await typeAndEscape(page, "Unexplored is not more valuable");
  for (const l of ["LO1", "LO2"]) await expect(card(page, l)).toHaveAttribute("data-unanswered", "true");
  await expect(page.getByTestId("unanswered-count")).toHaveText("2 unanswered");
  await page.keyboard.press("Escape"); // LO2 is still selected; a click would edit it
  await card(page, "LO2").click();
  await page.keyboard.press("r"); // MG (ours) is live from LOC
  await typeAndEscape(page, "Unexplored means unknown upside");
  await expect(lane(page, "MG").locator('[data-label="GC1"]')).toHaveCount(1);
  expect(await top(page, "GC1")).toBe(await top(page, "LO2"));
  await expect(card(page, "LO2")).toHaveAttribute("data-unanswered", "false");
  await expect(card(page, "LO1")).toHaveAttribute("data-unanswered", "true");
  await expect(page.getByTestId("answer-counter-MG")).toHaveText("LO answered 1/2");
  await page.getByTestId("stage-PMR").click();
  await card(page, "LO1").click();
  await page.keyboard.press("r");
  await typeAndEscape(page, "Long term is speculative");
  await expect(card(page, "GR1")).toBeVisible();
  await expect(card(page, "LO1")).toHaveAttribute("data-unanswered", "false");
  await expect(page.getByTestId("unanswered-pill")).toHaveCount(0);
});

test("criterion 12: the demo format gets rows, arrows and counters from its config", async ({ page }) => {
  await openNewRoom(page);
  await page.evaluate(() => {
    const s = (window as unknown as { __debatable: { doc: { getMap(n: string): { set(k: string, v: string): void } } } }).__debatable;
    s.doc.getMap("room").set("format", "demo-mini");
  });
  await expect(page.getByTestId("stepper").locator(".stage-pill")).toHaveText(["Warm-up", "SOUTH", "NORTH", "N-SUM", "Debrief"]);
  await page.getByTestId("stage-SOUTH").click();
  await page.getByTestId("add-SOUTH-own").click();
  await page.keyboard.type("Their opener");
  await page.keyboard.press("Enter");
  await typeAndEscape(page, "Their second");
  await card(page, "SO1").click();
  await page.keyboard.press("r");
  await typeAndEscape(page, "Our answer");
  await expect(lane(page, "NORTH").locator('[data-label="NQ1"]')).toHaveCount(1);
  expect(await top(page, "NQ1")).toBe(await top(page, "SO1"));
  await expect(page.getByTestId("arrow-NQ1-SO1")).toHaveCount(1);
  await expect(page.getByTestId("answer-counter-NORTH")).toHaveText("SO answered 1/2");
  await expect(page.getByTestId("unanswered-pill")).toContainText("SO2");
});

/** Card texts of a lane, top to bottom. */
async function laneTexts(page: Page, speech: string) {
  return lane(page, speech).locator('[data-testid="card-text"]').allTextContents();
}

async function mouseDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, during?: () => Promise<void>) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y + 12, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  if (during) await during();
  await page.mouse.up();
}

test("criterion 9: drag and drop — step aside, renumber on drop, touch, Alt+↑/↓, theses, locked columns, linked answers", async ({ browser }) => {
  const a = await newDevice(browser);
  const b = await newDevice(browser);
  const code = await openNewRoom(a.page);
  await waitSynced(a.page);
  await openRoom(b.page, code);
  await waitSynced(b.page);
  const page = a.page;
  await prepOnBoard(page);
  await page.keyboard.press("Escape");

  // mouse: OA3 to the top of thesis 3 — the others step aside while dragging, numbers change on drop
  const src = (await card(page, "OA3").boundingBox())!;
  const dst = (await card(page, "OA5").boundingBox())!;
  const spinBefore = (await card(page, "OA4").boundingBox())!.y;
  await mouseDrag(page, { x: src.x + 60, y: src.y + 45 }, { x: dst.x + 60, y: dst.y + 2 }, async () => {
    await expect.poll(async () => (await card(page, "OA4").boundingBox())!.y).toBeLessThan(spinBefore - 20); // Spin-offs moved up
    await expect(card(page, "OA3")).toHaveClass(/card--drag-target/); // the landing place is marked
    await expect(card(page, "OA3")).toContainText("Satellites run climate monitoring"); // labels change only on drop
  });
  await expect(card(page, "OA3")).toContainText("Spin-offs");
  await expect(card(page, "OA4")).toContainText("Satellites run climate monitoring");
  expect(await laneLabels(page, "LOC")).toEqual(OA);
  // 11: the drop syncs
  await expect(card(b.page, "OA4")).toContainText("Satellites run climate monitoring");

  // keyboard: Alt+↑ moves the selection back over the thesis boundary, Alt+↓ returns it
  await card(page, "OA4").click();
  await page.keyboard.press("Alt+ArrowUp");
  expect(await laneTexts(page, "LOC")).toEqual([
    "Asteroid mining unlocks scarce metals",
    "Planetary backup for humanity",
    "Spin-offs: GPS, solar cells, water filters",
    "Satellites run climate monitoring",
    "Deep-sea mining destroys ecosystems",
    "Ocean research is already funded",
  ]);
  await expect(lane(page, "LOC").getByTestId("thesis").nth(2)).toBeVisible();
  await page.keyboard.press("Alt+ArrowUp");
  await expect(card(page, "OA3")).toContainText("Satellites run climate monitoring");
  await page.keyboard.press("Alt+ArrowDown");
  await page.keyboard.press("Alt+ArrowDown");
  await expect(card(page, "OA4")).toContainText("Satellites run climate monitoring");

  // points: by mouse inside a card (1b above 1a), by keyboard into the card above (Alt+↑ on 2a)
  await page.keyboard.press("Escape");
  await card(page, "OA1").getByTestId("card-more").click();
  const pts = card(page, "OA1").getByTestId("card-point");
  const p0 = (await pts.nth(0).boundingBox())!;
  const p1 = (await pts.nth(1).boundingBox())!;
  await mouseDrag(page, { x: p1.x + 80, y: p1.y + p1.height / 2 }, { x: p0.x + 80, y: p0.y + 1 });
  await expect(pts).toHaveText([/1a\s*No seabed damage/, /1b\s*Platinum-group metals/]);
  await card(page, "OA2").getByTestId("card-point").dblclick();
  await expect(page.getByTestId("point-editor")).toBeFocused();
  await page.keyboard.press("Alt+ArrowUp");
  await page.keyboard.press("Escape");
  await expect(card(page, "OA1").getByTestId("card-point")).toHaveCount(3);
  await expect(card(page, "OA2").getByTestId("card-point")).toHaveCount(0);

  // theses: drag thesis 2 above thesis 1 — its cards move with it
  const t2 = lane(page, "LOC").getByTestId("thesis").nth(1).locator(".thesis__head");
  const t1 = lane(page, "LOC").getByTestId("thesis").nth(0).locator(".thesis__head");
  const t2b = (await t2.boundingBox())!;
  const t1b = (await t1.boundingBox())!;
  await page.keyboard.press("Escape");
  await mouseDrag(page, { x: t2b.x + 30, y: t2b.y + 8 }, { x: t1b.x + 30, y: t1b.y - 4 });
  await expect(lane(page, "LOC").getByTestId("thesis-title")).toHaveText([OUTLINE[1].thesis, OUTLINE[0].thesis, OUTLINE[2].thesis]);
  await expect(card(page, "OA1")).toContainText("Spin-offs");
  await expect(card(page, "OA2")).toContainText("Asteroid mining");
  await expect(lane(b.page, "LOC").getByTestId("thesis-title")).toHaveText([OUTLINE[1].thesis, OUTLINE[0].thesis, OUTLINE[2].thesis]);

  // a linked answer moves only inside its row: dropped elsewhere it snaps back with a hint
  await page.getByTestId("stage-next").click(); // PMC
  await page.getByTestId("add-PMC-own").click();
  await page.keyboard.type("Oceans are 95% unexplored");
  await page.keyboard.press("Enter");
  await typeAndEscape(page, "Climate answers are in the ocean");
  await page.keyboard.press("Escape");
  await card(page, "PM1").click();
  await page.keyboard.press("r");
  await typeAndEscape(page, "Unexplored is not more valuable");
  await page.keyboard.press("Escape");
  const oc1 = (await card(page, "OC1").boundingBox())!;
  await mouseDrag(page, { x: oc1.x + 60, y: oc1.y + 45 }, { x: oc1.x + 60, y: oc1.y + 420 });
  await expect(page.getByTestId("toast-text")).toHaveText("Use L to change the target");
  expect(await top(page, "OC1")).toBe(await top(page, "PM1"));
  // and by keyboard: nothing to swap with in its row → the same hint
  await card(page, "OC1").click();
  await page.keyboard.press("Alt+ArrowDown");
  await expect(page.getByTestId("toast-text")).toHaveText("Use L to change the target");

  // a locked column: reordering keeps the numbers (LOC → MG locks LO)
  await page.keyboard.press("Escape");
  await page.keyboard.press("]"); // LOC (speech mode for LO)
  for (const l of ["OC1", "OA1", "OA2", "OA3", "OA4", "OA5", "OA6"]) await card(page, l).click();
  await page.keyboard.press("]"); // MG: LO locked
  await expect(page.getByTestId("stagebar")).toHaveAttribute("data-stage", "MG");
  await page.keyboard.press("Escape");
  await card(page, "OA6").click();
  await page.keyboard.press("Alt+ArrowUp");
  await expect(card(page, "OA6")).toContainText("Ocean research is already funded");
  expect((await laneLabels(page, "LOC")).filter((l) => l.startsWith("OA"))).toEqual(["OA1", "OA2", "OA3", "OA4", "OA6", "OA5"]);
  await a.ctx.close();
  await b.ctx.close();
});

test("criterion 9 (touch): long press, then drag; a quick swipe still scrolls", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  const page = await ctx.newPage();
  await openNewRoom(page);
  await prepOnBoard(page);
  await page.keyboard.press("Escape");
  const cdp = await ctx.newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", x: number, y: number) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
  await card(page, "OA3").scrollIntoViewIfNeeded();
  const src = (await card(page, "OA3").boundingBox())!;
  const dst = (await card(page, "OA4").boundingBox())!;
  const toY = dst.y + dst.height + 2; // just below OA4 = end of thesis 2
  await touch("touchStart", src.x + 60, src.y + 45);
  await page.waitForTimeout(500); // long press
  for (let i = 1; i <= 10; i++) await touch("touchMove", src.x + 60, src.y + 45 + ((toY - src.y - 45) * i) / 10);
  await expect(card(page, "OA3")).toHaveClass(/card--drag-target/);
  await touch("touchEnd", 0, 0);
  await expect(card(page, "OA4")).toContainText("Satellites run climate monitoring");
  // a quick swipe is a scroll, not a drag
  const board = page.getByTestId("board");
  const before = await board.evaluate((el) => el.scrollTop);
  expect(before).toBeGreaterThan(100); // the board is scrolled down after typing the outline
  const s2 = (await card(page, "OA4").boundingBox())!;
  await touch("touchStart", s2.x + 60, s2.y + 20);
  for (let i = 1; i <= 8; i++) await touch("touchMove", s2.x + 60, s2.y + 20 + i * 30);
  await touch("touchEnd", 0, 0);
  await expect.poll(() => board.evaluate((el) => el.scrollTop)).toBeLessThan(before);
  await expect(card(page, "OA4")).toContainText("Satellites run climate monitoring");
  await ctx.close();
});
