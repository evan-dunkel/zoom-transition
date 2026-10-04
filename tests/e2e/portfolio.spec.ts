import { expect, test, type Page } from "@playwright/test";
import { phase } from "./helpers";

// The portfolio prototype: projects and writing open into continuous streams. Each
// piece is a card as tall as its content, scrolled natively with no paging.

const STREAM = ".zoom-stream";
const cards = (page: Page) =>
  page.locator(".zoom-card").evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { id: (el as HTMLElement).dataset.zoomId!, top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: r.height, inert: el.hasAttribute("inert") };
    }),
  );
const streamTop = (page: Page) => page.locator(STREAM).evaluate((el) => el.scrollTop);
/** The piece being read: the address follows it ("#id", replaced as you scroll). */
const reading = (page: Page) => page.evaluate(() => decodeURIComponent(location.hash.slice(1)));
/** Tiles hidden on the index. */
const hiddenTiles = (page: Page) =>
  page.locator(".pf-tile-art").evaluateAll((els) =>
    els
      .filter((el) => getComputedStyle(el).visibility === "hidden" || Number(getComputedStyle(el).opacity) < 0.01)
      .map((el) => el.closest("li")!.querySelector(".pf-tile-title")!.textContent),
  );

async function openPortfolio(page: Page, slow = false) {
  await page.goto("/dist/");
  await page.getByRole("button", { name: "Portfolio" }).click();
  if (slow) await page.getByRole("button", { name: "Slow motion" }).click();
}
async function openProject(page: Page, nth: number) {
  await page.locator(".pf-tile").nth(nth).click();
  await expect.poll(() => phase(page), { timeout: 8000 }).toBe("open");
}
async function wheel(page: Page, dy: number, events: number) {
  await page.mouse.move(215, 450);
  for (let i = 0; i < events; i++) {
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(12);
  }
}

test("each piece is a card as tall as its content, in one column, opened at the top", async ({ page }) => {
  await openPortfolio(page);
  await openProject(page, 1);
  const all = await cards(page);
  expect(all.map((c) => c.id)).toEqual(["tidewater-transit", "fernwood-reader", "atlas-clinic", "kiln"]);
  const viewport = page.viewportSize()!.height;
  for (const c of all) expect(c.h).toBeGreaterThan(viewport); // content height, not a page
  expect(all[1].top).toBeCloseTo(8, 0); // the opened piece starts at the top
  for (let i = 1; i < all.length; i++) expect(all[i].top).toBeGreaterThan(all[i - 1].bottom); // stacked, in order
  expect(all.every((c) => !c.inert)).toBe(true); // all of it is readable content
});

test("scrolling runs straight through one piece into the next, and the piece being read follows", async ({ page }) => {
  await openPortfolio(page);
  await openProject(page, 1);
  expect(await reading(page)).toBe("fernwood-reader");
  // Count wheel events the page cancels: a stream never holds scrolling back.
  await page.evaluate(() => {
    (window as any).__held = 0;
    window.addEventListener("wheel", (e) => setTimeout(() => e.defaultPrevented && (window as any).__held++), { passive: true });
  });
  const start = await streamTop(page);
  await wheel(page, 50, 60); // 3000 px: past the end of Fernwood and well into Atlas
  await expect.poll(() => streamTop(page)).toBeGreaterThan(start + 2800);
  expect(await page.evaluate(() => (window as any).__held)).toBe(0);
  await expect.poll(() => reading(page)).toBe("atlas-clinic");
  expect(await hiddenTiles(page)).toEqual(["Fernwood Reader"]); // the index behind didn't change
  // And back up again, just as freely.
  await wheel(page, -50, 60);
  await expect.poll(() => reading(page)).toBe("fernwood-reader");
});

test("the close button stays in view while reading", async ({ page }) => {
  await openPortfolio(page);
  await openProject(page, 0);
  await page.locator(STREAM).evaluate((el) => (el.scrollTop = 1200));
  const box = await page.locator('[data-zoom-id="tidewater-transit"] [data-zoom-close]').boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeLessThan(60);
});

test("closing sends home only the piece being read; the others stay put and fade", async ({ page }) => {
  await openPortfolio(page, true);
  await openProject(page, 1);
  await page.locator(STREAM).evaluate((el) => {
    const atlas = document.querySelector<HTMLElement>('[data-zoom-id="atlas-clinic"]')!;
    el.scrollTop = atlas.offsetTop - 8;
  });
  await expect.poll(() => reading(page)).toBe("atlas-clinic");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  const a = await cards(page);
  await page.waitForTimeout(500);
  const b = await cards(page);
  const fern = (x: typeof a) => x.find((c) => c.id === "fernwood-reader")!;
  const atlas = (x: typeof a) => x.find((c) => c.id === "atlas-clinic")!;
  expect(fern(b).top).toBeCloseTo(fern(a).top, 0); // stays put
  expect(atlas(b).right - atlas(b).left).toBeLessThan(atlas(a).right - atlas(a).left); // on its way home
  await expect.poll(() => phase(page), { timeout: 8000 }).toBe("idle");
  await expect(page.locator(".pf-tile").nth(2)).toBeFocused();
});

