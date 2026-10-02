import { expect, test } from "@playwright/test";
import {
  disableEdge,
  expectCloses,
  expectStaysOpen,
  mouseDrag,
  openBook,
  scrollCardTo,
  touchDrag,
  wheelSwipe,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.goto("/dist/");
  // Start from the demo's defaults (its tuning panel persists in localStorage).
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test.describe("scroll (wheel / trackpad) dismissal", () => {
  test("closes past the top by default", async ({ page }) => {
    await openBook(page);
    await scrollCardTo(page, "top");
    await wheelSwipe(page, -60);
    await expectCloses(page);
  });

  test("closes past the bottom by default", async ({ page }) => {
    await openBook(page);
    await scrollCardTo(page, "bottom");
    await wheelSwipe(page, 60);
    await expectCloses(page);
  });

  test("top edge can be turned off on its own", async ({ page }) => {
    await disableEdge(page, "scroll-top");
    await openBook(page);
    await scrollCardTo(page, "top");
    await wheelSwipe(page, -60);
    await expectStaysOpen(page);
    // The bottom edge still closes.
    await scrollCardTo(page, "bottom");
    await wheelSwipe(page, 60);
    await expectCloses(page);
  });

  test("bottom edge can be turned off on its own", async ({ page }) => {
    await disableEdge(page, "scroll-bottom");
    await openBook(page);
    await scrollCardTo(page, "bottom");
    await wheelSwipe(page, 60);
    await expectStaysOpen(page);
    await scrollCardTo(page, "top");
    await wheelSwipe(page, -60);
    await expectCloses(page);
  });

  test("debug edge zones are drawn only for enabled edges", async ({ page }) => {
    await openBook(page);
    const card = page.locator(".zoom-card:not([inert])");
    await expect(card.locator(".zoom-debug-top")).toHaveCount(1);
    await expect(card.locator(".zoom-debug-bottom")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect.poll(() => page.evaluate(() => document.querySelector<HTMLElement>(".zoom-root")?.dataset.phase)).toBe("idle");

    await disableEdge(page, "scroll-top");
    await openBook(page);
    await expect(card.locator(".zoom-debug-top")).toHaveCount(0);
    await expect(card.locator(".zoom-debug-bottom")).toHaveCount(1);
  });
});

test.describe("touch drag dismissal", () => {
  test.use({ hasTouch: true, isMobile: true });

  test("closes pulling down from the top by default", async ({ page }) => {
    await openBook(page);
    await touchDrag(page, 215, 300, 560);
    await expectCloses(page);
  });

  test("closes pulling up from the bottom by default", async ({ page }) => {
    await openBook(page);
    await scrollCardTo(page, "bottom");
    await touchDrag(page, 215, 650, 380);
    await expectCloses(page);
  });

  test("top edge can be turned off on its own", async ({ page }) => {
    await disableEdge(page, "drag-top");
    await openBook(page);
    await touchDrag(page, 215, 300, 560);
    await expectStaysOpen(page);
    await scrollCardTo(page, "bottom");
    await touchDrag(page, 215, 650, 380);
    await expectCloses(page);
  });

  test("bottom edge can be turned off on its own", async ({ page }) => {
    await disableEdge(page, "drag-bottom");
    await openBook(page);
    await scrollCardTo(page, "bottom");
    await touchDrag(page, 215, 650, 380);
    await expectStaysOpen(page);
    await scrollCardTo(page, "top");
    await touchDrag(page, 215, 300, 560);
    await expectCloses(page);
  });
});

test.describe("mouse drag dismissal follows the drag option", () => {
  test("closes pulling down from the top by default", async ({ page }) => {
    await openBook(page);
    await mouseDrag(page, 215, 300, 560);
    await expectCloses(page);
  });

  test("does not close when the top edge is off", async ({ page }) => {
    await disableEdge(page, "drag-top");
    await openBook(page);
    await mouseDrag(page, 215, 300, 560);
    await expectStaysOpen(page);
  });
});

test.describe("leaves the page as it found it", () => {
  /** Wheel listeners on the window that can cancel scrolling (not passive). */
  const blockingWindowWheelListeners = async (page: import("@playwright/test").Page) => {
    const cdp = await page.context().newCDPSession(page);
    const { result } = await cdp.send("Runtime.evaluate", { expression: "window" });
    const { listeners } = await cdp.send("DOMDebugger.getEventListeners", { objectId: result.objectId! });
    await cdp.detach();
    return listeners.filter((l) => l.type === "wheel" && !l.passive).length;
  };

  test("no blocking wheel listener on the window, before or after a wheel dismiss", async ({ page }) => {
    expect(await blockingWindowWheelListeners(page)).toBe(0);
    await openBook(page);
    await scrollCardTo(page, "top");
    await wheelSwipe(page, -60);
    await expectCloses(page);
    await page.waitForTimeout(400); // past the momentum swallowing
    expect(await blockingWindowWheelListeners(page)).toBe(0);
    // And the page scrolls normally again.
    const store = page.locator(".store");
    const before = await store.evaluate((el) => el.scrollTop);
    await page.mouse.move(215, 500);
    await page.mouse.wheel(0, 200);
    await expect.poll(() => store.evaluate((el) => el.scrollTop)).toBeGreaterThan(before);
  });
});
