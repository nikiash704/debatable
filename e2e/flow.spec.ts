import { expect, test, type Page } from "@playwright/test";
import { card, goStage, lane, laneLabels, MOD, newDevice, openNewRoom, openRoom, typeAndEscape, waitSynced } from "./helpers";

/**
 * Feature 02, stage 1 — the 10 acceptance criteria on the round "Ocean vs Space" (we are the Opposition).
 * Motion: THW prioritise ocean exploration over space exploration.
 */

const MOTION = "THW prioritise ocean exploration over space exploration";

async function setMotion(page: Page, motion = MOTION) {
  await page.getByTestId("topbar-motion").click();
  await page.getByTestId("motion-input").fill(motion);
  await page.getByTestId("setup-close").click();
}

/** Prep by keyboard (Enter / Tab / Shift+Tab), as an outline: thesis → cards → points. */
async function prepByKeyboard(page: Page) {
  await page.getByTestId("add-thesis-LOC").click();
  const k = page.keyboard;
  await k.type("Space is the bigger long-term payoff");
  await k.press("Enter"); // first card of thesis 1
  await k.type("Asteroid mining unlocks scarce metals");
  await k.press("Enter");
  await k.press("Tab"); // becomes point 1a of the card above
  await k.type("Platinum-group metals");
  await k.press("Enter"); // point 1b
  await k.type("No seabed damage");
  await k.press("Enter");
  await k.press("Shift+Tab"); // back to card level
  await k.type("Planetary backup for humanity");
  await k.press("Enter");
  await k.press("Tab");
  await k.type("Extinction-level risks");
  await k.press("Enter");
  await k.press("Shift+Tab");
  await k.press("Shift+Tab"); // empty card → thesis 2
  await k.type("Space tech already pays off on Earth");
  await k.press("Enter");
  await k.type("Satellites run climate monitoring");
  await k.press("Enter");
  await k.press("Tab");
  await k.type("Sea-level data comes from orbit");
  await k.press("Enter");
  await k.press("Shift+Tab");
  await k.type("Spin-offs: GPS, solar cells, water filters");
  await k.press("Enter");
  await k.press("Shift+Tab"); // thesis 3
  await k.type("Ocean exploration harms what it studies");
  await k.press("Enter");
  await k.type("Ocean research is already funded");
  await k.press("Escape");
}

