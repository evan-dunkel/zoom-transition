import { expect, test, type Page } from "@playwright/test";
import { SCROLLER, expectCloses, expectStaysOpen, phase } from "./helpers";

// The feed prototype: a vertical pager. Up and down pages; sideways, Escape and the
// close button close.

const active = (page: Page) => page.locator(".zoom-card:not([inert])").getAttribute("data-zoom-id");
const ids = (page: Page) =>
  page.locator(".zoom-card").evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.zoomId!));

async function openFeed(page: Page, nth = 4) {
  await page.goto("/dist/");
  await page.getByRole("button", { name: "Feed" }).click();
  await page.locator(".tile").nth(nth).click();
  await expect.poll(() => phase(page)).toBe("open");
}

/** A one-finger drag from (x0, y0) to (x1, y1), sent as real touch events. */
async function touchPath(page: Page, x0: number, y0: number, x1: number, y1: number, steps = 12) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t }] });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

/** A trackpad swipe: several wheel events in a row. */
async function swipe(page: Page, dx: number, dy: number, events = 6) {
  await page.mouse.move(215, 450);
  for (let i = 0; i < events; i++) {
    await page.mouse.wheel(dx, dy);
    await page.waitForTimeout(30);
  }
}

test("cards are stacked vertically and fill the height", async ({ page }) => {
  await openFeed(page);
  const boxes = await page.locator(".zoom-card").evaluateAll((els) =>
    els.slice(3, 6).map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }),
  );
  // The visible card (index 4) sits in the viewport; its neighbours are directly above and below.
  expect(boxes[1].y).toBeGreaterThanOrEqual(0);
  expect(boxes[1].h).toBeGreaterThan(800);
  expect(boxes[0].x).toBeCloseTo(boxes[1].x, 0);
  expect(boxes[2].x).toBeCloseTo(boxes[1].x, 0);
  expect(boxes[0].y + boxes[0].h).toBeLessThanOrEqual(boxes[1].y);
  expect(boxes[2].y).toBeGreaterThanOrEqual(boxes[1].y + boxes[1].h);
});

test("Up and Down arrows page; Left and Right don't", async ({ page }) => {
  await openFeed(page);
  const all = await ids(page);
  expect(await active(page)).toBe(all[4]);
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => active(page)).toBe(all[5]);
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect.poll(() => active(page)).toBe(all[3]);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(300);
  expect(await active(page)).toBe(all[3]);
  await expect(page.locator(".zoom-card:not([inert])")).toHaveCount(1);
});

test("one vertical swipe and its momentum turn one page", async ({ page }) => {
  await openFeed(page);
  const all = await ids(page);
  await swipe(page, 0, 40, 12);
  await page.waitForTimeout(400);
  expect(await active(page)).toBe(all[5]);
  // After a pause, a swipe the other way turns back.
  await swipe(page, 0, -40, 6);
  await expect.poll(() => active(page)).toBe(all[4]);
  expect(await phase(page)).toBe("open");
});

test("a vertical touch drag pages, and never closes", async ({ page }) => {
  await openFeed(page);
  const all = await ids(page);
  // Farther than half a card, so they turn the page whatever the fling speed reads
  // (under load, the last move can land too long before the release to measure one).
  await touchPath(page, 200, 700, 200, 120);
  await expect.poll(() => active(page)).toBe(all[5]);
  await page.waitForTimeout(400);
  await touchPath(page, 200, 120, 200, 760);
  await expect.poll(() => active(page)).toBe(all[4]);
  await expectStaysOpen(page);
});

test("the card's own content scrolls before paging takes over", async ({ page }) => {
  await openFeed(page);
  const all = await ids(page);
  // Make the visible card's content taller than the card.
  await page.evaluate((sel) => {
    const content = document.querySelector(`${sel} .zoom-card-content`)!;
    const tall = document.createElement("div");
    tall.style.height = "1500px";
    content.appendChild(tall);
  }, SCROLLER);
  await swipe(page, 0, 40, 6);
  await page.waitForTimeout(400);
  expect(await active(page)).toBe(all[4]);
  expect(await page.evaluate((sel) => document.querySelector<HTMLElement>(sel)!.scrollTop, SCROLLER)).toBeGreaterThan(0);
  // At the bottom, a fresh swipe turns the page.
  await page.evaluate((sel) => {
    const sc = document.querySelector<HTMLElement>(sel)!;
    sc.scrollTop = sc.scrollHeight;
  }, SCROLLER);
  await page.waitForTimeout(400);
  await swipe(page, 0, 40, 6);
  await expect.poll(() => active(page)).toBe(all[5]);
});

