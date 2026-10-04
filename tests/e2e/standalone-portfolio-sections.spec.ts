import { expect, test, type Page } from "@playwright/test";
import { phase } from "./helpers";

// The sections prototype (standalone/portfolio-sections): the icon prototype's content,
// with each section's works joined into one continuous card and a switchable
// delineation between them.

const open = async (page: Page, source: string, nth: number) => {
  await page.goto("/dist/portfolio-sections.html");
  await page.locator(source).nth(nth).click();
  await expect.poll(() => phase(page)).toBe("open");
};
const cards = (page: Page) =>
  page.locator(".zoom-card").evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el.querySelector(".zoom-card-content")!);
      const e = el as HTMLElement;
      return {
        id: e.dataset.zoomId, section: e.dataset.zoomSection, start: e.hasAttribute("data-zoom-section-start"), end: e.hasAttribute("data-zoom-section-end"),
        top: r.top, bottom: r.bottom, radiusTop: parseFloat(cs.borderTopLeftRadius), radiusBottom: parseFloat(cs.borderBottomLeftRadius),
      };
    }),
  );

test("the library marks each stream card's section, and where the section starts and ends", async ({ page }) => {
  await open(page, ".tile", 0);
  const marks = (await cards(page)).map((c) => `${c.section}:${c.start ? "start" : ""}${c.end ? "end" : ""}`);
  expect(marks).toEqual([
    "Air Apps:start", "Air Apps:end",
    "Personal projects:start", "Personal projects:end",
    "Writing and experiments:start", "Writing and experiments:", "Writing and experiments:", "Writing and experiments:end",
    "About:startend",
  ]);
});

test("a section's works join into one card: no gaps, square joins, rounded ends", async ({ page }) => {
  await open(page, ".item", 2);
  await page.waitForTimeout(400); // the joins ease square once open
  const all = await cards(page);
  for (let i = 1; i < all.length; i++) {
    const [a, b] = [all[i - 1], all[i]];
    if (a.section === b.section) {
      expect(b.top).toBeCloseTo(a.bottom, 0); // touching
      expect(a.radiusBottom).toBe(0);
      expect(b.radiusTop).toBe(0);
    } else expect(b.top - a.bottom).toBeGreaterThan(30); // the next section's title sits between
  }
  for (const c of all) {
    if (c.start) expect(c.radiusTop).toBeGreaterThan(20);
    if (c.end) expect(c.radiusBottom).toBeGreaterThan(20);
  }
});

test("a work flying home is a card of its own again, rounded all round", async ({ page }) => {
  await open(page, ".item", 3); // springs: in the middle of its section
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const springs = (await cards(page)).find((c) => c.id === "springs")!;
  expect(springs.radiusTop).toBeGreaterThan(20);
  expect(springs.radiusBottom).toBeGreaterThan(20);
  await expect.poll(() => phase(page)).toBe("idle");
});

test("the delineation switches, persists, and stays usable while a card is open", async ({ page }) => {
  await open(page, ".tile", 1);
  const delineation = () => page.evaluate(() => document.documentElement.dataset.delineation);
  expect(await delineation()).toBe("line");
  for (const v of ["space", "receipt", "gradient", "fade"]) {
    await page.locator(`.variants button[value="${v}"]`).click();
    expect(await delineation()).toBe(v);
    expect(await phase(page)).toBe("open"); // switching doesn't close the card
  }
  await page.reload();
  expect(await delineation()).toBe("fade");
});

test("fading text never touches the image that flies", async ({ page }) => {
  await page.goto("/dist/portfolio-sections.html");
  await page.evaluate(() => localStorage.setItem("portfolio-sections:delineation", "fade"));
  await open(page, ".item", 2);
  await page.locator(".zoom-stream").evaluate((el) => (el.scrollTop += 1500));
  await page.waitForTimeout(300);
  const heroes = await page.locator(".zoom-card [data-zoom-hero]").evaluateAll((els) => els.map((el) => getComputedStyle(el).opacity));
  expect(heroes.every((o) => o === "1")).toBe(true);
});
