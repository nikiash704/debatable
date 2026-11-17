import { expect, test, type Locator, type Page } from "@playwright/test";
import { MOD, openNewRoom, showView } from "./helpers";

/**
 * AI ghost text (docs/plans/ai-suggestions.md, Phase 1c). The endpoint is always mocked here:
 * never the real model in tests. Set GHOST_SHOTS=<dir> to also save screenshots of each field.
 */

const SHOTS = process.env.GHOST_SHOTS;

/** Canned continuations by the last words before the caret; anything else gets a long one that wraps. */
const REPLIES: Record<string, string> = {
  "Space is the bigger": " long-term payoff for humanity.",
  "Asteroid mining unlocks scarce": " metals that Earth is running out of.",
  "Platinum group metals are": " rare on Earth.",
  "THW prioritise ocean exploration": " over space exploration",
};
const LONG = " because every argument here needs a much longer ending that wraps onto another line of the field.";

interface Mock {
  requests: { before: string; field: string; room: string; device: string }[];
}

async function mockSuggest(page: Page, { status = 200, delay = 0 }: { status?: number; delay?: number } = {}): Promise<Mock> {
  const mock: Mock = { requests: [] };
  await page.route("**/api/suggest", async (route) => {
    const body = route.request().postDataJSON() as Mock["requests"][number];
    mock.requests.push(body);
    if (delay) await new Promise((r) => setTimeout(r, delay));
    const key = Object.keys(REPLIES).find((k) => body.before.endsWith(k));
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ text: key ? REPLIES[key] : LONG }) }).catch(() => {});
  });
  return mock;
}

const ghost = (page: Page) => page.getByTestId("ghost");

/** Boxes of the field, its container and the whole page body: nothing may move when a ghost appears. */
async function layout(page: Page, editor: Locator) {
  return editor.evaluate((el) => {
    const r = (e: Element | null) => {
      const b = e?.getBoundingClientRect();
      return b ? [b.x, b.y, b.width, b.height].map((v) => Math.round(v * 100) / 100).join(",") : "";
    };
    const all = Array.from(document.querySelectorAll('[data-testid="card"], [data-testid="thesis"], [data-doc-key], .field, textarea'));
    return { field: r(el), parent: r(el.parentElement?.parentElement ?? null), body: r(document.body), height: document.body.scrollHeight, all: all.map(r).join("|") };
  });
}

/**
 * The mirror draws the same glyphs at the same spots as the textarea: paint the mirror's text and
 * hide the textarea's, then compare with the normal rendering, pixel for pixel.
 */
async function mirrorMatches(editor: Locator): Promise<boolean> {
  // 1px inside the field: the text never touches its edges, and edge pixels can pick up
  // sub-pixel differences from the selected row's rounded background
  const b = (await editor.boundingBox())!;
  const clip = { x: b.x + 1, y: b.y + 1, width: b.width - 2, height: b.height - 2 };
  const shot = () => editor.page().screenshot({ clip, animations: "disabled", caret: "hide" });
  await editor.evaluate((el) => {
    const g = el.parentElement!.querySelector<HTMLElement>(".ed-ghost__rest")!;
    g.style.visibility = "hidden";
  });
  const real = await shot();
  await editor.evaluate((el) => {
    const t = el.parentElement!.querySelector<HTMLElement>(".ed-ghost__text")!;
    t.style.color = getComputedStyle(el).color;
    (el as HTMLElement).style.color = "transparent";
  });
  const mirrored = await shot();
  await editor.evaluate((el) => {
    el.parentElement!.querySelector<HTMLElement>(".ed-ghost__text")!.style.color = "";
    el.parentElement!.querySelector<HTMLElement>(".ed-ghost__rest")!.style.visibility = "";
    (el as HTMLElement).style.color = "";
  });
  if (real.equals(mirrored)) return true;
  // glyph anti-aliasing may differ by a level or two between a textarea and a div; a misplaced
  // glyph differs by far more
  const bad = await editor.page().evaluate(
    async ([a, b]) => {
      const load = async (src: string) => {
        const img = new Image();
        img.src = `data:image/png;base64,${src}`;
        await img.decode();
        const cv = document.createElement("canvas");
        cv.width = img.width;
        cv.height = img.height;
        const ctx = cv.getContext("2d")!;
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, img.width, img.height).data;
      };
      const [x, y] = [await load(a!), await load(b!)];
      let n = 0;
      for (let i = 0; i < x.length; i++) if (Math.abs(x[i]! - y[i]!) > 24) n++;
      return n;
    },
    [real.toString("base64"), mirrored.toString("base64")],
  );
  return bad === 0;
}

/** A screenshot of the field with some of the page around it (the ghost may overflow below). */
async function shotAround(editor: Locator, name: string) {
  const b = (await editor.boundingBox())!;
  const x = Math.max(0, b.x - 60);
  const y = Math.max(0, b.y - 50);
  await editor.page().screenshot({ path: `${SHOTS}/ghost-${name}.png`, clip: { x, y, width: b.width + 120, height: b.height + 130 } });
}