test("criteria 1–6 and 8: Ocean vs Space for the Opposition", async ({ page }) => {
  await openNewRoom(page);
  await setMotion(page);
  await expect(page.getByTestId("topbar-motion")).toHaveText(MOTION);

  // ---------- 1. Prep: 3 theses, OA1–OA6 with points; inserting in the middle renumbers ----------
  await prepByKeyboard(page);
  await expect(lane(page, "LOC").getByTestId("thesis")).toHaveCount(3);
  await expect(lane(page, "LOC").getByTestId("thesis-title")).toHaveText([
    "Space is the bigger long-term payoff",
    "Space tech already pays off on Earth",
    "Ocean exploration harms what it studies",
  ]);
  expect(await laneLabels(page, "LOC")).toEqual(["OA1", "OA2", "OA3", "OA4", "OA5"]);
  // points: collapsed to the first one plus •N, expand on click
  await expect(card(page, "OA1").getByTestId("card-point")).toHaveCount(1);
  await expect(card(page, "OA1").getByTestId("card-more")).toHaveText("•2");
  await card(page, "OA1").getByTestId("card-more").click();
  await expect(card(page, "OA1").getByTestId("card-point")).toHaveText([/1a\s*Platinum-group metals/, /1b\s*No seabed damage/]);
  // insert a card in the middle with the mouse ("+" in the gap between OA4 and the next thesis's card)
  await page.getByTestId("gap-before-OA5").click();
  await typeAndEscape(page, "Deep-sea mining destroys ecosystems");
  await expect(card(page, "OA5")).toContainText("Deep-sea mining destroys ecosystems");
  await expect(card(page, "OA6")).toContainText("Ocean research is already funded");
  expect(await laneLabels(page, "LOC")).toEqual(["OA1", "OA2", "OA3", "OA4", "OA5", "OA6"]);
  // and one more in the very middle of thesis 1, then delete it again: numbers close up
  await page.getByTestId("gap-after-OA1").click();
  await typeAndEscape(page, "temporary");
  await expect(card(page, "OA2")).toContainText("temporary");
  await expect(card(page, "OA7")).toContainText("Ocean research is already funded");
  await page.keyboard.press("Delete"); // the new card is still selected
  expect(await laneLabels(page, "LOC")).toEqual(["OA1", "OA2", "OA3", "OA4", "OA5", "OA6"]);
  await expect(card(page, "OA2")).toContainText("Planetary backup for humanity");
  for (const l of ["OA3", "OA4", "OA5", "OA6"]) {
    // give every card a point (spec: "with points")
    if ((await card(page, l).getByTestId("card-point").count()) === 0) {
      await card(page, l).hover();
      await card(page, l).getByTestId("tool-point").click();
      await typeAndEscape(page, `Evidence for ${l}`);
    }
  }

  // ---------- 2. PMC: PM1–PM5, each with an empty LO answer slot; OC1–OC4 typed; LO numbers live ----------
  await page.getByTestId("stage-next").click();
  await expect(page.getByTestId("stagebar")).toHaveAttribute("data-stage", "PMC");
  await page.getByTestId("add-PMC-own").click();
  for (const [i, t] of ["Oceans are 95% unexplored", "Climate answers are in the ocean", "Cheaper per discovery", "Food security", "Space race is militarised"].entries()) {
    if (i > 0) await page.keyboard.press("Enter");
    await page.keyboard.type(t);
  }
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  expect(await laneLabels(page, "PMC")).toEqual(["PM1", "PM2", "PM3", "PM4", "PM5"]);
  expect(await laneLabels(page, "LOC")).toEqual(["OC1", "OC2", "OC3", "OC4", "OC5", "OA1", "OA2", "OA3", "OA4", "OA5", "OA6"]);
  for (const [i, t] of ["Unexplored is not more valuable", "Satellites already watch the ocean", "Ignores spin-offs", "Food security is solved on land"].entries()) {
    await card(page, `OC${i + 1}`).dblclick();
    await typeAndEscape(page, t);
    await page.keyboard.press("Escape");
  }
  await page.keyboard.press("]"); // hotkey: next stage
  await expect(page.getByTestId("stagebar")).toHaveAttribute("data-stage", "LOC");
  // PM numbers are locked now, LO's are still live: a new response (unlinked) comes after the slots
  await page.getByTestId("add-LOC-clash").click();
  await typeAndEscape(page, "x");
  await expect(card(page, "OC6")).toContainText("x");
  await page.keyboard.press("Delete");
  await expect(card(page, "OC6")).toHaveCount(0);

  // ---------- 3. LOC: "Made" strikes the card (button or M); counter said 7 / 10 (empty slots not counted) ----------
  await expect(page.getByTestId("speech-mode")).toHaveCount(0); // speech mode is hidden for now
  for (const l of ["OC1", "OC2", "OC3", "OA1", "OA3", "OA5"]) await card(page, l).getByTestId("made").click();
  await expect(card(page, "OC3")).toHaveAttribute("data-struck", "true");
  await card(page, "OC3").getByTestId("made").click();
  await expect(card(page, "OC3")).toHaveAttribute("data-struck", "false");
  await card(page, "OC3").getByTestId("made").click();
  await page.keyboard.press("Escape");
  await card(page, "OC4").click();
  await page.keyboard.press("m");
  await expect(card(page, "OC4")).toHaveAttribute("data-struck", "true");
  await expect(card(page, "OC4").getByTestId("made")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("counter-LOC")).toHaveText(/said\s*7 \/ 10/);
  for (const l of ["OA2", "OA4", "OA6"]) await expect(card(page, l)).toHaveAttribute("data-struck", "false");
  await expect(card(page, "OA1").getByTestId("card-text")).toHaveCSS("text-decoration-line", "line-through");

  // ---------- 4. LOC → MG: LO numbers locked; unsaid OA2, OA4, OA6 move to MO with "from LO" ----------
  // PM5's empty answer slot moves on too (unlocked, no plate): a long arrow from MO to PM5
  await page.getByTestId("stage-next").click();
  await expect(page.getByTestId("stagebar")).toHaveAttribute("data-stage", "MG");
  expect(await laneLabels(page, "MO")).toEqual(["OC5", "OA2", "OA4", "OA6"]);
  for (const l of ["OA2", "OA4", "OA6"]) await expect(card(page, l).getByTestId("plate-from")).toHaveText("from LO");
  await expect(card(page, "OC5").getByTestId("plate-from")).toHaveCount(0);
  await expect(page.getByTestId("arrow-OC5-PM5")).toHaveAttribute("data-blank", "true");
  expect(await laneLabels(page, "LOC")).toEqual(["OC1", "OC2", "OC3", "OC4", "OA1", "OA3", "OA5"]);
  await expect(card(page, "OA2")).toContainText("Planetary backup for humanity");

  // ---------- 5. MG + MO: answer to MG1 is OC5 (MG answers first), new own argument OA7; Made + counter ----------
  await page.getByTestId("add-MG-own").click();
  await page.keyboard.type("Asteroid mining is decades away");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Earth's problems come first");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  expect(await laneLabels(page, "MG")).toEqual(["MG1", "MG2"]);
  await card(page, "MG1").click();
  await page.keyboard.press("r"); // fills MG1's empty slot in MO
  await typeAndEscape(page, "Decades away is still a payoff");
  await expect(card(page, "OC5")).toContainText("Decades away is still a payoff");
  await page.getByTestId("add-MO-own-t1").click();
  await typeAndEscape(page, "Space inspires STEM careers");
  await expect(card(page, "OA7")).toContainText("Space inspires STEM careers");
  await page.keyboard.press("Escape");
  await page.keyboard.press("]");
  await expect(page.getByTestId("stagebar")).toHaveAttribute("data-stage", "MO");
  await card(page, "OC5").getByTestId("made").click();
  await card(page, "OA2").getByTestId("made").click();
  await expect(card(page, "OC5")).toHaveAttribute("data-struck", "true");
  await expect(page.getByTestId("counter-MO")).toHaveText(/said\s*2 \/ 5/);
  await page.keyboard.press("Escape");

  // ---------- 6. LOR: strikes cleared, unsaid red, POO available, OR renumbering ----------
  // POO is not offered before the rebuttals
  await card(page, "PM1").click();
  await card(page, "PM1").getByTestId("tool-tags").click();
  await expect(page.getByTestId("tag-menu")).toBeVisible();
  await expect(page.getByTestId("menu-tag-poo")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.keyboard.press("p");
  await expect(card(page, "PM1").getByTestId("tag-poo")).toHaveCount(0);
  await page.getByTestId("stage-next").click();
  await expect(page.getByTestId("stagebar")).toHaveAttribute("data-stage", "LOR");
  for (const l of ["OA1", "OC1", "OA2", "OC5"]) {
    await expect(card(page, l)).toHaveAttribute("data-struck", "false");
    await expect(card(page, l)).toHaveAttribute("data-said", "true"); // data kept
  }
  for (const l of ["OA4", "OA6", "OA7"]) {
    await expect(card(page, l)).toHaveAttribute("data-red", "true");
    await expect(card(page, l).getByTestId("plate-new")).toHaveText("new — don't say");
    await expect(card(page, l)).toHaveClass(/card--red/);
  }
  await expect(card(page, "OA1")).toHaveAttribute("data-red", "false");
  // red appears only with the label
  await expect(page.locator(".card--red")).toHaveCount(3);
  // POO: by hotkey on a selected opponent card, and in the tag menu
  await card(page, "MG2").click();
  await page.keyboard.press("p");
  await expect(card(page, "MG2").getByTestId("tag-poo")).toHaveText(/POO/);
  await expect(card(page, "MG2").getByTestId("tag-poo")).toHaveClass(/chip--alert/);
  await card(page, "MG1").hover();
  await card(page, "MG1").getByTestId("tool-tags").click();
  await page.getByTestId("menu-tag-poo").click();
  await expect(card(page, "MG1").getByTestId("tag-poo")).toBeVisible();
  // OR cards: the rebuttal points of every made argument are there already (in their rows); new ones come
  // after them, and inserting at the top of the new ones renumbers
  const slots = (await laneLabels(page, "LOR")).length;
  expect(slots).toBeGreaterThan(5);
  await page.keyboard.press("Escape");
  await page.getByTestId("add-LOR-clash").click();
  await page.keyboard.type("They dropped asteroid mining");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Long term beats short term");
  await page.keyboard.press("Escape");
  const n = (k: number) => `OR${slots + k}`;
  expect((await laneLabels(page, "LOR")).slice(slots)).toEqual([n(1), n(2)]);
  await page.getByTestId(`gap-before-${n(1)}`).click();
  await typeAndEscape(page, "Opening crystallisation");
  expect((await laneLabels(page, "LOR")).slice(slots)).toEqual([n(1), n(2), n(3)]);
  await expect(card(page, n(1))).toContainText("Opening crystallisation");
  await expect(card(page, n(3))).toContainText("Long term beats short term");
  // PMR: no red for the Opposition
  await page.keyboard.press("]");
  await expect(page.getByTestId("stagebar")).toHaveAttribute("data-stage", "PMR");
  await expect(page.locator(".card--red")).toHaveCount(0);
});

test("criterion 8: every card action by mouse and by hotkey, with visible hotkey hints", async ({ page }) => {
  await openNewRoom(page);
  await goStage(page, "PMC");
  await page.getByTestId("add-PMC-own").click();
  await page.keyboard.type("Oceans are 95% unexplored");
  await page.keyboard.press("Enter");
  await page.keyboard.type("We know nothing about the deep sea");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Ocean is cheaper");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await card(page, "OC1").dblclick(); // PM1's empty answer slot
  await typeAndEscape(page, "Unexplored is not more valuable");
  await page.keyboard.press("Escape");

  // hints: hovering a tool shows its name and hotkey
  await card(page, "PM2").hover();
  await card(page, "PM2").getByTestId("tool-strong").hover();
  await expect(page.getByRole("tooltip")).toContainText("Strong");
  await expect(page.getByRole("tooltip").locator("kbd")).toHaveText("S");
  await page.getByTestId("stage-next").hover();
  await expect(page.getByRole("tooltip").locator("kbd")).toHaveText("]");

  // strong: mouse + S
  await card(page, "PM2").hover();
  await card(page, "PM2").getByTestId("tool-strong").click();
  await expect(card(page, "PM2").getByTestId("card-strong")).toBeVisible();
  await card(page, "PM3").click();
  await page.keyboard.press("s");
  await expect(card(page, "PM3").getByTestId("card-strong")).toBeVisible();

  // tags by hotkey: W N T
  await page.keyboard.press("w");
  await page.keyboard.press("n");
  await page.keyboard.press("t");
  await expect(card(page, "PM3").locator(".chip")).toHaveText([/No warrant/, /Nonsense/, /Turn/]);
  // same as… (=) and contradicts… (C) open a card picker
  await page.keyboard.press("=");
  await expect(page.getByTestId("card-picker")).toBeVisible();
  await page.getByTestId("picker-input").fill("PM1");
  await page.keyboard.press("Enter");
  await expect(card(page, "PM3").getByTestId("tag-same-as")).toContainText("Same as");
  await expect(card(page, "PM3").getByTestId("tag-same-as")).toContainText("PM1");
  await card(page, "PM2").click();
  await page.keyboard.press("c");
  await page.getByTestId("pick-PM3").click();
  await expect(card(page, "PM2").getByTestId("tag-contradicts")).toContainText("PM3");
  // tags by mouse: tag menu
  await card(page, "PM1").hover();
  await card(page, "PM1").getByTestId("tool-tags").click();
  await page.getByTestId("menu-tag-turn").click();
  await expect(card(page, "PM1").getByTestId("tag-turn")).toBeVisible();

  // made (said): Cmd/Ctrl+Enter, the ✓ tool and the Made button
  await goStage(page, "LOC");
  await card(page, "OC1").click();
  await page.keyboard.press(`${MOD}+Enter`);
  await expect(card(page, "OC1")).toHaveAttribute("data-said", "true");
  await card(page, "OC1").getByTestId("tool-said").click();
  await expect(card(page, "OC1")).toHaveAttribute("data-said", "false");
  await card(page, "OC1").getByTestId("made").hover();
  await expect(page.getByRole("tooltip").locator("kbd")).toContainText("M");

  // new card: A (below the selected one — OC1 is still selected) and Enter while typing; delete: Del and ✕
  await expect(card(page, "OC1")).toHaveClass(/card--selected/);
  await page.keyboard.press("a");
  await typeAndEscape(page, "Second response");
  await expect(card(page, "OC4")).toContainText("Second response"); // unlinked: after the PM answer slots
  await card(page, "OC4").getByTestId("tool-delete").click();
  await expect(card(page, "OC4")).toHaveCount(0);

  // edit: Enter on the selected card; Esc leaves editing
  await page.keyboard.press("Escape");
  await card(page, "OC1").click();
  await expect(card(page, "OC1")).toHaveClass(/card--selected/);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("card-editor")).toBeFocused();
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  await page.keyboard.press("Escape");
  await expect(card(page, "OC1")).toContainText("Unexplored is not more valuable!");
  // double-click edits too (and a click on an already selected card, for touch)
  await card(page, "OC1").dblclick();
  await expect(page.getByTestId("card-editor")).toBeFocused();
  await page.keyboard.press("Escape");
  // undo
  await page.keyboard.press(`${MOD}+z`);
  await expect(card(page, "OC1").getByTestId("card-text")).toHaveText("Unexplored is not more valuable");

  // stages: [ and ]; command palette lists actions with their hotkeys
  await page.keyboard.press("[");
  await expect(page.getByTestId("stagebar")).toHaveAttribute("data-stage", "PMC");
  await page.keyboard.press("]");
  await expect(page.getByTestId("stagebar")).toHaveAttribute("data-stage", "LOC");
  await card(page, "PM1").click();
  await page.keyboard.press(`${MOD}+k`);
  await expect(page.getByTestId("palette")).toBeVisible();
  await expect(page.getByTestId("cmd-next-stage")).toContainText("]");
  await expect(page.getByTestId("cmd-strong")).toContainText("S");
  await expect(page.getByTestId("cmd-tag-no-warrant")).toContainText("W");
  await expect(page.getByTestId("cmd-tag-same-as")).toContainText("=");
  await page.getByTestId("palette-input").fill("strong");
  await page.keyboard.press("Enter");
  await expect(card(page, "PM1").getByTestId("card-strong")).toBeVisible();
  // the palette also opens from the top bar button (mouse / touch)
  await page.getByTestId("open-palette").click();
  await expect(page.getByTestId("palette")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("palette")).toBeHidden();
});

