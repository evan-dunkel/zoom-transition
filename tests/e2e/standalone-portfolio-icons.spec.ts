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
  test.skip(test.info().project.name === "iphone-webkit", "reads the clipboard, which needs a permission only Chromium grants here");
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

test("the close button rides above the flight, fading with it, and the real one takes over at landing", async ({ page }) => {
  await page.goto("/dist/portfolio-icons.html?slow=4");
  // Every frame: the real button's drawn opacity (bar × button), and its copy above the flight.
  await page.evaluate(() => {
    const seen: { phase: string; o: number; ghost: number | null; onTop: boolean }[] = [];
    (window as any).__x = seen;
    const tick = () => {
      const root = document.querySelector<HTMLElement>(".zoom-root")!;
      const button = document.querySelector<HTMLElement>('.zoom-card[data-zoom-id="air-one"] .zoom-close');
      const ghost = document.querySelector<HTMLElement>(".zoom-flight .zoom-close");
      if (button && root.hasAttribute("data-open")) {
        // On top: in the flight layer with the flying image, stacked above it.
        const clone = document.querySelector<HTMLElement>(".zoom-flight .zoom-clone");
        const onTop =
          !!ghost && (!clone || ghost.parentElement === clone.parentElement) &&
          (!clone || Number(getComputedStyle(ghost).zIndex) > (Number(getComputedStyle(clone).zIndex) || 0));
        seen.push({
          phase: root.dataset.phase!,
          o: Number(getComputedStyle(button.parentElement!).opacity) * Number(getComputedStyle(button).opacity),
          ghost: ghost ? Number(getComputedStyle(ghost).opacity) : null,
          onTop,
        });
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
  const seen = () => page.evaluate(() => (window as any).__x as { phase: string; o: number; ghost: number | null; onTop: boolean }[]);
  await page.locator(".tile").nth(0).click();
  await expect.poll(() => phase(page), { timeout: 8000 }).toBe("open");
  await page.waitForTimeout(200);
  const opening = await seen();
  const inFlight = opening.filter((f) => f.phase === "opening");
  expect(inFlight.every((f) => f.o < 0.05)).toBe(true); // the real one is hidden under the flight…
  const ghosts = inFlight.map((f) => f.ghost).filter((g): g is number => g !== null);
  expect(ghosts.length).toBeGreaterThan(5); // …and its copy is drawn above it,
  expect(inFlight.filter((f) => f.ghost !== null && f.ghost > 0.05).every((f) => f.onTop)).toBe(true);
  expect(ghosts[0]).toBeLessThan(0.2); // fading in with the flight…
  expect(ghosts[ghosts.length - 1]).toBeGreaterThan(0.8);
  const landed = opening.filter((f) => f.phase === "open");
  expect(landed[0].o).toBe(1); // …and the real one is at full in the frame it lands: no dip
  expect(landed.every((f) => f.ghost === null)).toBe(true);
  await page.evaluate(() => ((window as any).__x.length = 0));
  await page.keyboard.press("Escape");
  await expect.poll(() => phase(page), { timeout: 8000 }).toBe("idle");
  const closing = (await seen()).map((f) => f.ghost).filter((g): g is number => g !== null);
  expect(closing.length).toBeGreaterThan(2); // on close, the copy above the flying image…
  expect(closing[0]).toBeGreaterThan(0.6);
  expect(Math.min(...closing)).toBeLessThan(0.3); // …fades out with it
  expect(await page.locator(".zoom-flight .zoom-close").count()).toBe(0); // and is gone
});

test("loading the page at a piece's address opens it, already open, and Back closes it onto the page", async ({ page }) => {
  await page.goto("/dist/portfolio.html"); // an earlier page in the history
  await page.addInitScript(() => {
    // Record any flight, every frame: an address opens the piece in place, without one.
    (window as any).__flew = false;
    const tick = () => {
      if (document.querySelector(".zoom-clone")) (window as any).__flew = true;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.goto("/dist/portfolio-icons.html#springs");
  await expect.poll(() => phase(page), { timeout: 3000 }).toBe("open");
  expect(await page.evaluate(() => (window as any).__flew)).toBe(false);
  expect(await page.evaluate(() => location.hash)).toBe("#springs");
  const top = await page.locator('.zoom-card[data-zoom-id="springs"]').evaluate((el) => el.getBoundingClientRect().top);
  expect(top).toBeGreaterThanOrEqual(0); // the piece itself, at the top of the stream
  expect(top).toBeLessThan(200);
  await page.goBack();
  await expect.poll(() => phase(page), { timeout: 8000 }).toBe("idle");
  expect(await page.evaluate(() => [location.pathname.endsWith("portfolio-icons.html"), location.hash])).toEqual([true, ""]);
});

test("changing the address to a piece's within the page opens it, and Back closes it", async ({ page }) => {
  await page.goto("/dist/portfolio-icons.html");
  const before = await page.evaluate(() => history.length);
  await page.evaluate(() => (location.hash = "springs")); // as typed into the address bar
  await expect.poll(() => phase(page), { timeout: 8000 }).toBe("open");
  const entries = (await page.evaluate(() => history.length)) - before;
  await page.goBack();
  await expect.poll(() => phase(page), { timeout: 8000 }).toBe("idle");
  expect(await page.evaluate(() => location.hash)).toBe("");
  expect(entries).toBe(1); // the browser's entry for the piece, and no extra one of ours
});

test("an address that isn't a piece is left alone", async ({ page }) => {
  await page.goto("/dist/portfolio-icons.html#projects"); // the section heading's own anchor
  await page.waitForTimeout(300);
  expect(await phase(page)).toBe("idle");
  expect(await page.evaluate(() => location.hash)).toBe("#projects");
});

// Read on into a piece whose tile is off the page's screen, then close: the page scrolls
// to that tile, centred, and the card lands on it in view.
test("closing on a piece whose tile is out of view brings the tile into view, centred, and lands on it", async ({ page }) => {
  await page.goto("/dist/portfolio-icons.html");
  await page.locator(".tile").nth(0).click(); // at the top of the page
  await expect.poll(() => phase(page)).toBe("open");
  await page.locator(".zoom-stream").evaluate((el) => {
    el.scrollTop = document.querySelector<HTMLElement>('.zoom-card[data-zoom-id="case-studies"]')!.offsetTop - 8;
  });
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#case-studies");
  await page.keyboard.press("Escape");
  await expect.poll(() => phase(page), { timeout: 8000 }).toBe("idle");
  const tile = await page.locator('[data-zoom-source="case-studies"]').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, middle: (r.top + r.bottom) / 2, vh: innerHeight };
  });
  expect(tile.top).toBeGreaterThanOrEqual(0); // in view…
  expect(tile.bottom).toBeLessThanOrEqual(tile.vh);
  expect(Math.abs(tile.middle - tile.vh / 2)).toBeLessThan(tile.vh * 0.15); // …centred
});

test('revealSource "read": the page behind follows the piece being read, so the close moves nothing', async ({ page }) => {
  await page.goto("/dist/portfolio-icons.html?reveal=read");
  await page.locator(".tile").nth(0).click();
  await expect.poll(() => phase(page)).toBe("open");
  await page.locator(".zoom-stream").evaluate((el) => {
    el.scrollTop = document.querySelector<HTMLElement>('.zoom-card[data-zoom-id="case-studies"]')!.offsetTop - 8;
  });
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#case-studies");
  // Already there while reading: the tile is centred behind the open card…
  const middle = () =>
    page.locator('[data-zoom-source="case-studies"]').evaluate((el) => {
      const r = el.getBoundingClientRect();
      return (r.top + r.bottom) / 2 - innerHeight / 2;
    });
  // (as near centre as the page can scroll: this tile is close to the page's end)
  await expect.poll(async () => Math.abs(await middle())).toBeLessThan(page.viewportSize()!.height * 0.15);
  const scrolled = await page.evaluate(() => scrollY);
  expect(scrolled).toBeGreaterThan(300);
  // …and the open card didn't move on screen when the page did.
  const card = await page.locator('.zoom-card[data-zoom-id="case-studies"]').evaluate((el) => el.getBoundingClientRect().top);
  expect(card).toBeCloseTo(8, 0);
  await page.keyboard.press("Escape");
  await expect.poll(() => phase(page), { timeout: 8000 }).toBe("idle");
  expect(await page.evaluate(() => scrollY)).toBe(scrolled); // …so the close didn't scroll
});

// Near the page's end a source can't be centred: the page only scrolls as far as its own
// content (not the open overlay's overhang under a phone's toolbar), so nothing jumps
// back once the overlay closes.
for (const id of ["about", "case-studies"]) {
  test(`closing on ${id}, near the page's end, scrolls only as far as the page goes, with no jump at landing`, async ({ page }) => {
    await page.goto("/dist/portfolio-icons.html");
    const [max, height] = await page.evaluate(() => [document.documentElement.scrollHeight - innerHeight, document.documentElement.scrollHeight]);
    await page.locator(".tile").nth(0).click();
    await expect.poll(() => phase(page)).toBe("open");
    await page.locator(".zoom-stream").evaluate((el, id) => {
      el.scrollTop = document.querySelector<HTMLElement>(`.zoom-card[data-zoom-id="${id}"]`)!.offsetTop - 8;
    }, id);
    await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#${id}`);
    await page.evaluate(() => {
      const seen: number[] = [];
      (window as any).__y = seen;
      const tick = () => {
        seen.push(scrollY);
        (window as any).__h = Math.max((window as any).__h ?? 0, document.documentElement.scrollHeight);
        requestAnimationFrame(tick);
      };
      tick();
    });
    await page.keyboard.press("Escape");
    await expect.poll(() => phase(page), { timeout: 8000 }).toBe("idle");
    await page.waitForTimeout(200);
    const ys: number[] = await page.evaluate(() => (window as any).__y);
    const moved = ys.filter((y, i) => i > 0 && y !== ys[i - 1]);
    expect(await page.evaluate(() => (window as any).__h)).toBeLessThanOrEqual(height + 1); // the page never grows…
    expect(Math.max(...ys)).toBeLessThanOrEqual(max + 1); // …nor scrolls past its end…
    expect(moved.length).toBeLessThanOrEqual(1); // …one scroll, at the start, and no jump back
  });
}
