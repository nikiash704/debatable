import { expect, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";

export const MOD = process.platform === "darwin" ? "Meta" : "Control";

/**
 * Opens the site: a room is created and shows right away (no entry screen). A new round is in Prep, which
 * opens the Doc view (stage 2); `view: "board"` (default, what the stage-1 tests expect) switches to the Board.
 */
export async function openNewRoom(page: Page, { closeSetup = true, view = "board" }: { closeSetup?: boolean; view?: "board" | "doc" } = {}): Promise<string> {
  await page.goto("/");
  const room = page.getByTestId("room");
  await expect(room).toBeVisible();
  await expect(page).toHaveURL(/\/r\/[A-Z0-9]{5}$/);
  const code = (await room.getAttribute("data-code"))!;
  if (closeSetup && (await page.getByTestId("setup-panel").isVisible())) await page.getByTestId("setup-close").click();
  await showView(page, view);
  return code;
}

export async function openRoom(page: Page, code: string, { view = "board" }: { view?: "board" | "doc" } = {}) {
  await page.goto(`/r/${code}`);
  await expect(page.getByTestId("room")).toBeVisible();
  await showView(page, view);
}

/** Board / Doc switch in the top bar. */
export async function showView(page: Page, view: "board" | "doc") {
  const opt = page.getByTestId(`view-${view}`);
  if ((await opt.getAttribute("aria-checked")) !== "true") await opt.click();
  await expect(page.getByTestId(view === "board" ? "board" : "doc-view")).toBeVisible();
}

export async function newDevice(browser: Browser): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  return { ctx, page };
}

export async function waitSynced(page: Page) {
  await expect(page.getByTestId("sync-status")).toHaveAttribute("data-status", "synced", { timeout: 15_000 });
}

export function card(page: Page, label: string): Locator {
  return page.locator(`[data-testid="card"][data-label="${label}"]`);
}

export function lane(page: Page, speech: string): Locator {
  return page.getByTestId(`lane-${speech}`);
}

/** Labels of a lane's cards in on-screen order. */
export async function laneLabels(page: Page, speech: string): Promise<string[]> {
  return lane(page, speech).locator('[data-testid="card"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-label") ?? ""));
}

/** Types into the card/point/thesis editor that currently has focus, then leaves editing. */
export async function typeAndEscape(page: Page, text: string) {
  await page.keyboard.type(text);
  await page.keyboard.press("Escape");
}

export async function goStage(page: Page, stage: string) {
  await page.getByTestId(`stage-${stage}`).click();
  await expect(page.getByTestId("stagebar")).toHaveAttribute("data-stage", stage);
}
