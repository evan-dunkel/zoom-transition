import { expect, type Page } from "@playwright/test";

export const SCROLLER = ".zoom-card:not([inert]) .zoom-card-scroll";

export const phase = (page: Page) =>
  page.evaluate(() => document.querySelector<HTMLElement>(".zoom-root")?.dataset.phase ?? "idle");

export async function openBook(page: Page, nth = 1) {
  await page.locator(".book").nth(nth).click();
  await expect.poll(() => phase(page)).toBe("open");
}

/** Put the visible card's content at its top or bottom, and let the wheel settle. */
export async function scrollCardTo(page: Page, edge: "top" | "bottom") {
  await page.evaluate(
    ([sel, edge]) => {
      const sc = document.querySelector<HTMLElement>(sel)!;
      sc.scrollTop = edge === "top" ? 0 : sc.scrollHeight;
    },
    [SCROLLER, edge] as const,
  );
  // Longer than the wheel's QUIET_MS, so the next swipe counts as a fresh one at the edge.
  await page.waitForTimeout(400);
}

/** A fresh mouse-wheel or trackpad swipe: `dy` < 0 scrolls up, > 0 down. */
export async function wheelSwipe(page: Page, dy: number, events = 6) {
  await page.mouse.move(215, 500);
  for (let i = 0; i < events; i++) {
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(30);
  }
}

/** A one-finger vertical drag, sent as real touch events. */
export async function touchDrag(page: Page, x: number, y0: number, y1: number, steps = 12) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: y0 }] });
  for (let i = 1; i <= steps; i++) {
    const y = y0 + ((y1 - y0) * i) / steps;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

/** Same as touchDrag, with the mouse. */
export async function mouseDrag(page: Page, x: number, y0: number, y1: number, steps = 12) {
  await page.mouse.move(x, y0);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x, y0 + ((y1 - y0) * i) / steps);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
}

type Edge = "scroll-top" | "scroll-bottom" | "drag-top" | "drag-bottom";
/** Untick one of the demo's "close from this edge" checkboxes. */
export async function disableEdge(page: Page, name: Edge) {
  await page.locator(`input[name="${name}"]`).uncheck();
}
/** Tick one (the bottom edges are off by default). */
export async function enableEdge(page: Page, name: Edge) {
  await page.locator(`input[name="${name}"]`).check();
}

/** Still open after a gesture: give a close a moment to start, then check. */
export async function expectStaysOpen(page: Page) {
  await page.waitForTimeout(500);
  expect(await phase(page)).toBe("open");
}

export async function expectCloses(page: Page) {
  await expect.poll(() => phase(page), { timeout: 2000 }).not.toBe("open");
  await expect.poll(() => phase(page), { timeout: 3000 }).toBe("idle");
}