test("criterion 7: the same round for the Government gives GA / GC / GR", async ({ page }) => {
  await openNewRoom(page, { closeSetup: false });
  await page.getByTestId("side-gov").click();
  await expect(page.getByTestId("role-PM")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("setup-done").click();
  await expect(page.getByTestId("room")).toHaveAttribute("data-side", "gov");
  // PM column has only own arguments (nothing to answer yet)
  await expect(page.getByTestId("zone-PMC-clash")).toHaveCount(0);
  await page.getByTestId("add-thesis-PMC").click();
  await page.keyboard.type("The ocean is the nearer frontier");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Oceans are 95% unexplored");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Climate answers are in the ocean");
  await page.keyboard.press("Escape");
  expect(await laneLabels(page, "PMC")).toEqual(["GA1", "GA2"]);
  await goStage(page, "PMC");
  await card(page, "GA1").getByTestId("made").click();
  await page.keyboard.press("]");
  await expect(page.getByTestId("stagebar")).toHaveAttribute("data-stage", "LOC");
  expect(await laneLabels(page, "MG")).toEqual(["GA2"]);
  await expect(card(page, "GA2").getByTestId("plate-from")).toHaveText("from PM");
  await page.getByTestId("add-LOC-own").click();
  await typeAndEscape(page, "Space pays off long term");
  expect(await laneLabels(page, "LOC")).toEqual(["LO1"]);
  // LO1 got an empty answer slot in MG (GC1): fill it
  await page.keyboard.press("Escape");
  await card(page, "GC1").dblclick();
  await typeAndEscape(page, "Long term is speculative");
  await expect(card(page, "GC1")).toContainText("Long term is speculative");
  await goStage(page, "PMR");
  await page.getByTestId("add-PMR-clash").click();
  await typeAndEscape(page, "Answer to MO's new STEM point");
  const gr = (await laneLabels(page, "PMR")).at(-1)!;
  expect(gr).toMatch(/^GR\d+$/);
  await expect(card(page, gr)).toContainText("Answer to MO's new STEM point");
  await expect(card(page, gr)).toHaveAttribute("data-red", "false");
  await expect(card(page, "GA2")).toHaveAttribute("data-red", "true");
  await expect(card(page, "GC1")).toHaveAttribute("data-red", "true");
  await expect(card(page, "GA1")).toHaveAttribute("data-red", "false");
});

