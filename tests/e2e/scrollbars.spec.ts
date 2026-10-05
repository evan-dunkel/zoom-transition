import { expect, test, type Page } from "@playwright/test";
import { phase } from "./helpers";

// Classic scrollbars (macOS with a mouse, Windows, Linux) take width: hidden as a card
// opens and shown again as one closes. A styled scrollbar always takes width in
// Chromium, so it stands in for one. Playwright hides Chromium's scrollbars by default;
// show them (launch options are per file, hence this file).
test.use({
  launchOptions: {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    ignoreDefaultArgs: ["--hide-scrollbars"],
  },
  viewport: { width: 1280, height: 900 },
});
test.skip(({ browserName }) => browserName !== "chromium", "styled scrollbars are a Chromium stand-in");

const PAGE = "/dist/portfolio-icons.html";
const BAR = "::-webkit-scrollbar { width: 15px; height: 15px; background: #ddd }";
const escape = (page: Page) => page.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
/** Every frame: the flying copy's left, the landed hero's, an index tile's, and any sideways scroll. */
const record = (page: Page) =>
  page.evaluate(() => {
    const seen: { phase: string; copy: number | null; hero: number | null; tile: number; extra: number }[] = [];
    (window as any).__seen = seen;
    const tick = () => {
      const copy = document.querySelector(".zoom-flight .zoom-clone-window");
      const hero = document.querySelector('.zoom-card[data-zoom-id="air-one"] [data-zoom-hero]');
      const html = document.documentElement;
      seen.push({
        phase: document.querySelector<HTMLElement>(".zoom-root")!.dataset.phase ?? "idle",
        copy: copy ? copy.getBoundingClientRect().left : null,
        hero: hero ? hero.getBoundingClientRect().left : null,
        tile: document.querySelector('[data-zoom-source="air-two"]')!.getBoundingClientRect().left,
        extra: html.scrollWidth - html.clientWidth,
      });
      if ((window as any).__seen === seen) requestAnimationFrame(tick);
    };
    tick();
  });
const seen = (page: Page) =>
  page.evaluate(() => (window as any).__seen as { phase: string; copy: number | null; hero: number | null; tile: number; extra: number }[]);
const landingJump = (frames: Awaited<ReturnType<typeof seen>>) => {
  const lastFlight = frames.filter((f) => f.phase === "opening" && f.copy !== null).at(-1)!;
  const landed = frames.find((f) => f.phase === "open" && f.hero !== null)!;
  return Math.abs(landed.hero! - lastFlight.copy!);
};

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
  await page.addStyleTag({ content: BAR });
  expect(await page.evaluate(() => innerWidth - document.documentElement.clientWidth)).toBe(15);
});

test("the image lands where it flew, and the page beneath never moves or scrolls sideways", async ({ page }) => {
  await record(page);
  await page.locator('[data-zoom-source="air-one"]').click();
  await expect.poll(() => phase(page), { timeout: 8000 }).toBe("open");
  await escape(page);
  await expect.poll(() => phase(page), { timeout: 8000 }).toBe("idle");
  const frames = await seen(page);
  expect(landingJump(frames)).toBeLessThan(1); // was 7px: the overlay re-placed mid-flight
  expect(new Set(frames.map((f) => Math.round(f.tile * 2) / 2)).size).toBe(1); // the index stays put
  expect(Math.max(...frames.map((f) => f.extra))).toBe(0); // no sideways scroll, closing included
});

test("quick close-and-reopen cycles still land where they flew", async ({ page }) => {
  for (let cycle = 0; cycle < 3; cycle++) {
    await record(page);
    await page.locator('[data-zoom-source="air-one"]').dispatchEvent("click");
    await page.waitForTimeout(120 + cycle * 40);
    await escape(page); // close mid-open…
    await page.waitForTimeout(80);
    await page.locator('.zoom-card[data-zoom-id="air-one"]').dispatchEvent("click"); // …and turn it around
    await expect.poll(() => phase(page), { timeout: 8000 }).toBe("open");
    await page.waitForTimeout(150);
    expect(landingJump(await seen(page))).toBeLessThan(1);
    await escape(page);
    await expect.poll(() => phase(page), { timeout: 8000 }).toBe("idle");
  }
});

test("a scrollbar appearing after a card has closed (a mouse connected) adds no sideways scroll", async ({ page }) => {
  await page.goto(PAGE); // fresh, with no scrollbar width (as with overlay scrollbars)
  const none = await page.addStyleTag({ content: "::-webkit-scrollbar { width: 0; height: 0 }" });
  await page.locator('[data-zoom-source="air-one"]').click();
  await expect.poll(() => phase(page), { timeout: 8000 }).toBe("open");
  await escape(page);
  await expect.poll(() => phase(page), { timeout: 8000 }).toBe("idle");
  await none.evaluate((el) => (el as Element).remove());
  await page.addStyleTag({ content: BAR }); // the mouse arrives
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});
