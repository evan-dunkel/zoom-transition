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

// Older Safari rejects scroll behavior "instant" with a TypeError. An earlier fix used
// it, so scrolling just after a page turn did nothing there.
for (const dir of ["up", "down"] as const) {
  test(`scrolling straight after a page ${dir} works where "instant" scrolling throws, wherever the pointer is`, async ({ page }) => {
    await page.addInitScript(() => {
      for (const name of ["scrollBy", "scrollTo", "scroll", "scrollIntoView"] as const) {
        const original = (Element.prototype as any)[name];
        (Element.prototype as any)[name] = function (this: Element, ...args: any[]) {
          if (args[0] && typeof args[0] === "object" && args[0].behavior === "instant")
            throw new TypeError(`'instant' is not a valid value for enumeration ScrollBehavior.`);
          return original.apply(this, args);
        };
      }
    });
    await openSecondProject(page, true);
    for (const y of [120, 450, 780]) {
      if (y !== 120) {
        await page.locator(".pf-tile").nth(1).click();
        await expect.poll(() => phase(page), { timeout: 8000 }).toBe("open");
        await page.evaluate(() => document.querySelectorAll<HTMLElement>(".zoom-card .zoom-card-scroll").forEach((s) => (s.scrollTop = 600)));
      }
      await page.keyboard.press(dir === "up" ? "ArrowUp" : "ArrowDown");
      await page.waitForTimeout(150);
      await page.mouse.move(215, y);
      const j = dir === "up" ? 0 : 2;
      for (let i = 0; i < 6; i++) {
        await page.mouse.wheel(0, dir === "up" ? -30 : 30);
        await page.waitForTimeout(16);
      }
      await expect.poll(async () => (await scrollTops(page))[j], { message: `pointer at y ${y}` }).not.toBe(600);
      expect((await scrollTops(page))[1]).toBe(600);
      await page.keyboard.press("Escape");
      await expect.poll(() => phase(page), { timeout: 8000 }).toBe("idle");
    }
  });
}

// Running into the end of a piece, then swiping again while that swipe's momentum is
// still arriving: the new swipe speeds up without first slowing to a near stop. It
// used to go unrecognised (and the browser's bounce kept the content moving), so the
// page wouldn't turn until everything went quiet.
for (const dir of ["down", "up"] as const) {
  test(`a new swipe during momentum at the ${dir === "down" ? "end" : "start"} of a piece turns the page (${dir})`, async ({ page }) => {
    await openSecondProject(page);
    const d = dir === "down" ? 1 : -1;
    await page.evaluate((d) => {
      const sc = document.querySelector<HTMLElement>(".zoom-card:not([inert]) .zoom-card-scroll")!;
      sc.scrollTop = d > 0 ? sc.scrollHeight - sc.clientHeight - 150 : 150;
    }, d);
    await page.waitForTimeout(400);
    await page.mouse.move(215, 450);
    // A swipe that runs into the edge, its momentum still going...
    for (const v of [40, 50, 50, 46, 41, 37, 33, 30, 27, 24, 22, 20]) {
      await page.mouse.wheel(0, d * v);
      await page.waitForTimeout(16);
    }
    expect(await active(page)).toBe("fernwood-reader"); // running into the edge alone doesn't turn it
    // ...and a new swipe on top of it.
    for (const v of [30, 45, 60, 60, 60]) {
      await page.mouse.wheel(0, d * v);
      await page.waitForTimeout(16);
    }
    await expect.poll(() => active(page), { timeout: 1500 }).toBe(dir === "down" ? "atlas-clinic" : "tidewater-transit");
  });
}

test("cards in a vertical pager don't bounce at their ends; horizontal ones still do", async ({ page }) => {
  await openSecondProject(page);
  expect(await page.locator(".zoom-card:not([inert]) .zoom-card-scroll").evaluate((el) => getComputedStyle(el).overscrollBehaviorY)).toBe("none");
  await page.keyboard.press("Escape");
  await expect.poll(() => phase(page)).toBe("idle");
  await page.getByRole("button", { name: "Shelves" }).click();
  await page.locator(".book").nth(1).click();
  await expect.poll(() => phase(page)).toBe("open");
  expect(await page.locator(".zoom-card:not([inert]) .zoom-card-scroll").evaluate((el) => getComputedStyle(el).overscrollBehaviorY)).toBe("contain");
});
