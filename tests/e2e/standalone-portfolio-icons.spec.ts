import { expect, test } from "@playwright/test";
import { phase } from "./helpers";

// The icon prototype (standalone/portfolio-icons): every piece opens into one stream,
// with each section's title above its first card, and each card leads with an icon.

const open = async (page: import("@playwright/test").Page, nth: number) => {
  await page.goto("/dist/portfolio-icons.html");
  await page.locator(".item").nth(nth).click();
  await expect.poll(() => phase(page)).toBe("open");
};

test("projects, writing and About open as one stream, each section under its title", async ({ page }) => {
  await open(page, 1);
  // The stream's children in order: titles and cards.
  const order = await page.locator(".zoom-card").first().evaluate((card) =>
    [...card.parentElement!.children].map((el) => (el.hasAttribute("data-zoom-section-title") ? "# " + el.textContent : (el as HTMLElement).dataset.zoomId)),
  );
  expect(order).toEqual([
    "# Projects", "tidewater", "fernwood", "atlas", "kiln",
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
  await open(page, 4); // the first piece of writing
  const title = await page.locator("[data-zoom-section-title]", { hasText: "Writing" }).boundingBox();
  const card = await page.locator('.zoom-card[data-zoom-id="interruptible"]').boundingBox();
  expect(title!.y).toBeGreaterThanOrEqual(0);
  expect(title!.y + title!.height).toBeLessThanOrEqual(card!.y + 1);
});

test("each card leads with its icon at the corner, the title beside it", async ({ page }) => {
  await open(page, 0);
  const m = await page.evaluate(() => {
    const card = document.querySelector('.zoom-card[data-zoom-id="tidewater"]')!.getBoundingClientRect();
    const icon = document.querySelector('[data-zoom-id="tidewater"] [data-zoom-hero]')!.getBoundingClientRect();
    const title = document.querySelector('[data-zoom-id="tidewater"] h2')!.getBoundingClientRect();
    const sub = document.querySelector<HTMLElement>('[data-zoom-id="tidewater"] .piece-title .sub')!;
    return { left: icon.left - card.left, top: icon.top - card.top, square: icon.width / icon.height, beside: title.left - icon.right, oneLine: sub.scrollHeight <= parseFloat(getComputedStyle(sub).lineHeight) + 1 };
  });
  expect(m.left).toBeCloseTo(10, 0);
  expect(m.top).toBeCloseTo(10, 0); // the same inset on both sides of the corner
  expect(m.square).toBeCloseTo(1, 2);
  expect(m.beside).toBeGreaterThan(8);
  expect(m.oneLine).toBe(true);
});

test("About ends the stream with a way to get in touch", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page, 0);
  await page.locator(".zoom-stream").evaluate((el) => (el.scrollTop = el.scrollHeight));
  const button = page.locator('.zoom-card[data-zoom-id="about"] [data-copy-email]');
  await button.click();
  await expect(button).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("ines@calder.example");
  expect(await phase(page)).toBe("open"); // the button doesn't close the card
});

test("closing from the stream sends the piece being read home, across sections", async ({ page }) => {
  await open(page, 1);
  await page.locator(".zoom-stream").evaluate((el) => {
    el.scrollTop = document.querySelector<HTMLElement>('[data-zoom-id="springs"]')!.offsetTop - 8;
  });
  await page.waitForTimeout(600);
  await page.keyboard.press("Escape");
  await expect.poll(() => phase(page)).toBe("idle");
  await expect(page.locator(".item").nth(5)).toBeFocused();
});
