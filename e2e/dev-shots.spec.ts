import { expect, test } from "@playwright/test";
import { card, goStage, openNewRoom, typeAndEscape } from "./helpers";
import { MOTION, pmcWithAnswers, prepOnBoard } from "./ocean";

/** Dev utility (not part of the suite): SHOTS=<dir> renders the board at the mock's size for comparison. */
const dir = process.env.SHOTS;
test.skip(!dir, "set SHOTS=<dir> to render comparison screenshots");

test("board screenshots", async ({ page }) => {
  await openNewRoom(page);
  await page.getByTestId("topbar-motion").click();
  await page.getByTestId("motion-input").fill(MOTION);
  await page.getByTestId("setup-close").click();
  if (await page.getByTestId("view-board").getAttribute("aria-checked") !== "true") await page.getByTestId("view-board").click();
  await page.getByTestId("invite-banner").getByRole("button", { name: "Hide invite" }).click();
  await prepOnBoard(page);
  await pmcWithAnswers(page);
  await page.screenshot({ path: `${dir}/pmc.png` });
  await page.keyboard.press("]");
  for (const l of ["OC1", "OC2", "OC3", "OC5", "OA1", "OA3", "OA5"]) await card(page, l).getByTestId("made").click();
  await page.screenshot({ path: `${dir}/loc.png` });
  await page.keyboard.press("Escape");
  await page.keyboard.press("]");
  await expect(page.getByTestId("stagebar")).toHaveAttribute("data-stage", "MG");
  await card(page, "OA1").click();
  await page.keyboard.press("r");
  await typeAndEscape(page, "Asteroid mining is decades away");
  await page.keyboard.press("Escape");
  await page.getByTestId("add-MG-own").click();
  await typeAndEscape(page, "Earth's problems come first");
  await page.keyboard.press("Escape");
  await card(page, "MG1").click();
  await page.keyboard.press("r");
  await typeAndEscape(page, "Decades away is still a payoff");
  await page.keyboard.press("Escape");
  await page.mouse.click(1300, 800);
  await page.screenshot({ path: `${dir}/mg.png` });
  await page.keyboard.press("]");
  await expect(page.getByTestId("stagebar")).toHaveAttribute("data-stage", "MO");
  await card(page, "OC5").getByTestId("made").click();
  await card(page, "OA2").getByTestId("made").click();
  await page.keyboard.press("Escape");
  await page.mouse.click(1300, 800);
  await page.screenshot({ path: `${dir}/mo.png` });
  await goStage(page, "LOR");
  await page.mouse.click(1300, 800);
  await page.screenshot({ path: `${dir}/lor.png` });
});
