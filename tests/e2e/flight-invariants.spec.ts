import { expect, test, type Page } from "@playwright/test";
import { phase } from "./helpers";

// What every flight guarantees, whatever the page looks like. Run against the plain-HTML
// harness (test/scan.html), not a prototype, so these hold for any new layout: a square
// tile with a 12px corner opens into a 16:9 hero with a 32px corner and a shadow.

/** Records the flying image on every frame until the card is open. */
async function recordOpen(page: Page, source = "a") {
  await page.evaluate(() => {
    const frames: { t: number; w: number; h: number; radius: number; shadow: number }[] = [];
    (window as any).__frames = frames;
    const tick = (t: number) => {
      const win = document.querySelector<HTMLElement>(".zoom-clone-window");
      const shade = document.querySelector<HTMLElement>(".zoom-clone-shadow");
      if (win) {
        const r = win.getBoundingClientRect();
        const scale = r.width / win.offsetWidth; // the window is drawn scaled
        frames.push({
          t,
          w: r.width,
          h: r.height,
          // On screen. The window carries the corner while it crops; the copy inside it
          // after; and where the hero's image rounds itself, the image.
          radius: (() => {
            // The corner that's drawn: the window's while it crops; else the copy's if it
            // clips its content; else (the hero's image rounds itself) the image's.
            const copy = win.firstElementChild as HTMLElement;
            const drawn =
              getComputedStyle(win).overflow === "hidden" ? win
              : getComputedStyle(copy).overflow === "hidden" ? copy
              : ((copy.firstElementChild as HTMLElement) ?? copy);
            return parseFloat(getComputedStyle(drawn).borderTopLeftRadius) * scale;
          })(),
          shadow: shade ? Number(getComputedStyle(shade).opacity) : NaN,
        });
      }
      requestAnimationFrame(tick);
    };
    tick(performance.now());
  });
  await page.click(`[data-zoom-source="${source}"]`);
  await expect.poll(() => phase(page)).toBe("open");
  const frames: { t: number; w: number; h: number; radius: number; shadow: number }[] = await page.evaluate(() => (window as any).__frames);
  expect(frames.length).toBeGreaterThan(8);
  return frames;
}
/** The biggest change in one 60 Hz frame's time (a dropped frame isn't a jump). */
const biggestStep = (xs: number[], ts: number[]) =>
  Math.max(...xs.slice(1).map((x, i) => Math.abs(x - xs[i]) / Math.max(1, (ts[i + 1] - ts[i]) / (1000 / 60))));

test.beforeEach(async ({ page }) => {
  await page.goto("/test/scan.html");
});

test("the crop eases from the tile's shape to the hero's evenly, not in a rush at the end", async ({ page }) => {
  const frames = await recordOpen(page);
  const a = frames[0];
  const b = frames[frames.length - 1];
  // Width and height each reach the same share of the way on every frame.
  const worst = Math.max(...frames.map((f) => Math.abs((f.w - a.w) / (b.w - a.w) - (f.h - a.h) / (b.h - a.h))));
  expect(worst).toBeLessThan(0.03);
});

test("the corner tweens from the tile's radius to the hero's, without a jump at landing", async ({ page }) => {
  const frames = await recordOpen(page);
  const [radii, ts] = [frames.map((f) => f.radius), frames.map((f) => f.t)];
  expect(radii[0]).toBeCloseTo(12, 0);
  expect(radii[radii.length - 1]).toBeGreaterThan(30); // arrives at the hero's 32px…
  expect(biggestStep(radii, ts)).toBeLessThan(0.4 * 20); // …a little each frame
});

test("where the hero's image rounds itself (shadow left unclipped), its corner tweens too", async ({ page }) => {
  const frames = await recordOpen(page, "c");
  const [radii, ts] = [frames.map((f) => f.radius), frames.map((f) => f.t)];
  expect(radii[0]).toBeCloseTo(40, 0); // takes off with the tile's 40px…
  expect(radii[radii.length - 1]).toBeCloseTo(32, 0); // …lands with the hero's 32px
  expect(biggestStep(radii, ts)).toBeLessThan(0.4 * 8);
});

test("the shadow fades in with the flight instead of popping on at the end", async ({ page }) => {
  const frames = await recordOpen(page);
  const [shadow, ts] = [frames.map((f) => f.shadow), frames.map((f) => f.t)];
  expect(shadow[0]).toBeLessThan(0.2);
  expect(shadow[shadow.length - 1]).toBeGreaterThan(0.9);
  expect(biggestStep(shadow, ts)).toBeLessThan(0.4);
});

test("a tap or click leaves nothing focused; the keyboard keeps its place", async ({ page }) => {
  await page.click('[data-zoom-source="b"]');
  await expect.poll(() => phase(page)).toBe("open");
  expect(await page.evaluate(() => document.activeElement?.matches("[data-zoom-close]"))).toBe(false); // no ring on touch
  await page.locator(".zoom-card:not([inert]) [data-zoom-close]").click();
  await expect.poll(() => phase(page)).toBe("idle");
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  // Keyboard: focus moves to the close button, and back to the tile on close.
  await page.locator(".tile").nth(1).focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => phase(page)).toBe("open");
  expect(await page.evaluate(() => document.activeElement?.matches("[data-zoom-close]"))).toBe(true);
  await page.keyboard.press("Escape");
  await expect.poll(() => phase(page)).toBe("idle");
  await expect(page.locator(".tile").nth(1)).toBeFocused();
});

