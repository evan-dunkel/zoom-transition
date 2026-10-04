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
  expect(inset).toBeGreaterThan(10);
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

// The flying copy is scaled as a whole, which used to scale its corners too: a 14 px
// corner read as ~10 px mid-flight (1 px for a small thumbnail) and jumped on landing.
for (const [label, open, expected] of [
  ["a project", ".tile", 14],
  ["a piece of writing", ".row", 10],
] as const) {
  test(`corners keep their on-screen radius in flight: ${label}`, async ({ page }) => {
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
    await record();
    await page.locator(open).nth(1).click();
    await expect.poll(() => phase(page)).toBe("open");
    const opening = await corners();
    expect(opening.length).toBeGreaterThan(5);
    for (const r of opening) expect(r).toBeCloseTo(expected, 0);
    await record();
    await page.keyboard.press("Escape");
    await expect.poll(() => phase(page)).toBe("idle");
    const closing = await corners();
    expect(closing.length).toBeGreaterThan(3);
    for (const r of closing) expect(r).toBeCloseTo(expected, 0);
  });
}
