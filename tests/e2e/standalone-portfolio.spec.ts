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
