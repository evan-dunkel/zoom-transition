import { expect, test, type Page } from "@playwright/test";
import { phase } from "./helpers";

// The plain-HTML (Astro-style) harness: sources picked up with `scan`, no container,
// so the overlay is over the viewport on document.body and locks the page's scrolling while open.
// Headless Chromium hides scrollbars by default; show them, as on Windows and Linux.
// (launchOptions replaces the config's, so carry its executablePath over.)
test.use({
  launchOptions: {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    ignoreDefaultArgs: ["--hide-scrollbars"],
  },
  viewport: { width: 900, height: 700 },
});

const pageState = (page: Page) =>
  page.evaluate(() => ({
    overflow: document.documentElement.style.overflow,
    gutter: document.documentElement.style.scrollbarGutter,
    inert: document.querySelector("main")!.inert,
    hidden: document.querySelectorAll("[data-zoom-hidden]").length,
    clones: document.querySelectorAll(".zoom-clone").length,
  }));
const untouched = { overflow: "", gutter: "", inert: false, hidden: 0, clones: 0 };

test.beforeEach(async ({ page }) => {
  await page.goto("/test/scan.html");
});

test("closing gives the page its scrolling back", async ({ page }) => {
  test.skip(test.info().project.name === "iphone-webkit", "uses the mouse wheel, which a phone has none of");
  await page.click('[data-zoom-source="b"]');
  await expect.poll(() => phase(page)).toBe("open");
  expect((await pageState(page)).overflow).toBe("hidden");
  await page.keyboard.press("Escape");
  await expect.poll(() => phase(page)).toBe("idle");
  expect(await pageState(page)).toEqual(untouched);
  await page.mouse.wheel(0, 300);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
});

test("locking scroll doesn't shift the page sideways", async ({ page }) => {
  const scrollbar = await page.evaluate(() => innerWidth - document.documentElement.clientWidth);
  test.skip(scrollbar === 0, "this browser has overlay scrollbars");
  const left = () => page.evaluate(() => document.querySelector('[data-zoom-source="b"]')!.getBoundingClientRect().left);
  const before = await left();
  await page.click('[data-zoom-source="b"]');
  await expect.poll(() => phase(page)).toBe("open");
  expect(await left()).toBe(before);
});

test("unmounting while open restores the page", async ({ page }) => {
  await page.click('[data-zoom-source="a"]');
  await page.waitForTimeout(150); // mid-open: a flight is in the air
  await page.evaluate(() => (window as unknown as { unmountZoom(): void }).unmountZoom());
  await page.waitForTimeout(100);
  expect(await pageState(page)).toEqual(untouched);
});

// Over the whole page the overlay is part of the page (so phones show it through a
// floating toolbar; iOS Safari paints a solid band under it for fixed content), placed
// over the viewport at the page's scroll position.
test("over a scrolled page, the overlay covers the viewport and adds nothing to the page's size", async ({ page }) => {
  await page.evaluate(() => window.scrollTo(0, 120));
  const size = () => page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight]);
  const before = await size();
  await page.locator('[data-zoom-source="b"]').dispatchEvent("click"); // a tap, without scrolling it into view
  await expect.poll(() => phase(page)).toBe("open");
  const box = await page.evaluate(() => {
    const r = document.querySelector(".zoom-root")!.getBoundingClientRect();
    return { top: r.top, left: r.left, height: r.height, vh: document.documentElement.clientHeight, scrollY };
  });
  expect(Math.abs(box.scrollY - 120)).toBeLessThanOrEqual(1); // the page stays where it was…
  expect(box.top).toBeCloseTo(0, 0); // …and the overlay is over the viewport there
  expect(box.left).toBeCloseTo(0, 0);
  expect(box.height).toBeCloseTo(box.vh, 0);
  expect(await size()).toEqual(before); // its overhang (under a phone's toolbar) adds no scrolling
  await page.keyboard.press("Escape");
  await expect.poll(() => phase(page)).toBe("idle");
  expect(await size()).toEqual(before);
});
