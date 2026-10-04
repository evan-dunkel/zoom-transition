import { expect, test } from "@playwright/test";
import { phase } from "./helpers";

// The standalone portfolio (standalone/portfolio): plain markup, one island.

test("plain markup opens into a continuous stream and closes onto the piece being read", async ({ page }) => {
  await page.goto("/dist/portfolio.html");
  await page.locator(".tile").nth(1).click();
  await expect.poll(() => phase(page)).toBe("open");
  const ids = await page.locator(".zoom-card").evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.zoomId));
  expect(ids).toEqual(["tidewater", "fernwood", "atlas", "kiln"]);
  // The image is inset on the card.
  const inset = await page.evaluate(() => {
    const card = document.querySelector('[data-zoom-id="fernwood"].zoom-card')!.getBoundingClientRect();
    const hero = document.querySelector('[data-zoom-id="fernwood"] [data-zoom-hero]')!.getBoundingClientRect();
    return hero.left - card.left;
  });
  expect(inset).toBeGreaterThanOrEqual(8);
  // Scroll on into the next piece, then close: that one goes home.
  await page.locator(".zoom-stream").evaluate((el) => {
    el.scrollTop = document.querySelector<HTMLElement>('[data-zoom-id="atlas"]')!.offsetTop - 8;
  });
  await page.waitForTimeout(600);
  await page.keyboard.press("Escape");
  await expect.poll(() => phase(page)).toBe("idle");
  await expect(page.locator(".tile").nth(2)).toBeFocused();
});

