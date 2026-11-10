import { expect, test } from "@playwright/test";
import { card, newDevice, openNewRoom, openRoom, typeAndEscape, waitSynced } from "./helpers";

/** Feature 01: entry and saving (no login, room codes, live sync, server persistence). */

test("opening the site creates a room and shows the board right away; setup and invite are non-blocking", async ({ page }) => {
  const code = await openNewRoom(page, { closeSetup: false });
  expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/);
  // the board is there behind the setup panel
  await expect(page.getByTestId("board")).toBeVisible();
  await expect(page.getByTestId("lane-LOC")).toBeVisible();
  // setup panel with defaults: Opposition, LO, APDA times
  const setup = page.getByTestId("setup-panel");
  await expect(setup).toBeVisible();
  await expect(page.getByTestId("side-opp")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("role-LO")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("time-PMC")).toHaveValue("7:00");
  await expect(page.getByTestId("time-LOR")).toHaveValue("4:00");
  await expect(page.getByTestId("time-PMR")).toHaveValue("5:00");
  await page.getByTestId("setup-close").click();
  await expect(setup).toBeHidden();
  // invite banner: code, /r/CODE link and QR
  await expect(page.getByTestId("invite-code")).toHaveText(code);
  await expect(page.getByTestId("invite-link")).toContainText(`/r/${code}`);
  await page.getByTestId("show-qr").click();
  await expect(page.getByTestId("qr").locator("svg")).toBeVisible();
  // no "expires" text anywhere
  await expect(page.getByText(/expire(s|d)? after/i)).toHaveCount(0);
});

test("reopening the site on the same device opens the last round without typing anything", async ({ page }) => {
  const code = await openNewRoom(page);
  await page.getByTestId("topbar-motion").click();
  await page.getByTestId("motion-input").fill("THW prioritise ocean exploration over space exploration");
  await page.getByTestId("setup-close").click();
  await page.goto("/");
  await expect(page).toHaveURL(new RegExp(`/r/${code}$`));
  await expect(page.getByTestId("topbar-motion")).toHaveText("THW prioritise ocean exploration over space exploration");
  // the round is in "Recent on this device"; "New round" is always there
  await page.getByTestId("rounds-menu").click();
  await expect(page.getByTestId("recent-item").filter({ hasText: code })).toBeVisible();
  await page.getByTestId("new-round").click();
  await expect(page).not.toHaveURL(new RegExp(`/r/${code}$`));
  await page.getByTestId("rounds-menu").click();
  await page.getByTestId("recent-item").filter({ hasText: code }).click();
  await expect(page).toHaveURL(new RegExp(`/r/${code}$`));
});

test("a wrong code says so", async ({ page }) => {
  await openNewRoom(page);
  await page.getByTestId("join-input").fill("ZZZZ9");
  await page.getByTestId("join-input").press("Enter");
  await expect(page.getByTestId("not-found")).toContainText("No round with code ZZZZ9");
});