test("criterion 9: two devices see stage, cards and strike-throughs in sync", async ({ browser }) => {
  const a = await newDevice(browser);
  const b = await newDevice(browser);
  const code = await openNewRoom(a.page);
  await waitSynced(a.page);
  await openRoom(b.page, code);
  await waitSynced(b.page);
  await a.page.getByTestId("add-LOC-clash").click();
  await typeAndEscape(a.page, "Unexplored is not more valuable");
  await b.page.getByTestId("add-loose-LOC").click();
  await typeAndEscape(b.page, "Asteroid mining unlocks scarce metals");
  await expect(card(a.page, "OA1")).toContainText("Asteroid mining");
  await expect(card(b.page, "OC1")).toContainText("Unexplored");
  // stage from B, strike from A
  await b.page.getByTestId("stage-LOC").click();
  await expect(a.page.getByTestId("stagebar")).toHaveAttribute("data-stage", "LOC");
  await card(a.page, "OC1").getByTestId("made").click();
  await expect(card(b.page, "OC1")).toHaveAttribute("data-struck", "true");
  await expect(b.page.getByTestId("counter-LOC")).toHaveText(/said\s*1 \/ 2/);
  // carry-over is visible on both
  await a.page.getByTestId("stage-next").click();
  await expect(b.page.getByTestId("stagebar")).toHaveAttribute("data-stage", "MG");
  expect(await laneLabels(b.page, "MO")).toEqual(["OA1"]);
  await a.ctx.close();
  await b.ctx.close();
});

