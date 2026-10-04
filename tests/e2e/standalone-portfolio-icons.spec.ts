import { expect, test, type Page } from "@playwright/test";
import { phase } from "./helpers";

// The combined prototype (standalone/portfolio-icons): everything opens into one stream,
// each section under its title. Air Apps cards lead with a large image; personal
// projects, writing and About lead with an icon beside the title.

const open = async (page: Page, source: string, nth: number) => {
  await page.goto("/dist/portfolio-icons.html");
  await page.locator(source).nth(nth).click();
  await expect.poll(() => phase(page)).toBe("open");
};

test("Air Apps, personal projects, writing and About open as one stream, each under its title", async ({ page }) => {
  await open(page, ".tile", 1);
  // The stream's children in order: titles and cards.
  const order = await page.locator(".zoom-card").first().evaluate((card) =>
    [...card.parentElement!.children].map((el) => (el.hasAttribute("data-zoom-section-title") ? "# " + el.textContent : (el as HTMLElement).dataset.zoomId)),
  );
  expect(order).toEqual([
    "# Air Apps", "air-one", "air-two",
    "# Personal projects", "zoom", "personal-two",
    "# Writing and experiments", "interruptible", "springs", "shelf", "case-studies",
    "# About", "about",
  ]);
  // The titles are the page's own section titles: same element, same class, same look.
  const look = (el: Element) => {
    const s = getComputedStyle(el);
    return [s.fontFamily, s.fontSize, s.fontWeight, s.color].join(" ");
  };
  const onPage = await page.locator("main .section-title").first().evaluate(look);
  const inStream = await page.locator("[data-zoom-section-title] .section-title").first().evaluate(look);
  expect(inStream).toBe(onPage);
});

test("a piece that starts a section opens with its title in view above it", async ({ page }) => {
  await open(page, ".item", 2); // the first piece of writing
  const title = await page.locator("[data-zoom-section-title]", { hasText: "Writing" }).boundingBox();
  const card = await page.locator('.zoom-card[data-zoom-id="interruptible"]').boundingBox();
  expect(title!.y).toBeGreaterThanOrEqual(0);
  expect(title!.y + title!.height).toBeLessThanOrEqual(card!.y + 1);
});

test("Air Apps cards lead with the image; the rest with an icon at the corner, the title beside it", async ({ page }) => {
  await open(page, ".item", 0);
  const m = await page.evaluate(() => {
    const box = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
    const card = box('.zoom-card[data-zoom-id="zoom"]');
    const icon = box('[data-zoom-id="zoom"] [data-zoom-hero]');
    const title = box('[data-zoom-id="zoom"] h2');
    const air = box('.zoom-card[data-zoom-id="air-one"]');
    const airImage = box('[data-zoom-id="air-one"] [data-zoom-hero]');
    // Every card's metadata stays on one line.
    const subs = [...document.querySelectorAll<HTMLElement>(".zoom-card .sub")].map(
      (el) => el.getBoundingClientRect().height <= parseFloat(getComputedStyle(el).lineHeight) + 1,
    );
    return {
      left: icon.left - card.left, top: icon.top - card.top, square: icon.width / icon.height, beside: title.left - icon.right,
      airInset: airImage.left - air.left, airSpan: airImage.width / air.width, subs,
    };
  });
  expect(m.left).toBeCloseTo(10, 0);
  expect(m.top).toBeCloseTo(10, 0); // the same inset on both sides of the corner
  expect(m.square).toBeCloseTo(1, 2);
  expect(m.beside).toBeGreaterThan(8);
  expect(m.airInset).toBeCloseTo(10, 0);
  expect(m.airSpan).toBeGreaterThan(0.9); // the image spans the card
  expect(m.subs.length).toBe(9);
  expect(m.subs.every(Boolean)).toBe(true);
});

test("About ends the stream with a way to get in touch", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page, ".tile", 0);
  await page.locator(".zoom-stream").evaluate((el) => (el.scrollTop = el.scrollHeight));
  const button = page.locator('.zoom-card[data-zoom-id="about"] [data-copy-email]');
  await button.click();
  await expect(button).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("you@example.com");
  expect(await phase(page)).toBe("open"); // the button doesn't close the card
});

test("closing from the stream sends the piece being read home, across sections and card styles", async ({ page }) => {
  await open(page, ".tile", 1);
  await page.locator(".zoom-stream").evaluate((el) => {
    el.scrollTop = document.querySelector<HTMLElement>('[data-zoom-id="springs"]')!.offsetTop - 8;
  });
  await page.waitForTimeout(600);
  await page.keyboard.press("Escape");
  await expect.poll(() => phase(page)).toBe("idle");
  await expect(page.locator(".item").nth(3)).toBeFocused();
});

// One piece's text fills the top of the screen while the next piece's image is in view
// below (reported from a phone): closing sends home the piece whose image you can see.
const scrollToZoomIcon = (page: Page) =>
  page.locator(".zoom-stream").evaluate((el) => {
    el.scrollTop = document.querySelector<HTMLElement>('.zoom-card[data-zoom-id="zoom"]')!.offsetTop - 600;
  });
const reading = (page: Page) => page.evaluate(() => decodeURIComponent(location.hash.slice(1)));
const hiddenSource = (page: Page) => page.locator("[data-zoom-hidden]").evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.zoomSource));

test("closing sends home the piece whose image is in view, not the one whose text fills the top", async ({ page }) => {
  await open(page, ".tile", 1);
  await scrollToZoomIcon(page);
  await expect.poll(() => reading(page)).toBe("air-two"); // its text is under the top third
  await page.keyboard.press("Escape");
  expect(await hiddenSource(page)).toEqual(["zoom"]); // the icon's place is emptied for it
  await expect.poll(() => phase(page)).toBe("idle");
  await expect(page.locator(".item").nth(0)).toBeFocused();
});

test("a card's own close button sends that card home", async ({ page }) => {
  await open(page, ".tile", 1);
  await scrollToZoomIcon(page);
  await page.waitForTimeout(200);
  await page.locator('.zoom-card[data-zoom-id="air-two"] [data-zoom-close]').click();
  expect(await hiddenSource(page)).toEqual(["air-two"]);
  await expect.poll(() => phase(page)).toBe("idle");
});

test("the close button fades in with the open and out with the close, instead of riding the flight", async ({ page }) => {
  await page.goto("/dist/portfolio-icons.html?slow=4");
  const record = () =>
    page.evaluate(() => {
      const seen: number[] = [];
      (window as any).__bar = seen;
      const tick = () => {
        const bar = document.querySelector<HTMLElement>('.zoom-card[data-zoom-id="air-one"] .zoom-close-bar');
        if (bar && document.querySelector(".zoom-root")!.hasAttribute("data-open")) seen.push(bar.style.opacity === "" ? 1 : Number(bar.style.opacity));
        requestAnimationFrame(tick);
      };
      tick();
    });
  const seen = () => page.evaluate(() => (window as any).__bar as number[]);
  await record();
  await page.locator(".tile").nth(0).click();
  await expect.poll(() => phase(page), { timeout: 8000 }).toBe("open");
  const opening = await seen();
  expect(opening.slice(0, 3).every((o) => o < 0.3)).toBe(true); // not there on take-off
  expect(opening[opening.length - 1]).toBe(1); // fully there once open
  await record();
  await page.keyboard.press("Escape");
  await expect.poll(() => phase(page), { timeout: 8000 }).toBe("idle");
  const closing = await seen();
  expect(Math.min(...closing.slice(-3))).toBeLessThan(0.1); // gone before it lands
});