test("a sideways touch drag closes, either way", async ({ page }) => {
  await openFeed(page);
  await touchPath(page, 120, 450, 360, 460);
  await expectCloses(page);
  await page.locator(".tile").nth(2).click();
  await expect.poll(() => phase(page)).toBe("open");
  await touchPath(page, 320, 450, 80, 440);
  await expectCloses(page);
});

test("a short sideways drag springs back", async ({ page }) => {
  await openFeed(page);
  await touchPath(page, 150, 450, 190, 450, 6);
  await expectStaysOpen(page);
});

test("a sideways mouse drag closes", async ({ page }) => {
  await openFeed(page);
  await page.mouse.move(100, 450);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(100 + i * 22, 452);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await expectCloses(page);
});

test("scrolling sideways closes", async ({ page }) => {
  await openFeed(page);
  await swipe(page, 40, 0, 10);
  await expectCloses(page);
});

test("Escape and the close button close, landing on the visible item's own cover", async ({ page }) => {
  await openFeed(page, 1);
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(400);
  await page.keyboard.press("Escape");
  await expect.poll(() => phase(page)).toBe("idle");
  await expect(page.locator(".tile").nth(2)).toBeFocused();

  await page.locator(".tile").nth(6).click();
  await expect.poll(() => phase(page)).toBe("open");
  await page.locator(".zoom-card:not([inert]) [data-zoom-close]").click();
  await expect.poll(() => phase(page)).toBe("idle");
});

test("while open, the rest of the grid stays dimmed and the visible book's cover is hidden", async ({ page }) => {
  await openFeed(page, 4);
  const looks = () =>
    page.locator(".tile .cover-wrap").evaluateAll((els) =>
      els.map((el) => ({ opacity: Number(getComputedStyle(el).opacity), hidden: getComputedStyle(el).visibility === "hidden" })),
    );
  let now = await looks();
  expect(now[4].hidden).toBe(true);
  expect(now[3].hidden).toBe(false);
  expect(now[3].opacity).toBeCloseTo(0.35, 2);
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(600);
  now = await looks();
  expect(now[4].hidden).toBe(false);
  expect(now[4].opacity).toBeCloseTo(0.35, 2);
  expect(now[5].hidden).toBe(true);

  await page.keyboard.press("Escape");
  await expect.poll(() => phase(page)).toBe("idle");
  now = await looks();
  expect(now.every((l) => !l.hidden && l.opacity === 1)).toBe(true);
  await expect(page.locator("[data-zoom-dimmed]")).toHaveCount(0);
});

test("closing flies only the visible card home; the others stay put and fade", async ({ page }) => {
  await page.goto("/dist/");
  await page.getByRole("button", { name: "Feed" }).click();
  await page.getByRole("button", { name: "Slow motion" }).click(); // so there's time to watch the close
  await page.locator(".tile").nth(4).click();
  await expect.poll(() => phase(page), { timeout: 5000 }).toBe("open");
  const neighbour = page.locator(".zoom-card").nth(5);
  const visible = page.locator(".zoom-card").nth(4);
  const box = (l: typeof neighbour) => l.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, o: Number(getComputedStyle(el).opacity) };
  });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  const n1 = await box(neighbour);
  const v1 = await box(visible);
  await page.waitForTimeout(400);
  const n2 = await box(neighbour);
  const v2 = await box(visible);
  expect(n2.x).toBeCloseTo(n1.x, 1);
  expect(n2.y).toBeCloseTo(n1.y, 1);
  expect(n2.w).toBeCloseTo(n1.w, 1);
  expect(n2.o).toBeLessThan(n1.o);
  expect(v2.w).toBeLessThan(v1.w); // the visible one is on its way to its cover
  await expect.poll(() => phase(page), { timeout: 5000 }).toBe("idle");
});