test("corner geometry follows --zoom-radius and --zoom-inset", async ({ page }) => {
  await page.addStyleTag({ content: ":root { --zoom-radius: 24px; --zoom-inset: 8px; --zoom-close-size: 28px; }" });
  // Something inset on the card, e.g. an image: .zoom-concentric gives it the matching corner.
  await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.className = "zoom-concentric probe";
    document.querySelector<HTMLTemplateElement>('template[data-zoom-destination="a"]')!.content.querySelector("article")!.append(probe);
  });
  await page.click('[data-zoom-source="a"]');
  await expect.poll(() => phase(page)).toBe("open");
  const m = await page.evaluate(() => {
    const card = document.querySelector<HTMLElement>(".zoom-card:not([inert])")!;
    const close = card.querySelector("[data-zoom-close]")!.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    return {
      card: parseFloat(getComputedStyle(card).borderTopLeftRadius),
      closeInset: c.right - close.right,
      inner: parseFloat(getComputedStyle(card.querySelector(".probe")!).borderTopLeftRadius),
    };
  });
  expect(m.card).toBeCloseTo(24, 0);
  expect(m.closeInset).toBeCloseTo(24 - 28 / 2, 0); // concentric with the card's corner
  expect(m.inner).toBeCloseTo(24 - 8, 0); // .zoom-concentric: radius − inset
});

test("a backdrop filter is at full strength when open, however light the dim", async ({ page }) => {
  await page.addStyleTag({ content: ":root { --zoom-backdrop-filter: blur(12px); }" });
  await page.click('[data-zoom-source="a"]');
  await expect.poll(() => phase(page)).toBe("open");
  const o = await page.evaluate(() => ({
    backdrop: Number(getComputedStyle(document.querySelector(".zoom-backdrop")!).opacity),
    filter: getComputedStyle(document.querySelector(".zoom-backdrop")!).backdropFilter,
    dim: Number(getComputedStyle(document.querySelector(".zoom-dim")!).opacity),
  }));
  expect(o.filter).toBe("blur(12px)");
  expect(o.backdrop).toBeCloseTo(1, 2);
  expect(o.dim).toBeLessThan(0.5); // the dim keeps its own, lighter strength
  await page.keyboard.press("Escape");
  await expect.poll(() => phase(page)).toBe("idle");
  expect(await page.evaluate(() => Number(getComputedStyle(document.querySelector(".zoom-backdrop")!).opacity))).toBe(0);
});

test("if the page moves mid-close without the viewport changing (scrolled), the card re-aims and lands on its source", async ({ page }) => {
  await page.click('[data-zoom-source="a"]');
  await expect.poll(() => phase(page)).toBe("open");
  await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>(".zoom-root")!;
    const frames: number[] = [];
    (window as any).__landing = frames;
    // Shortly into the close, the page shifts down 70px and the viewport reports a resize,
    // as the claude.ai viewer does when a page's scrolling changes.
    new MutationObserver(() => {
      if (root.dataset.phase !== "closing") return;
      setTimeout(() => {
        document.querySelector<HTMLElement>("main")!.style.paddingTop = "94px";
        dispatchEvent(new Event("resize"));
      }, 60);
    }).observe(root, { attributes: true, attributeFilter: ["data-phase"] });
    const tick = () => {
      const clone = document.querySelector(".zoom-clone-window");
      if (clone) frames.push(clone.getBoundingClientRect().top);
      requestAnimationFrame(tick);
    };
    tick();
  });
  await page.keyboard.press("Escape");
  await expect.poll(() => phase(page)).toBe("idle");
  const frames: number[] = await page.evaluate(() => (window as any).__landing);
  const tile = await page.locator('[data-zoom-source="a"]').evaluate((el) => el.getBoundingClientRect().top);
  expect(Math.abs(frames[frames.length - 1] - tile)).toBeLessThan(2); // lands where the tile is now
});

test("if a host re-lays out the page mid-close (viewport resized), the cards move with it, without a jump", async ({ page }) => {
  await page.click('[data-zoom-source="a"]');
  await expect.poll(() => phase(page)).toBe("open");
  await page.evaluate(() => {
    const frames: { clone: number; tile: number }[] = [];
    (window as any).__f = frames;
    const tick = () => {
      const clone = document.querySelector(".zoom-clone-window");
      const tile = document.querySelector('[data-zoom-source="a"]')!;
      if (clone) frames.push({ clone: clone.getBoundingClientRect().top, tile: tile.getBoundingClientRect().top });
      requestAnimationFrame(tick);
    };
    tick();
  });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(80);
  // What the claude.ai viewer does on a phone: the page's viewport gets 70px shorter and
  // its content moves up 70px in it, in one go (on screen the page stays put).
  await page.evaluate(() => {
    document.querySelector<HTMLElement>("main")!.style.marginTop = "-70px";
    const h = (visualViewport?.height ?? innerHeight) - 70;
    if (visualViewport) Object.defineProperty(visualViewport, "height", { get: () => h, configurable: true });
    Object.defineProperty(window, "innerHeight", { get: () => h, configurable: true });
    dispatchEvent(new Event("resize"));
  });
  await expect.poll(() => phase(page)).toBe("idle");
  const frames: { clone: number; tile: number }[] = await page.evaluate(() => (window as any).__f);
  const gaps = frames.map((f) => f.clone - f.tile);
  const steps = gaps.slice(1).map((g, i) => Math.abs(g - gaps[i]));
  expect(Math.max(...steps)).toBeLessThan(40); // no 70px jump relative to the page
  expect(Math.abs(gaps[gaps.length - 1])).toBeLessThan(2); // and it lands on the tile
});
