import { expect, type Page } from "@playwright/test";
import { card, laneLabels, typeAndEscape } from "./helpers";

/**
 * "Ocean vs Space" (we are the Opposition), driven through the UI. Same data as e2e/flow.spec.ts and the
 * engine tests. Used by the stage-2 acceptance tests.
 */
export const MOTION = "THW prioritise ocean exploration over space exploration";

export const OUTLINE: { thesis: string; cards: { text: string; points: string[] }[] }[] = [
  {
    thesis: "Space is the bigger long-term payoff",
    cards: [
      { text: "Asteroid mining unlocks scarce metals", points: ["Platinum-group metals", "No seabed damage"] },
      { text: "Planetary backup for humanity", points: ["Extinction-level risks"] },
    ],
  },
  {
    thesis: "Space tech already pays off on Earth",
    cards: [
      { text: "Satellites run climate monitoring", points: ["Sea-level data comes from orbit"] },
      { text: "Spin-offs: GPS, solar cells, water filters", points: ["Everyday tech"] },
    ],
  },
  {
    thesis: "Ocean exploration harms what it studies",
    cards: [
      { text: "Deep-sea mining destroys ecosystems", points: ["Plumes travel hundreds of km"] },
      { text: "Ocean research is already funded", points: ["Private and military money"] },
    ],
  },
];

export const PM = ["Oceans are 95% unexplored", "Climate answers are in the ocean", "Cheaper per discovery", "Food security", "Space race is militarised"];
export const OC = ["Unexplored is not more valuable", "Satellites already watch the ocean", "Ignores spin-offs", "Treaties limit militarisation"];

/** Prep on the board with stage-1 keys (Enter on a thesis title = its first card). */
export async function prepOnBoard(page: Page) {
  const k = page.keyboard;
  await page.getByTestId("add-thesis-LOC").click();
  for (const [ti, t] of OUTLINE.entries()) {
    if (ti > 0) await k.press("Shift+Tab"); // empty card → thesis
    await k.type(t.thesis);
    await k.press("Enter");
    for (const [ci, c] of t.cards.entries()) {
      if (ci > 0) await k.press("Shift+Tab"); // empty point → card
      await k.type(c.text);
      await k.press("Enter");
      await k.press("Tab");
      for (const [pi, p] of c.points.entries()) {
        if (pi > 0) await k.press("Enter");
        await k.type(p);
      }
      await k.press("Enter");
    }
    await k.press("Shift+Tab"); // empty point → card
  }
  await k.press("Backspace"); // drop the trailing empty card
  await k.press("Escape");
  expect(await laneLabels(page, "LOC")).toEqual(["OA1", "OA2", "OA3", "OA4", "OA5", "OA6"]);
}

/** Prep in the Doc view (Enter = same level, Tab / Shift+Tab = level). */
export async function prepInDoc(page: Page) {
  const k = page.keyboard;
  await page.getByTestId("doc-add-thesis").click();
  for (const [ti, t] of OUTLINE.entries()) {
    if (ti > 0) {
      await k.press("Shift+Tab"); // point → card
      await k.press("Shift+Tab"); // card → thesis
    }
    await k.type(t.thesis);
    await k.press("Enter"); // new thesis line…
    await k.press("Tab"); // …becomes card "a." of this thesis
    for (const [ci, c] of t.cards.entries()) {
      if (ci > 0) await k.press("Shift+Tab"); // point → card
      await k.type(c.text);
      await k.press("Enter");
      await k.press("Tab"); // → point
      for (const [pi, p] of c.points.entries()) {
        if (pi > 0) await k.press("Enter");
        await k.type(p);
      }
      await k.press("Enter");
    }
  }
  await k.press("Backspace"); // drop the trailing empty point
  await k.press("Escape");
}

/** PMC: PM1–PM5; OC1–OC3 by Answer (R); OC4 with "+" then Link (L) to PM5. */
export async function pmcWithAnswers(page: Page) {
  await page.getByTestId("stage-next").click();
  await expect(page.getByTestId("stagebar")).toHaveAttribute("data-stage", "PMC");
  await page.getByTestId("add-PMC-own").click();
  for (const [i, t] of PM.entries()) {
    if (i > 0) await page.keyboard.press("Enter");
    await page.keyboard.type(t);
  }
  await page.keyboard.press("Escape");
  for (let i = 0; i < 3; i++) {
    await card(page, `PM${i + 1}`).click();
    await page.keyboard.press("r");
    await typeAndEscape(page, OC[i]);
  }
  await page.getByTestId("add-LOC-clash").click();
  await typeAndEscape(page, OC[3]);
  await page.keyboard.press("l");
  await expect(page.getByTestId("pick-banner")).toBeVisible();
  await card(page, "PM5").click();
  await page.keyboard.press("Escape");
}