test("the image sits on the card, and the card grows out from behind it", async ({ page }) => {
  await openPortfolio(page, true);
  await page.locator(".pf-tile").nth(0).click();
  await page.waitForTimeout(250);
  // Early in the open: the card is still narrower than the flying image, behind it.
  const early = await page.evaluate(() => {
    const card = document.querySelector<HTMLElement>('[data-zoom-id="tidewater-transit"].zoom-card')!.getBoundingClientRect();
    const image = document.querySelector<HTMLElement>(".zoom-clone")!.getBoundingClientRect();
    return { card: card.width, image: image.width, cardLeft: card.left, imageLeft: image.left };
  });
  expect(early.card).toBeLessThan(early.image);
  expect(early.cardLeft).toBeGreaterThan(early.imageLeft);
  await expect.poll(() => phase(page), { timeout: 8000 }).toBe("open");
  // Open: the image is inset on the card, not edge to edge.
  const rest = await page.evaluate(() => {
    const card = document.querySelector<HTMLElement>('[data-zoom-id="tidewater-transit"].zoom-card')!.getBoundingClientRect();
    const hero = document.querySelector<HTMLElement>('[data-zoom-id="tidewater-transit"] [data-zoom-hero]')!.getBoundingClientRect();
    return { inset: hero.left - card.left, top: hero.top - card.top };
  });
  expect(rest.inset).toBeGreaterThanOrEqual(8);
  expect(rest.top).toBeCloseTo(rest.inset, 0); // as far in at the top as at the sides
});

test("a vertical drag scrolls; a sideways drag closes", async ({ page }) => {
  await openPortfolio(page);
  await openProject(page, 0);
  const touch = async (x0: number, y0: number, x1: number, y1: number) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] });
    for (let i = 1; i <= 12; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + ((x1 - x0) * i) / 12, y: y0 + ((y1 - y0) * i) / 12 }] });
      await page.waitForTimeout(16);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
  };
  const before = await streamTop(page);
  await touch(215, 700, 215, 250);
  await expect.poll(() => streamTop(page)).toBeGreaterThan(before + 200);
  expect(await phase(page)).toBe("open");
  await touch(100, 450, 360, 460);
  await expect.poll(() => phase(page), { timeout: 3000 }).not.toBe("open");
  await expect.poll(() => phase(page), { timeout: 3000 }).toBe("idle");
});

test("scrolling sideways doesn't close: on desktop that's off by default", async ({ page }) => {
  await openPortfolio(page);
  await openProject(page, 0);
  await page.mouse.move(215, 450);
  for (let i = 0; i < 10; i++) {
    await page.mouse.wheel(40, 0);
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(600);
  expect(await phase(page)).toBe("open");
});

test("writing is its own stream, and the last piece offers the way back", async ({ page }) => {
  await openPortfolio(page);
  await page.locator(".pf-row").first().click();
  await expect.poll(() => phase(page)).toBe("open");
  await expect(page.locator(".zoom-card")).toHaveCount(5);
  await page.locator(STREAM).evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.locator(".zoom-card").last().locator(".pf-back").click();
  await expect.poll(() => phase(page)).toBe("idle");
  // Closed with a click: nothing is left focused (no ring around the row on touch screens).
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
});

test("Back closes", async ({ page }) => {
  await openPortfolio(page);
  await openProject(page, 2);
  await page.goBack();
  await expect.poll(() => phase(page)).toBe("idle");
});

test("the index stays still while reading; closing hides the piece being read at once", async ({ page }) => {
  await openPortfolio(page);
  await openProject(page, 1);
  expect(await hiddenTiles(page)).toEqual(["Fernwood Reader"]);
  await page.locator(STREAM).evaluate((el) => {
    const atlas = document.querySelector<HTMLElement>('[data-zoom-id="atlas-clinic"]')!;
    el.scrollTop = atlas.offsetTop - 8;
  });
  await expect.poll(() => reading(page)).toBe("atlas-clinic");
  // Scrolling on changed nothing behind: no tile faded out or back in.
  await page.waitForTimeout(400);
  expect(await hiddenTiles(page)).toEqual(["Fernwood Reader"]);
  const fern = () => page.locator(".pf-tile-art").nth(1).evaluate((el) => Number(getComputedStyle(el).opacity));
  // On close, at once: Atlas's place is emptied for its card, Fernwood's comes back.
  await page.keyboard.press("Escape");
  expect(await hiddenTiles(page)).toEqual(["Atlas Clinic"]);
  expect(await fern()).toBeGreaterThan(0.3);
  await expect.poll(() => phase(page), { timeout: 8000 }).toBe("idle");
  expect(await hiddenTiles(page)).toEqual([]);
});
