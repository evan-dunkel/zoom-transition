import { expect, test } from "@playwright/test";
import {
  disableEdge,
  enableEdge,
  expectCloses,
  expectStaysOpen,
  mouseDrag,
  openBook,
  phase,
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

  test("doesn't close past the bottom by default", async ({ page }) => {
    await openBook(page);
    await scrollCardTo(page, "bottom");
    await wheelSwipe(page, 60);
    await expectStaysOpen(page);
  });

  test("bottom edge can be turned on", async ({ page }) => {
    await enableEdge(page, "scroll-bottom");
    await openBook(page);
    await scrollCardTo(page, "bottom");
    await wheelSwipe(page, 60);
    await expectCloses(page);
  });

  test("top edge can be turned off on its own", async ({ page }) => {
    await enableEdge(page, "scroll-bottom");
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

  test("debug edge zones are drawn only for enabled edges", async ({ page }) => {
    const card = page.locator(".zoom-card:not([inert])");
    const reopenWith = async (change: () => Promise<void>) => {
      await page.keyboard.press("Escape");
      await expect.poll(() => phase(page)).toBe("idle");
      await change();
      await openBook(page);
    };
    await openBook(page);
    await expect(card.locator(".zoom-debug-top")).toHaveCount(1);
    await expect(card.locator(".zoom-debug-bottom")).toHaveCount(0);
    await reopenWith(() => enableEdge(page, "scroll-bottom"));
    await expect(card.locator(".zoom-debug-bottom")).toHaveCount(1);
    await reopenWith(() => disableEdge(page, "scroll-top"));
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

  test("doesn't close pulling up from the bottom by default", async ({ page }) => {
    await openBook(page);
    await scrollCardTo(page, "bottom");
    await touchDrag(page, 215, 650, 380);
    await expectStaysOpen(page);
  });

  test("bottom edge can be turned on", async ({ page }) => {
    await enableEdge(page, "drag-bottom");
    await openBook(page);
    await scrollCardTo(page, "bottom");
    await touchDrag(page, 215, 650, 380);
    await expectCloses(page);
  });

  test("top edge can be turned off on its own", async ({ page }) => {
    await enableEdge(page, "drag-bottom");
    await disableEdge(page, "drag-top");
    await openBook(page);
    await touchDrag(page, 215, 300, 560);
    await expectStaysOpen(page);
    await scrollCardTo(page, "bottom");
    await touchDrag(page, 215, 650, 380);
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

test.describe("after a wheel dismiss", () => {
  const store = (page: import("@playwright/test").Page) => page.locator(".store").evaluate((el) => el.scrollTop);
  const momentum = (from: number, to: number) => {
    const out: number[] = [];
    for (let d = from; d >= to; d *= 0.85) out.push(Math.round(d));
    return out;
  };
  const wheelY = async (page: import("@playwright/test").Page, deltas: number[]) => {
    for (const dy of deltas) {
      await page.mouse.wheel(0, dy);
      await page.waitForTimeout(16);
    }
  };

  test("the swipe's momentum doesn't scroll the page behind", async ({ page }) => {
    await enableEdge(page, "scroll-bottom");
    await openBook(page);
    await scrollCardTo(page, "bottom");
    await wheelSwipe(page, 60); // closes past the bottom
    await wheelY(page, momentum(40, 1));
    await expectCloses(page);
    expect(await store(page)).toBe(0);
  });

  test("a new scroll right away scrolls the page, without moving the pointer", async ({ page }) => {
    await enableEdge(page, "scroll-bottom");
    await openBook(page);
    await scrollCardTo(page, "bottom");
    await wheelSwipe(page, 60);
    await wheelY(page, momentum(40, 12)); // fingers back down mid-momentum
    expect(await phase(page)).toBe("idle");
    await wheelY(page, [3, 8, 16, 26, 32, 32]);
    await expect.poll(() => store(page)).toBeGreaterThan(0);
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