test("two devices: join by code, live sync, same-card typing merges, partner highlight, server persistence", async ({ browser }) => {
  const a = await newDevice(browser);
  const b = await newDevice(browser);
  const code = await openNewRoom(a.page);
  await waitSynced(a.page);

  // partner joins with "Have a code?"
  await b.page.goto("/");
  await expect(b.page.getByTestId("room")).toBeVisible();
  if (await b.page.getByTestId("setup-panel").isVisible()) await b.page.getByTestId("setup-close").click();
  await b.page.getByTestId("join-input").fill(code.toLowerCase());
  await b.page.getByTestId("join-input").press("Enter");
  await expect(b.page).toHaveURL(new RegExp(`/r/${code}$`));
  await waitSynced(b.page);

  // presence: auto-generated names and colours, never the same
  await expect(a.page.getByTestId("partner")).toBeVisible();
  await expect(b.page.getByTestId("partner")).toBeVisible();
  const meA = (await a.page.getByTestId("me").textContent())!;
  const meB = (await b.page.getByTestId("me").textContent())!;
  const nameColor = (s: string) => s.replace(/^You: \S+ \(/, "").replace(/\)$/, "").split(", ");
  expect(nameColor(meA)[0]).not.toBe(nameColor(meB)[0]);
  expect(nameColor(meA)[1]).not.toBe(nameColor(meB)[1]);
  await expect(a.page.getByTestId("invite-banner")).toBeHidden();

  // A writes a card, B sees it
  await a.page.getByTestId("add-LOC-clash").click();
  await typeAndEscape(a.page, "Unexplored is not the same as valuable");
  await expect(card(b.page, "OC1")).toContainText("Unexplored is not the same as valuable");

  // both type into the same card at once: text merges character by character
  await a.page.getByTestId("add-LOC-clash").click();
  await a.page.keyboard.type("AAA");
  await expect(card(b.page, "OC2")).toContainText("AAA");
  // B sees A's colour on the card A is typing in
  await expect(card(b.page, "OC2")).toHaveClass(/card--partner/);
  await card(b.page, "OC2").dblclick();
  await b.page.keyboard.press("End");
  await Promise.all([a.page.keyboard.type(" alpha alpha", { delay: 15 }), b.page.keyboard.type(" beta beta", { delay: 15 })]);
  await a.page.keyboard.press("Escape");
  await b.page.keyboard.press("Escape");
  for (const p of [a.page, b.page]) {
    await expect(card(p, "OC2")).toContainText("alpha alpha");
    await expect(card(p, "OC2")).toContainText("beta beta");
    await expect(card(p, "OC2")).toContainText("AAA");
  }
  const textA = await card(a.page, "OC2").getByTestId("card-text").textContent();
  const textB = await card(b.page, "OC2").getByTestId("card-text").textContent();
  expect(textA).toBe(textB);

  // stage is shared room state
  await a.page.getByTestId("stage-next").click();
  await expect(b.page.getByTestId("stagebar")).toHaveAttribute("data-stage", "PMC");

  // server persistence: a third device that never saw the room loads it from the server
  await a.ctx.close();
  await b.ctx.close();
  const c = await newDevice(browser);
  await openRoom(c.page, code);
  await waitSynced(c.page);
  await expect(card(c.page, "OC1")).toContainText("Unexplored is not the same as valuable");
  await expect(c.page.getByTestId("stagebar")).toHaveAttribute("data-stage", "PMC");
  await c.ctx.close();
});

test("offline-first: edits are kept on the device and sync when the network is back", async ({ browser }) => {
  const a = await newDevice(browser);
  const code = await openNewRoom(a.page);
  await waitSynced(a.page);
  // lose the connection
  await a.page.evaluate(() => (window as unknown as { __debatable: { provider: { disconnect(): void } } }).__debatable.provider.disconnect());
  await expect(a.page.getByTestId("sync-status")).toHaveAttribute("data-status", "offline");
  await a.page.getByTestId("add-LOC-clash").click();
  await typeAndEscape(a.page, "Written offline");
  // reload with the server unreachable: the card comes back from the device (IndexedDB)
  let online = false;
  await a.page.routeWebSocket(/\/parties\//, (ws) => {
    if (online) ws.connectToServer(); // otherwise the server is unreachable
  });
  await a.page.reload();
  await expect(card(a.page, "OC1")).toContainText("Written offline");
  await expect(a.page.getByTestId("sync-status")).not.toHaveAttribute("data-status", "synced");
  // another device does not have it yet
  const b = await newDevice(browser);
  await openRoom(b.page, code);
  await waitSynced(b.page);
  await expect(card(b.page, "OC1")).toHaveCount(0);
  // network back: background sync delivers it
  online = true;
  await a.page.reload();
  await waitSynced(a.page);
  await expect(card(b.page, "OC1")).toContainText("Written offline");
  await a.ctx.close();
  await b.ctx.close();
});
