import { expect, test } from "@playwright/test";
import { phase } from "./helpers";

// The standalone portfolio (standalone/portfolio): plain markup, one island.

test("plain markup opens into a continuous stream and closes onto the piece being read", async ({ page }) => {
  await page.goto("/dist/portfolio.html");
  await page.locator(".tile").nth(1).click();
  await expect.poll(() => phase(page)).toBe("open");
  const ids = await page.locator(".zoom-card").evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.zoomId));
  expect(ids).toEqual(["tidewater", "fernwood", "atlas", "kiln"]);
  // The image is inset on the card.
  const inset = await page.evaluate(() => {
    const card = document.querySelector('[data-zoom-id="fernwood"].zoom-card')!.getBoundingClientRect();
    const hero = document.querySelector('[data-zoom-id="fernwood"] [data-zoom-hero]')!.getBoundingClientRect();
    return hero.left - card.left;
  });
  expect(inset).toBeGreaterThanOrEqual(8);
  // Scroll on into the next piece, then close: that one goes home.
  await page.locator(".zoom-stream").evaluate((el) => {
    el.scrollTop = document.querySelector<HTMLElement>('[data-zoom-id="atlas"]')!.offsetTop - 8;
  });
  await page.waitForTimeout(600);
  await page.keyboard.press("Escape");
  await expect.poll(() => phase(page)).toBe("idle");
  await expect(page.locator(".tile").nth(2)).toBeFocused();
});