/** Types, waits for the ghost, and checks it lines up without moving anything. */
async function expectGhost(page: Page, editor: Locator, text: string, rest: string, shot: string) {
  await page.keyboard.type(text);
  const before = await layout(page, editor);
  await expect(ghost(page)).toHaveText(rest);
  expect(await layout(page, editor)).toEqual(before);
  expect(await mirrorMatches(editor)).toBe(true);
  // the gray text starts right after the last typed character
  if (SHOTS) await shotAround(editor, shot);
}

test("ghost text in a thesis, card and point; → accepts; one undo removes it", async ({ page }) => {
  const mock = await mockSuggest(page);
  await openNewRoom(page);
  await page.getByTestId("add-thesis-LOC").click();
  const thesis = page.getByTestId("thesis-editor");
  await expectGhost(page, thesis, "Space is the bigger", " long-term payoff for humanity.", "thesis");
  expect(mock.requests.at(-1)).toMatchObject({ before: "Space is the bigger", field: "thesis" });
  expect(mock.requests.at(-1)!.device).toMatch(/^dev-/);

  // → accepts and puts the caret at the end
  await page.keyboard.press("ArrowRight");
  await expect(thesis).toHaveValue("Space is the bigger long-term payoff for humanity.");
  await expect(ghost(page)).toHaveCount(0);
  expect(await thesis.evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd, el.value.length])).toEqual([50, 50, 50]);
  // one undo step removes exactly the accepted text
  await page.keyboard.press(`${MOD}+z`);
  await expect(thesis).toHaveValue("Space is the bigger");

  // Enter still makes the first card; the ghost does not come along
  await page.keyboard.press("Enter");
  const cardEd = page.getByTestId("card-editor");
  await expect(cardEd).toBeFocused();
  await expectGhost(page, cardEd, "Asteroid mining unlocks scarce", " metals that Earth is running out of.", "card");

  // type-through: matching letters keep the rest, no new request
  const n = mock.requests.length;
  await page.keyboard.type(" met");
  await expect(ghost(page)).toHaveText("als that Earth is running out of.");
  // a different letter drops it
  await page.keyboard.type("x");
  await expect(ghost(page)).toHaveCount(0);
  await page.waitForTimeout(1000);
  expect(mock.requests.length).toBe(n + 1); // one request for "…metx" after the pause
  await expect(ghost(page)).toHaveText(LONG);
  // a caret move away from the end drops it
  await page.keyboard.press("ArrowLeft");
  await expect(ghost(page)).toHaveCount(0);
  await page.keyboard.press("End");

  // Tab still indents (the ghost is dropped, never accepted)
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  const point = page.getByTestId("point-editor");
  await expect(point).toBeFocused();
  await expectGhost(page, point, "Platinum group metals are", " rare on Earth.", "point");
  // the long one wraps like text and still moves nothing
  await page.keyboard.press("Backspace");
  await page.keyboard.type("e,");
  await expect(ghost(page)).toHaveText(LONG);
  expect(await mirrorMatches(point)).toBe(true);
  if (SHOTS) await shotAround(point, "point-wrap");

  // Esc still stops editing and the ghost goes with it
  await page.keyboard.press("Escape");
  await expect(ghost(page)).toHaveCount(0);
  await expect(page.getByTestId("point-editor")).toHaveCount(0);
});

test("ghost text in a Doc view line and the motion; a tap on the gray text accepts", async ({ page }) => {
  await mockSuggest(page);
  await openNewRoom(page, { view: "doc" });
  await page.getByTestId("doc-add-thesis").click();
  const line = page.getByTestId("doc-editor-thesis").first();
  await expect(line).toBeFocused();
  await expectGhost(page, line, "Space is the bigger", " long-term payoff for humanity.", "doc");
  await ghost(page).click();
  await expect(line).toHaveValue("Space is the bigger long-term payoff for humanity.");
  await expect(line).toBeFocused();
  await expect(ghost(page)).toHaveCount(0);

  await showView(page, "board");
  await page.getByTestId("topbar-motion").click();
  const motion = page.getByTestId("motion-input");
  await motion.click();
  await expectGhost(page, motion, "THW prioritise ocean exploration", " over space exploration", "motion");
  await page.keyboard.press("ArrowRight");
  await expect(motion).toHaveValue("THW prioritise ocean exploration over space exploration");
});

test("no request for short or finished sentences; errors and slow answers stay silent", async ({ page }) => {
  const mock = await mockSuggest(page, { status: 500 });
  await openNewRoom(page);
  await page.getByTestId("add-thesis-LOC").click();
  await page.keyboard.type("Two words");
  await page.waitForTimeout(1000);
  await page.keyboard.type(" and done.");
  await page.waitForTimeout(1000);
  expect(mock.requests.length).toBe(0);
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(1000);
  expect(mock.requests.length).toBe(1);
  await expect(ghost(page)).toHaveCount(0);

  // a slow answer is dropped when the user types on (the request is aborted)
  await page.unroute("**/api/suggest");
  const slow = await mockSuggest(page, { delay: 1500 });
  await page.keyboard.type(" again");
  await page.waitForTimeout(900);
  expect(slow.requests.length).toBe(1);
  await page.keyboard.type(" now");
  await page.waitForTimeout(3000);
  await expect(ghost(page)).toHaveText(LONG); // only the answer for the latest text shows
  await expect(page.getByTestId("thesis-editor")).toHaveValue("Two words and done again now");
});