test("the image's shadow fades in with the open and out with the close, instead of popping", async ({ page }) => {
  await page.goto("/dist/portfolio.html");
  // Record the flying image's shadow opacity on every frame.
  const record = () =>
    page.evaluate(() => {
      const seen: number[] = [];
      (window as any).__shadow = seen;
      const tick = () => {
        const sh = document.querySelector<HTMLElement>(".zoom-clone-shadow");
        if (sh && sh.style.opacity !== "") seen.push(Number(sh.style.opacity));
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  const seen = () => page.evaluate(() => (window as any).__shadow as number[]);

  await record();
  await page.locator(".tile").nth(1).click();
  await expect.poll(() => phase(page)).toBe("open");
  const opening = await seen();
  expect(opening.length).toBeGreaterThan(5);
  expect(opening[0]).toBeLessThan(0.3); // barely any shadow as it lifts off the tile
  expect(opening[opening.length - 1]).toBeGreaterThan(0.85); // all of it by the time it lands
  // The in-card image's own shadow takes over unchanged.
  expect(await page.locator('[data-zoom-id="fernwood"] [data-zoom-hero]').evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe("none");

  await record();
  await page.keyboard.press("Escape");
  await expect.poll(() => phase(page)).toBe("idle");
  const closing = await seen();
  expect(closing.length).toBeGreaterThan(3);
  expect(closing[0]).toBeGreaterThan(0.7);
  expect(closing[closing.length - 1]).toBeLessThan(0.15); // gone as it lands on the tile, which has none
});

// The flying copy is scaled as a whole, which used to scale its corners too: a corner
// read smaller mid-flight (about 1 px for a small thumbnail) and jumped on landing. Now
// its on-screen radius moves steadily from one end's to the other's: projects have 18 px
// on the tile and on the card (so it holds), writing goes from the 10 px thumbnail to 18.
for (const [label, open, tile, card] of [
  ["a project", ".tile", 18, 18],
  ["a piece of writing", ".row", 10, 18],
] as const) {
  test(`corners keep their true on-screen radius in flight: ${label}`, async ({ page }) => {
    await page.goto("/dist/portfolio.html");
    const record = () =>
      page.evaluate(() => {
        const seen: number[] = [];
        (window as any).__corners = seen;
        const tick = () => {
          const el = document.querySelector<HTMLElement>(".zoom-clone");
          const copy = el?.querySelector<HTMLElement>(".zoom-clone-window > :first-child");
          const scale = el && /scale\(([\d.e-]+)\)/.exec(el.style.transform);
          if (copy && scale && copy.style.borderRadius) seen.push(parseFloat(copy.style.borderRadius) * Number(scale[1]));
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    const corners = () => page.evaluate(() => (window as any).__corners as number[]);
    // Radii are written as Figma values and scaled for corner smoothing where supported.
    const k = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--zoom-smooth")) || 1);
    const [tileR, cardR] = [tile * k, card * k];
    const lo = Math.min(tileR, cardR) - 0.5;
    const hi = Math.max(tileR, cardR) + 0.5;
    await record();
    await page.locator(open).nth(1).click();
    await expect.poll(() => phase(page)).toBe("open");
    const opening = await corners();
    expect(opening.length).toBeGreaterThan(5);
    expect(opening[0]).toBeCloseTo(tileR, 0); // takes off with the tile's corner
    expect(opening[opening.length - 1]).toBeCloseTo(cardR, 0); // lands with the card image's
    for (const r of opening) expect(r >= lo && r <= hi).toBe(true); // never shrinks with the scale
    await record();
    await page.keyboard.press("Escape");
    await expect.poll(() => phase(page)).toBe("idle");
    const closing = await corners();
    expect(closing.length).toBeGreaterThan(3);
    expect(closing[0]).toBeCloseTo(cardR, 0);
    expect(closing[closing.length - 1]).toBeCloseTo(tileR, 0);
    for (const r of closing) expect(r >= lo && r <= hi).toBe(true);
  });
}

test("card, image and close button are concentric, with an even inset around the image", async ({ page }) => {
  await page.goto("/dist/portfolio.html");
  await page.locator(".tile").nth(1).click();
  await expect.poll(() => phase(page)).toBe("open");
  const g = await page.evaluate(() => {
    const card = document.querySelector('[data-zoom-id="fernwood"].zoom-card')!;
    const surfaceEl = card.querySelector<HTMLElement>(".zoom-card-content")!;
    const imageEl = card.querySelector<HTMLElement>("[data-zoom-hero]")!;
    const s = surfaceEl.getBoundingClientRect();
    const i = imageEl.getBoundingClientRect();
    const x = card.querySelector("[data-zoom-close]")!.getBoundingClientRect();
    const k = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--zoom-smooth")) || 1;
    const R = parseFloat(getComputedStyle(surfaceEl).borderTopRightRadius) / k;
    const r = parseFloat(getComputedStyle(imageEl).borderTopRightRadius) / k;
    return {
      inset: [i.top - s.top, i.left - s.left, s.right - i.right],
      card: [R, R],
      image: [s.right - i.right + r, i.top - s.top + r],
      close: [s.right - (x.left + x.width / 2), x.top + x.height / 2 - s.top],
    };
  });
  // The image's inset is the same at the top as at the sides (its margin used to escape the card).
  expect(g.inset[0]).toBeCloseTo(g.inset[1], 0);
  expect(g.inset[2]).toBeCloseTo(g.inset[1], 0);
  // All three corners share a centre.
  for (const c of [g.image, g.close]) {
    expect(c[0]).toBeCloseTo(g.card[0], 0);
    expect(c[1]).toBeCloseTo(g.card[1], 0);
  }
});

test("a card's close button fades out as the card scrolls away, instead of being cut off", async ({ page }) => {
  await page.goto("/dist/portfolio.html");
  await page.locator(".tile").nth(1).click();
  await expect.poll(() => phase(page)).toBe("open");
  const bar = page.locator('[data-zoom-id="fernwood"] .zoom-close-bar');
  const opacityWhenBottomAt = async (fromTop: number) => {
    await page.locator(".zoom-stream").evaluate((el, fromTop) => {
      const card = document.querySelector<HTMLElement>('[data-zoom-id="fernwood"].zoom-card')!;
      el.scrollTop = card.offsetTop + card.offsetHeight - fromTop;
    }, fromTop);
    await page.waitForTimeout(150);
    return bar.evaluate((el) => Number(getComputedStyle(el).opacity));
  };
  expect(await opacityWhenBottomAt(400)).toBe(1); // plenty of card left: fully there
  const mid = await opacityWhenBottomAt(80);
  expect(mid).toBeGreaterThan(0.05);
  expect(mid).toBeLessThan(0.95); // on its way out
  expect(await opacityWhenBottomAt(40)).toBe(0); // gone before the edge reaches it
  expect(await opacityWhenBottomAt(400)).toBe(1); // and back when scrolled back
});


test("writing opens without its shadow or corners being cut by the crop", async ({ page }) => {
  await page.goto("/dist/portfolio.html");
  // Watch the flight while it's cropped (a square thumbnail opening into a wide image).
  await page.evaluate(() => {
    const seen: { clip: string; winInset: string; shadeInset: string; winRadius: string }[] = [];
    (window as any).__crop = seen;
    const tick = () => {
      const el = document.querySelector<HTMLElement>(".zoom-clone");
      const win = el?.querySelector<HTMLElement>(".zoom-clone-window");
      const shade = el?.querySelector<HTMLElement>(".zoom-clone-shadow");
      if (el && win && shade && win.style.overflow === "hidden")
        seen.push({ clip: el.style.clipPath, winInset: win.style.inset, shadeInset: shade.style.inset, winRadius: win.style.borderRadius });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.locator(".row").nth(1).click();
  await expect.poll(() => phase(page)).toBe("open");
  const frames = await page.evaluate(() => (window as any).__crop as { clip: string; winInset: string; shadeInset: string; winRadius: string }[]);
  expect(frames.length).toBeGreaterThan(2); // it was cropped for a while
  for (const f of frames) {
    expect(f.clip).toBe(""); // nothing cuts the flight as a whole (the shadow included)
    expect(f.shadeInset).toBe(f.winInset); // the shadow wraps the visible, cropped shape
    expect(parseFloat(f.winRadius)).toBeGreaterThan(0); // and its corners stay rounded
  }
});

test("corners are smoothed where the browser can draw it", async ({ page }) => {
  await page.goto("/dist/portfolio.html");
  const supported = await page.evaluate(() => CSS.supports("corner-shape", "superellipse(2)"));
  test.skip(!supported, "this browser has no corner-shape; plain radii are the fallback");
  await page.locator(".tile").nth(1).click();
  await expect.poll(() => phase(page)).toBe("open");
  const shapes = await page.evaluate(() =>
    [".tile-image", '[data-zoom-id="fernwood"].zoom-card', '[data-zoom-id="fernwood"] .zoom-card-content', '[data-zoom-id="fernwood"] [data-zoom-hero]'].map(
      (sel) => getComputedStyle(document.querySelector(sel)!).getPropertyValue("corner-top-left-shape"),
    ),
  );
  for (const s of shapes) expect(s).toContain("superellipse");
});

test("after a tap or click nothing is left focused; keyboard users keep their place", async ({ page }) => {
  await page.goto("/dist/portfolio.html");
  const focused = () =>
    page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      if (!a || a === document.body) return "body";
      if (a.matches("[data-zoom-close]")) return "close";
      if (a.matches(".zoom-card")) return "card";
      return a.className || a.tagName;
    });
  // Pointer: the open card takes focus (not its close button); closing leaves nothing focused.
  await page.locator(".tile").nth(1).click();
  await expect.poll(() => phase(page)).toBe("open");
  expect(await focused()).toBe("card");
  await page.locator('[data-zoom-id="fernwood"] [data-zoom-close]').click();
  await expect.poll(() => phase(page)).toBe("idle");
  expect(await focused()).toBe("body");
  // Keyboard: Enter on a tile lands on the close button; Escape returns to the tile.
  await page.locator(".tile").nth(1).focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => phase(page)).toBe("open");
  expect(await focused()).toBe("close");
  await page.keyboard.press("Escape");
  await expect.poll(() => phase(page)).toBe("idle");
  expect(await focused()).toBe("tile");
});

test("a sideways scroll neither scrolls the column nor pulls the card", async ({ page }) => {
  await page.goto("/dist/portfolio.html");
  await page.locator(".tile").nth(1).click();
  await expect.poll(() => phase(page)).toBe("open");
  expect(await page.locator(".zoom-stream").evaluate((el) => getComputedStyle(el).overscrollBehaviorX)).toBe("none");
  const top = await page.locator(".zoom-stream").evaluate((el) => el.scrollTop);
  await page.mouse.move(215, 450);
  // A sideways swipe with some vertical wobble in it: once it's sideways, it stays sideways.
  for (const [dx, dy] of [[12, 6], [18, 10], [22, 14], [24, 18], [20, 22], [16, 12]]) {
    await page.mouse.wheel(dx, dy);
    await page.waitForTimeout(16);
  }
  expect(await page.locator(".zoom-stream").evaluate((el) => el.scrollTop)).toBe(top);
  // Sideways wheel dismissal is off by default (dismiss.wheelSideways): nothing moves.
  expect(await page.locator(".zoom-zoomer").evaluate((el) => getComputedStyle(el).transform)).toBe("none");
  await page.waitForTimeout(400);
  expect(await phase(page)).toBe("open");
});

test("writing's image uncrops evenly through the flight, not in a rush at the end", async ({ page }) => {
  await page.goto("/dist/portfolio.html");
  // Every frame: the flying image's visible (cropped) size on screen.
  await page.evaluate(() => {
    const seen: { w: number; h: number }[] = [];
    (window as any).__crop = seen;
    const tick = () => {
      const win = document.querySelector<HTMLElement>(".zoom-clone-window");
      if (win) {
        const r = win.getBoundingClientRect();
        seen.push({ w: r.width, h: r.height });
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
  await page.locator(".row").first().click(); // a square thumbnail opening into a wide image
  await expect.poll(() => phase(page)).toBe("open");
  const frames: { w: number; h: number }[] = await page.evaluate(() => (window as any).__crop);
  expect(frames.length).toBeGreaterThan(8);
  const a = frames[0];
  const b = frames[frames.length - 1];
  // The square becomes wide: the width grows several times more than the height. Each
  // grows the same share of the way at once, so the shape eases from square to wide
  // with the motion instead of widening late.
  let worst = 0;
  for (const f of frames) {
    const tw = (f.w - a.w) / (b.w - a.w);
    const th = (f.h - a.h) / (b.h - a.h);
    worst = Math.max(worst, Math.abs(tw - th));
  }
  expect(worst).toBeLessThan(0.03); // before the fix: 0.10, the width catching up at the end
});

// iOS Safari can draw a hero that has both a shadow and overflow: hidden with its shadow
// clipped to a square box and its corners square once it lands. Heroes with a shadow
// leave their overflow visible; their image rounds itself (border-radius: inherit).
for (const url of ["/dist/portfolio.html", "/dist/portfolio-icons.html", "/dist/portfolio-sections.html"]) {
  test(`heroes with a shadow don't clip their own overflow: ${url}`, async ({ page }) => {
    await page.goto(url);
    const heroes = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLTemplateElement>("template[data-zoom-destination]")].map((t) => {
        const host = document.createElement("div");
        host.className = "zoom-card-content";
        host.append(t.content.cloneNode(true));
        document.body.append(host);
        const hero = host.querySelector<HTMLElement>("[data-zoom-hero]")!;
        const cs = getComputedStyle(hero);
        const image = hero.firstElementChild ? getComputedStyle(hero.firstElementChild).borderTopLeftRadius : "";
        const result = { id: t.dataset.zoomDestination, shadow: cs.boxShadow !== "none", overflow: cs.overflow, radius: cs.borderTopLeftRadius, image };
        host.remove();
        return result;
      }),
    );
    for (const h of heroes.filter((x) => x.shadow)) {
      expect(h.overflow, h.id).toBe("visible");
      expect(h.image, h.id).toBe(h.radius); // the image carries the hero's corner
    }
  });
}
