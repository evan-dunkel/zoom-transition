import { expect, test, type Page } from "@playwright/test";
import { phase } from "./helpers";

// Options and behaviours brought in from a site that vendors this library
// (closeButton "shared", closeTarget, data-zoom-controls, landing.fit / landing.clip,
// capped decode waits, turnarounds). Run on the icon prototype, whose settings take
// them from its address (standalone/portfolio-icons/mount.tsx).

const open = async (page: Page, query = "", source = '[data-zoom-source="air-one"]') => {
  await page.goto(`/dist/portfolio-icons.html${query}`);
  await page.locator(source).dispatchEvent("click"); // a tap, without scrolling it into view
  await expect.poll(() => phase(page), { timeout: 8000 }).toBe("open");
};
const hiddenSource = (page: Page) =>
  page.locator("[data-zoom-hidden]").evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.zoomSource));

test('closeButton "shared": one close control for the whole stream, and it closes', async ({ page }) => {
  await open(page, "?close=shared");
  const counts = await page.evaluate(() => ({
    shared: document.querySelectorAll(".zoom-shared-close [data-zoom-close]").length,
    perCard: document.querySelectorAll(".zoom-card [data-zoom-close]").length,
  }));
  expect(counts).toEqual({ shared: 1, perCard: 0 });
  await page.locator(".zoom-shared-close [data-zoom-close]").click();
  await expect.poll(() => phase(page), { timeout: 8000 }).toBe("idle");
});

test('closeTarget "visible": a card\'s own close button sends home the image in view, like Escape', async ({ page }) => {
  await open(page, "?target=visible", '[data-zoom-source="air-two"]');
  // Air Two's text fills the top; the Zoom transitions icon is in view below.
  await page.locator(".zoom-stream").evaluate((el) => {
    el.scrollTop = document.querySelector<HTMLElement>('.zoom-card[data-zoom-id="zoom"]')!.offsetTop - 600;
  });
  await page.waitForTimeout(200);
  await page.locator('.zoom-card[data-zoom-id="air-two"] [data-zoom-close]').click();
  expect(await hiddenSource(page)).toEqual(["zoom"]); // not air-two, whose button it was
  await expect.poll(() => phase(page), { timeout: 8000 }).toBe("idle");
});

test("data-zoom-controls: a control over the overlay never starts a dismissal", async ({ page }) => {
  await open(page);
  // A sliver at the left edge, outside the card: a tap there would close the stream.
  const strip = (controls: boolean) =>
    page.evaluate((controls) => {
      const el = document.createElement("button");
      if (controls) el.dataset.zoomControls = "";
      el.style.cssText = "position:absolute;left:0;top:400px;width:6px;height:40px;z-index:5;padding:0;border:0";
      el.className = "probe";
      document.querySelector(".zoom-root")!.append(el);
    }, controls);
  await strip(true);
  await page.locator(".probe").click({ position: { x: 3, y: 20 } });
  await page.waitForTimeout(300);
  expect(await phase(page)).toBe("open");
  await page.locator(".probe").evaluate((el) => el.remove());
  await strip(false); // the same tap, unmarked, closes
  await page.locator(".probe").click({ position: { x: 3, y: 20 } });
  await expect.poll(() => phase(page), { timeout: 8000 }).not.toBe("open");
});

test("with slow images, a tap opens without waiting on the network", async ({ page }) => {
  await page.goto("/dist/portfolio-icons.html");
  await page.route(/\.svg(\?|$)/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await route.continue();
  });
  const opened = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const t0 = performance.now();
        const root = document.querySelector(".zoom-root")!;
        setTimeout(() => resolve(performance.now() - t0), 3000);
        new MutationObserver(() => root.hasAttribute("data-open") && resolve(performance.now() - t0)).observe(root, {
          attributes: true,
          attributeFilter: ["data-open"],
        });
        document.querySelector<HTMLElement>('[data-zoom-source="air-one"]')!.click();
      }),
  );
  expect(opened).toBeLessThan(400); // the decode wait is capped at 150ms
});

test("a close that turns a reopen around never shows a hero under its own flying copy", async ({ page }) => {
  await open(page);
  await page.waitForTimeout(300);
  const doubled = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const card = document.querySelector<HTMLElement>('.zoom-card[data-zoom-id="air-one"]')!;
        const hero = card.querySelector<HTMLElement>("[data-zoom-hero]")!;
        const escape = () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        let reopened = false;
        // The moment the reopen shows its hero for the handover, close again.
        new MutationObserver((_, observer) => {
          if (!reopened || hero.style.visibility !== "") return;
          observer.disconnect();
          escape();
          let bad = 0;
          let frames = 0;
          const check = () => {
            const copy = document.querySelector('.zoom-flight .zoom-clone[data-zoom-id="air-one"]');
            if (copy && getComputedStyle(hero).visibility === "visible") bad += 1;
            if (++frames < 12) requestAnimationFrame(check);
            else resolve(bad);
          };
          requestAnimationFrame(check);
        }).observe(hero, { attributes: true, attributeFilter: ["style"] });
        escape();
        setTimeout(() => {
          reopened = true;
          card.dispatchEvent(new MouseEvent("click", { bubbles: true })); // tap it on its way home
        }, 60);
      }),
  );
  expect(doubled).toBe(0);
});

for (const [name, query] of [["fit contain", "?fit=contain"], ["clip image", "?clip=image"]] as const) {
  test(`landing ${name}: the card is revealed through a crop in flight, cleared once open, and closes home`, async ({ page }) => {
    await page.goto(`/dist/portfolio-icons.html${query}&slow=4`);
    await page.evaluate(() => {
      const crops: string[] = [];
      (window as any).__crops = crops;
      const tick = () => {
        const card = document.querySelector<HTMLElement>('.zoom-card[data-zoom-id="air-one"]');
        if (card && document.querySelector(".zoom-root")!.getAttribute("data-phase") === "opening") crops.push(card.style.clipPath);
        requestAnimationFrame(tick);
      };
      tick();
    });
    await page.locator('[data-zoom-source="air-one"]').dispatchEvent("click");
    await expect.poll(() => phase(page), { timeout: 15000 }).toBe("open");
    const crops: string[] = await page.evaluate(() => (window as any).__crops);
    expect(crops.some((c) => c.startsWith("inset("))).toBe(true); // cropped while it flies
    expect(await page.locator('.zoom-card[data-zoom-id="air-one"]').evaluate((el) => el.style.clipPath)).toBe(""); // not once open
    await page.keyboard.press("Escape");
    await expect.poll(() => phase(page), { timeout: 15000 }).toBe("idle");
  });
}
