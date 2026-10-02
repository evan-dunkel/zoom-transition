import { expect, test, type Page } from "@playwright/test";
import { openBook } from "./helpers";

// Sideways two-finger swipes on a trackpad arrive as wheel events: the finger's
// own movement, then (after lift) momentum that only ever slows down.

const activeIndex = (page: Page) =>
  page.evaluate(() => {
    const cards = [...document.querySelectorAll(".zoom-card")];
    return cards.findIndex((el) => !el.hasAttribute("inert"));
  });

async function wheelX(page: Page, deltas: number[]) {
  for (const dx of deltas) {
    await page.mouse.wheel(dx, 0);
    await page.waitForTimeout(16);
  }
}
/** Fingers moving sideways: speeds up, then holds. */
const finger = (dir: 1 | -1) => [3, 8, 16, 26, 32, 32].map((d) => d * dir);
/** Momentum after lifting: decays from `from` (px per event) down to nothing. */
const momentum = (dir: 1 | -1, from = 30, to = 1) => {
  const out: number[] = [];
  for (let d = from; d >= to; d *= 0.85) out.push(Math.round(d) * dir);
  return out;
};

test.beforeEach(async ({ page }) => {
  await page.goto("/dist/");
  await openBook(page, 1);
  await page.mouse.move(215, 500);
});

test("one swipe and its momentum turn one page", async ({ page }) => {
  await wheelX(page, [...finger(1), ...momentum(1)]);
  await expect.poll(() => activeIndex(page)).toBe(2);
  await page.waitForTimeout(300);
  expect(await activeIndex(page)).toBe(2);
});

test("a pause before momentum starts doesn't turn a second page", async ({ page }) => {
  await wheelX(page, finger(1));
  // macOS can wait ~200 ms between lift and momentum (here ~120 ms plus the ~50 ms
  // headless Chromium takes per wheel event).
  await page.waitForTimeout(120);
  await wheelX(page, momentum(1));
  await page.waitForTimeout(300);
  expect(await activeIndex(page)).toBe(2);
});

test("a new swipe during the last one's momentum turns the next page", async ({ page }) => {
  await wheelX(page, [...finger(1), ...momentum(1, 30, 12)]); // fingers back down mid-momentum
  await wheelX(page, finger(1));
  await expect.poll(() => activeIndex(page)).toBe(3);
});

test("swiping back during momentum turns back", async ({ page }) => {
  await wheelX(page, [...finger(1), ...momentum(1, 30, 12)]);
  await expect.poll(() => activeIndex(page)).toBe(2);
  await wheelX(page, finger(-1));
  await expect.poll(() => activeIndex(page)).toBe(1);
});

test("quick swipes in a row turn a page each", async ({ page }) => {
  for (let i = 0; i < 3; i++) await wheelX(page, [...finger(1), ...momentum(1, 30, 15)]);
  await expect.poll(() => activeIndex(page)).toBe(4);
});
