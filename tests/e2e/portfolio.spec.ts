import { expect, test, type Page } from "@playwright/test";
import { SCROLLER, phase } from "./helpers";

// The portfolio prototype: projects and writing as two vertical feeds of long reads.

const active = (page: Page) => page.locator(".zoom-card:not([inert])").getAttribute("data-zoom-id");
const scrollTop = (page: Page) => page.evaluate((sel) => document.querySelector<HTMLElement>(sel)!.scrollTop, SCROLLER);

async function swipe(page: Page, dy: number, events = 6) {
  await page.mouse.move(215, 450);
  for (let i = 0; i < events; i++) {
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(30);
  }
}

async function openPortfolio(page: Page) {
  await page.goto("/dist/");
  await page.getByRole("button", { name: "Portfolio" }).click();
}

test("a project reads like a page, and a new swipe at its end brings up the next one", async ({ page }) => {
  await openPortfolio(page);
  await page.locator(".pf-tile").first().click();
  await expect.poll(() => phase(page)).toBe("open");
  expect(await active(page)).toBe("tidewater-transit");

  // Scrolling reads the project; it doesn't turn the page.
  await swipe(page, 60);
  await page.waitForTimeout(400);
  expect(await active(page)).toBe("tidewater-transit");
  expect(await scrollTop(page)).toBeGreaterThan(0);

  // At the end, the next project is named, and a fresh swipe brings it up.
  await page.evaluate((sel) => {
    const sc = document.querySelector<HTMLElement>(sel)!;
    sc.scrollTop = sc.scrollHeight;
  }, SCROLLER);
  await expect(page.locator(".zoom-card:not([inert]) .pf-next-title")).toHaveText("Fernwood Reader");
  await page.waitForTimeout(400);
  await swipe(page, 40);
  await expect.poll(() => active(page)).toBe("fernwood-reader");
  expect(await scrollTop(page)).toBe(0);

  // Back steps to the previous project ("item" history), then closes.
  await page.goBack();
  await expect.poll(() => active(page)).toBe("tidewater-transit");
  await page.goBack();
  await expect.poll(() => phase(page)).toBe("idle");
});

test("projects and writing are separate feeds", async ({ page }) => {
  await openPortfolio(page);
  await page.locator(".pf-row").first().click();
  await expect.poll(() => phase(page)).toBe("open");
  await expect(page.locator(".zoom-card")).toHaveCount(5);
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowDown");
  await expect.poll(() => active(page)).toBe("case-studies-people-finish");
  await expect(page.locator(".zoom-card:not([inert]) .pf-back")).toHaveText("Back to the index");
  await page.locator(".zoom-card:not([inert]) .pf-back").click();
  await expect.poll(() => phase(page)).toBe("idle");
  await expect(page.locator(".pf-row").last()).toBeFocused();
});