test("the image's shadow fades in with the open and out with the close, instead of popping", async ({ page }) => {
  await page.goto("/dist/portfolio.html");
  // Record the flying image's shadow opacity on every frame.
  const record = () =>
    page.evaluate(() => {
      const seen: number[] = [];
      (window as any).__shadow = seen;
      const tick = () => {
        const sh = document.querySelector<HTMLElement>(".zoom-clone-shadow");
        if (sh && sh.style.opacity !== "") seen.push(Number(sh.style.opacity));
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  const seen = () => page.evaluate(() => (window as any).__shadow as number[]);

  await record();
  await page.locator(".tile").nth(1).click();
  await expect.poll(() => phase(page)).toBe("open");
  const opening = await seen();
  expect(opening.length).toBeGreaterThan(5);
  expect(opening[0]).toBeLessThan(0.3); // barely any shadow as it lifts off the tile
  expect(opening[opening.length - 1]).toBeGreaterThan(0.85); // all of it by the time it lands
  // The in-card image's own shadow takes over unchanged.
  expect(await page.locator('[data-zoom-id="fernwood"] [data-zoom-hero]').evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe("none");

  await record();
  await page.keyboard.press("Escape");
  await expect.poll(() => phase(page)).toBe("idle");
  const closing = await seen();
  expect(closing.length).toBeGreaterThan(3);
  expect(closing[0]).toBeGreaterThan(0.7);
  expect(closing[closing.length - 1]).toBeLessThan(0.15); // gone as it lands on the tile, which has none
});

// The flying copy is scaled as a whole, which used to scale its corners too: a corner
// read smaller mid-flight (about 1 px for a small thumbnail) and jumped on landing. Now
// its on-screen radius moves steadily from one end's to the other's: projects have 18 px
// on the tile and on the card (so it holds), writing goes from the 10 px thumbnail to 18.
for (const [label, open, tile, card] of [
  ["a project", ".tile", 18, 18],
  ["a piece of writing", ".row", 10, 18],
] as const) {
  test(`corners keep their true on-screen radius in flight: ${label}`, async ({ page }) => {
    await page.goto("/dist/portfolio.html");
    const record = () =>
      page.evaluate(() => {
        const seen: number[] = [];
        (window as any).__corners = seen;
        const tick = () => {
          const el = document.querySelector<HTMLElement>(".zoom-clone");
          const copy = el?.querySelector<HTMLElement>(":scope > :not(.zoom-clone-shadow)");
          const scale = el && /scale\(([\d.e-]+)\)/.exec(el.style.transform);
          if (copy && scale && copy.style.borderRadius) seen.push(parseFloat(copy.style.borderRadius) * Number(scale[1]));
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    const corners = () => page.evaluate(() => (window as any).__corners as number[]);
    const lo = Math.min(tile, card) - 0.5;
    const hi = Math.max(tile, card) + 0.5;
    await record();
    await page.locator(open).nth(1).click();
    await expect.poll(() => phase(page)).toBe("open");
    const opening = await corners();
    expect(opening.length).toBeGreaterThan(5);
    expect(opening[0]).toBeCloseTo(tile, 0); // takes off with the tile's corner
    expect(opening[opening.length - 1]).toBeCloseTo(card, 0); // lands with the card image's
    for (const r of opening) expect(r >= lo && r <= hi).toBe(true); // never shrinks with the scale
    await record();
    await page.keyboard.press("Escape");
    await expect.poll(() => phase(page)).toBe("idle");
    const closing = await corners();
    expect(closing.length).toBeGreaterThan(3);
    expect(closing[0]).toBeCloseTo(card, 0);
    expect(closing[closing.length - 1]).toBeCloseTo(tile, 0);
    for (const r of closing) expect(r >= lo && r <= hi).toBe(true);
  });
}

test("card, image and close button are concentric, with an even inset around the image", async ({ page }) => {
  await page.goto("/dist/portfolio.html");
  await page.locator(".tile").nth(1).click();
  await expect.poll(() => phase(page)).toBe("open");
  const g = await page.evaluate(() => {
    const card = document.querySelector('[data-zoom-id="fernwood"].zoom-card')!;
    const surfaceEl = card.querySelector<HTMLElement>(".zoom-card-content")!;
    const imageEl = card.querySelector<HTMLElement>("[data-zoom-hero]")!;
    const s = surfaceEl.getBoundingClientRect();
    const i = imageEl.getBoundingClientRect();
    const x = card.querySelector("[data-zoom-close]")!.getBoundingClientRect();
    const R = parseFloat(getComputedStyle(surfaceEl).borderTopRightRadius);
    const r = parseFloat(getComputedStyle(imageEl).borderTopRightRadius);
    return {
      inset: [i.top - s.top, i.left - s.left, s.right - i.right],
      card: [R, R],
      image: [s.right - i.right + r, i.top - s.top + r],
      close: [s.right - (x.left + x.width / 2), x.top + x.height / 2 - s.top],
    };
  });
  // The image's inset is the same at the top as at the sides (its margin used to escape the card).
  expect(g.inset[0]).toBeCloseTo(g.inset[1], 0);
  expect(g.inset[2]).toBeCloseTo(g.inset[1], 0);
  // All three corners share a centre.
  for (const c of [g.image, g.close]) {
    expect(c[0]).toBeCloseTo(g.card[0], 0);
    expect(c[1]).toBeCloseTo(g.card[1], 0);
  }
});

test("a card's close button fades out as the card scrolls away, instead of being cut off", async ({ page }) => {
  await page.goto("/dist/portfolio.html");
  await page.locator(".tile").nth(1).click();
  await expect.poll(() => phase(page)).toBe("open");
  const bar = page.locator('[data-zoom-id="fernwood"] .zoom-close-bar');
  const opacityWhenBottomAt = async (fromTop: number) => {
    await page.locator(".zoom-stream").evaluate((el, fromTop) => {
      const card = document.querySelector<HTMLElement>('[data-zoom-id="fernwood"].zoom-card')!;
      el.scrollTop = card.offsetTop + card.offsetHeight - fromTop;
    }, fromTop);
    await page.waitForTimeout(150);
    return bar.evaluate((el) => Number(getComputedStyle(el).opacity));
  };
  expect(await opacityWhenBottomAt(400)).toBe(1); // plenty of card left: fully there
  const mid = await opacityWhenBottomAt(80);
  expect(mid).toBeGreaterThan(0.05);
  expect(mid).toBeLessThan(0.95); // on its way out
  expect(await opacityWhenBottomAt(40)).toBe(0); // gone before the edge reaches it
  expect(await opacityWhenBottomAt(400)).toBe(1); // and back when scrolled back
});
