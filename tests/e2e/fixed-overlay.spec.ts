import { expect, test, type Page } from "@playwright/test";
import { phase } from "./helpers";

// The plain-HTML (Astro-style) harness: sources picked up with `scan`, no container,
// so the overlay is fixed on document.body and locks the page's scrolling while open.
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