test("criterion 10: a different format config changes stages and columns (no code changes)", async ({ page }) => {
  await openNewRoom(page);
  await expect(page.getByTestId("stepper").locator(".stage-pill")).toHaveText(["Prep", "PMC", "LOC", "MG", "MO", "LOR", "PMR", "Review"]);
  // switch this room to the hidden demo format (config only)
  await page.evaluate(() => {
    const s = (window as unknown as { __debatable: { doc: { getMap(n: string): { set(k: string, v: string): void } } } }).__debatable;
    s.doc.getMap("room").set("format", "demo-mini");
  });
  await expect(page.getByTestId("stepper").locator(".stage-pill")).toHaveText(["Warm-up", "SOUTH", "NORTH", "N-SUM", "Debrief"]);
  await expect(page.locator("[data-lane]")).toHaveCount(3);
  await expect(page.getByTestId("room")).toHaveAttribute("data-side", "north");
  await page.getByTestId("add-thesis-NORTH").click();
  await page.keyboard.type("Main line");
  await page.keyboard.press("Enter");
  await typeAndEscape(page, "First");
  await expect(card(page, "NP1")).toBeVisible();
  await goStage(page, "SOUTH");
  await page.getByTestId("add-SOUTH-own").click();
  await typeAndEscape(page, "Their opener");
  await expect(card(page, "SO1")).toBeVisible();
  await goStage(page, "NSUM");
  await expect(card(page, "NP1")).toHaveAttribute("data-red", "true");
});

