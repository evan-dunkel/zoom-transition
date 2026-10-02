import { expect, test } from "@playwright/test";
import { openBook, phase } from "./helpers";

test("arrow keys page, and only the visible card is interactive", async ({ page }) => {
  await page.goto("/dist/");
  await openBook(page, 1);
  const ids = await page.locator(".zoom-card").evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.zoomId));
  const active = () => page.locator(".zoom-card:not([inert])").getAttribute("data-zoom-id");
  expect(await active()).toBe(ids[1]);
  await expect(page.locator(".zoom-card:not([inert])")).toHaveCount(1);

  await page.keyboard.press("ArrowRight");
  await expect.poll(active).toBe(ids[2]);
  await expect(page.locator(".zoom-card:not([inert])")).toHaveCount(1);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect.poll(active).toBe(ids[0]);

  // Closing lands on the visible item's own source, and gives it focus back.
  await page.keyboard.press("Escape");
  await expect.poll(() => phase(page)).toBe("idle");
  await expect(page.locator(".book").first()).toBeFocused();
});
