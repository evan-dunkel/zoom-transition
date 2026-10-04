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

test("the close button stays hidden under the flight, fades in once landed, and fades out above the close", async ({ page }) => {
  await page.goto("/dist/portfolio-icons.html?slow=4");
  // Every frame: the button's drawn opacity (bar × button), and any copy of it above the flight.
  await page.evaluate(() => {
    const seen: { phase: string; o: number; ghost: number | null }[] = [];
    (window as any).__x = seen;
    const tick = () => {
      const root = document.querySelector<HTMLElement>(".zoom-root")!;
      const button = document.querySelector<HTMLElement>('.zoom-card[data-zoom-id="air-one"] .zoom-close');
      const ghost = document.querySelector<HTMLElement>(".zoom-flight .zoom-close");
      if (button && root.hasAttribute("data-open"))
        seen.push({
          phase: root.dataset.phase!,
          o: Number(getComputedStyle(button.parentElement!).opacity) * Number(getComputedStyle(button).opacity),
          ghost: ghost ? Number(getComputedStyle(ghost).opacity) : null,
        });
      requestAnimationFrame(tick);
    };
    tick();
  });
  const seen = () => page.evaluate(() => (window as any).__x as { phase: string; o: number; ghost: number | null }[]);
  await page.locator(".tile").nth(0).click();
  await expect.poll(() => phase(page), { timeout: 8000 }).toBe("open");
  await page.waitForTimeout(400);
  const opening = await seen();
  expect(opening.filter((f) => f.phase === "opening").every((f) => f.o < 0.05)).toBe(true); // hidden in flight
  const landed = opening.filter((f) => f.phase === "open").map((f) => f.o);
  expect(landed[0]).toBeLessThan(0.5); // fades in after landing…
  expect(landed[landed.length - 1]).toBe(1); // …to full
  await page.evaluate(() => ((window as any).__x.length = 0));
  await page.keyboard.press("Escape");
  await expect.poll(() => phase(page), { timeout: 8000 }).toBe("idle");
  const ghosts = (await seen()).map((f) => f.ghost).filter((g): g is number => g !== null);
  expect(ghosts.length).toBeGreaterThan(2); // a copy above the flying image…
  expect(ghosts[0]).toBeGreaterThan(0.6);
  expect(Math.min(...ghosts)).toBeLessThan(0.3); // …fading out
  expect(await page.locator(".zoom-flight .zoom-close").count()).toBe(0); // and gone
});