test("touch: on a tablet the main actions work by tapping", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.getByTestId("room")).toBeVisible();
  if (await page.getByTestId("setup-panel").isVisible()) await page.getByTestId("setup-close").tap();
  await page.getByTestId("view-board").tap(); // stage 2: a new round in Prep opens in the Doc view
  // empty board area between two lanes (tapping it ends editing and clears the selection)
  const background = () => page.getByTestId("board").tap({ position: { x: 976, y: 400 } });
  // create and type, tap away to finish
  await page.getByTestId("add-LOC-clash").tap();
  await page.keyboard.type("Unexplored is not more valuable");
  await background();
  await expect(card(page, "OC1")).toContainText("Unexplored is not more valuable");
  // stages by tapping
  await page.getByTestId("stage-next").tap();
  await expect(page.getByTestId("stagebar")).toHaveAttribute("data-stage", "PMC");
  await page.getByTestId("add-PMC-own").tap();
  await page.keyboard.type("Oceans are 95% unexplored");
  await background();
  // tap selects; the card toolbar is then there for touch
  await card(page, "PM1").tap();
  await expect(card(page, "PM1")).toHaveClass(/card--selected/);
  await card(page, "PM1").getByTestId("tool-strong").tap();
  await expect(card(page, "PM1").getByTestId("card-strong")).toBeVisible();
  await card(page, "PM1").getByTestId("tool-tags").tap();
  await page.getByTestId("menu-tag-no-warrant").tap();
  await expect(card(page, "PM1").getByTestId("tag-no-warrant")).toBeVisible();
  // a second tap on the selected card edits it
  await card(page, "PM1").tap();
  await expect(page.getByTestId("card-editor")).toBeVisible();
  await background();
  // Made by tapping (PM1's empty answer slot is OC1 now; the earlier response became OC2)
  await page.getByTestId("stage-next").tap();
  await expect(card(page, "OC2")).toContainText("Unexplored is not more valuable");
  await card(page, "OC2").getByTestId("made").tap();
  await expect(card(page, "OC2")).toHaveAttribute("data-struck", "true");
  await expect(page.getByTestId("counter-LOC")).toHaveText(/said\s*1 \/ 1/);
  // command palette from the top bar
  await page.getByTestId("open-palette").tap();
  await page.getByTestId("cmd-next-stage").tap();
  await expect(page.getByTestId("stagebar")).toHaveAttribute("data-stage", "MG");
  await ctx.close();
});
