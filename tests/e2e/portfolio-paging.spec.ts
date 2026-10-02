import { expect, test, type Page } from "@playwright/test";
import { phase } from "./helpers";

// Moving between portfolio pieces: scrolling works straight after a page turn,
// wherever the pointer or finger is, and the paging controls take effect.

const scrollTops = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".zoom-card .zoom-card-scroll")].map((s) => s.scrollTop));
const active = (page: Page) => page.locator(".zoom-card:not([inert])").getAttribute("data-zoom-id");

async function openSecondProject(page: Page, slow = false) {
  await page.goto("/dist/");
  await page.getByRole("button", { name: "Portfolio" }).click();
  if (slow) await page.getByRole("button", { name: "Slow motion" }).click();
  await page.locator(".pf-tile").nth(1).click();
  await expect.poll(() => phase(page), { timeout: 8000 }).toBe("open");
  // Every piece part-way through, as if read.
  await page.evaluate(() => document.querySelectorAll<HTMLElement>(".zoom-card .zoom-card-scroll").forEach((s) => (s.scrollTop = 600)));
}

for (const [dir, y] of [["up", 760], ["down", 100]] as const) {
  test(`mid page turn ${dir}, scrolling over the card being left scrolls the new one`, async ({ page }) => {
    await openSecondProject(page, true);
    await page.keyboard.press(dir === "up" ? "ArrowUp" : "ArrowDown");
    await page.waitForTimeout(150);
    // The pointer is still over the card being left (it's inert).
    await page.mouse.move(215, y);
    // (Inert cards aren't hit-testable, so check by position.)
    const under = await page.evaluate((y) => {
      const r = document.querySelector<HTMLElement>('[data-zoom-id="fernwood-reader"]')!.getBoundingClientRect();
      return r.top <= y && y <= r.bottom;
    }, y);
    expect(under).toBe(true);
    const j = dir === "up" ? 0 : 2;
    const before = (await scrollTops(page))[j];
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, dir === "up" ? -30 : 30);
      await page.waitForTimeout(16);
    }
    await expect.poll(async () => (await scrollTops(page))[j]).not.toBe(before);
    expect((await scrollTops(page))[1]).toBe(600); // the card being left didn't move
  });
}

test("a touch that lands on the card being left scrolls the new one", async ({ page }) => {
  await openSecondProject(page, true);
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(150);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 215, y: 700 }] });
  for (let i = 1; i <= 8; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 215, y: 700 + i * 15 }] });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
  const tops = await scrollTops(page);
  expect(tops[0]).toBeLessThan(600); // dragging down scrolls the new card's content up
  expect(tops[1]).toBe(600);
  expect(await active(page)).toBe("tidewater-transit");
});

async function openFirstProjectWith(page: Page, swipe: string, edge: "new-swipe" | "continue") {
  await page.goto("/dist/");
  await page.getByRole("button", { name: "Portfolio" }).click();
  await page.locator("#pf-swipe").fill(swipe);
  await page.locator("#pf-edge").selectOption(edge);
  await page.locator(".pf-tile").first().click();
  await expect.poll(() => phase(page)).toBe("open");
  await page.mouse.move(215, 450);
}
async function wheel(page: Page, events: number) {
  for (let i = 0; i < events; i++) {
    await page.mouse.wheel(0, 30);
    await page.waitForTimeout(16);
  }
}

test("swipe distance sets how far a swipe at the end travels before turning the page", async ({ page }) => {
  await openFirstProjectWith(page, "300", "new-swipe");
  await page.evaluate(() => {
    const sc = document.querySelector<HTMLElement>(".zoom-card:not([inert]) .zoom-card-scroll")!;
    sc.scrollTop = sc.scrollHeight;
  });
  await page.waitForTimeout(400);
  await wheel(page, 6); // 180 px
  await page.waitForTimeout(400);
  expect(await active(page)).toBe("tidewater-transit");
  await wheel(page, 12); // 360 px
  await expect.poll(() => active(page)).toBe("fernwood-reader");
});

for (const edge of ["new-swipe", "continue"] as const) {
  test(`at the end of a piece, "${edge}": one swipe running into the end ${edge === "continue" ? "turns" : "doesn't turn"} the page`, async ({ page }) => {
    await openFirstProjectWith(page, "40", edge);
    await page.evaluate(() => {
      const sc = document.querySelector<HTMLElement>(".zoom-card:not([inert]) .zoom-card-scroll")!;
      sc.scrollTop = sc.scrollHeight - sc.clientHeight - 60;
    });
    await page.waitForTimeout(400);
    await wheel(page, 14); // one swipe: 60 px of reading, then on into the end
    await page.waitForTimeout(400);
    expect(await active(page)).toBe(edge === "continue" ? "fernwood-reader" : "tidewater-transit");
  });
}
