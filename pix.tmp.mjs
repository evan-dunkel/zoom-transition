import { chromium } from "playwright";
const dir = process.argv[2];
const b = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
const shots = [
  ["shelves", "/dist/", async (p) => { await p.locator(".book").nth(0).click(); }],
  ["feed", "/dist/", async (p) => { await p.getByRole("button", { name: "Feed" }).click(); await p.locator(".tile").nth(2).click(); }],
  ["react-portfolio", "/dist/", async (p) => { await p.getByRole("button", { name: "Portfolio" }).click(); await p.locator(".pf-tile").nth(0).click(); }],
  ["pf-index", "/dist/portfolio.html", null],
  ["pf-open", "/dist/portfolio.html", async (p) => { await p.locator(".tile").nth(0).click(); }],
  ["pf-writing", "/dist/portfolio.html", async (p) => { await p.locator(".row").nth(0).click(); }],
  ["pi-index", "/dist/portfolio-icons.html", null],
  ["pi-air", "/dist/portfolio-icons.html", async (p) => { await p.locator(".tile").nth(0).click(); }],
  ["pi-icon", "/dist/portfolio-icons.html", async (p) => { await p.locator(".item").nth(0).click(); }],
  ["pi-about", "/dist/portfolio-icons.html", async (p) => { await p.locator(".item").nth(6).click(); await p.waitForTimeout(1200); await p.locator(".zoom-stream").evaluate((el) => (el.scrollTop = el.scrollHeight)); }],
];
for (const scheme of ["light"]) for (const [name, url, act] of shots) {
  const p = await b.newPage({ viewport: { width: 430, height: 900 }, colorScheme: scheme, reducedMotion: "no-preference" });
  await p.goto("http://localhost:8765" + url);
  await p.waitForTimeout(500);
  if (act) { await act(p); await p.waitForTimeout(1500); }
  await p.screenshot({ path: `${dir}/${name}.png`, fullPage: !act });
  await p.close();
}
await b.close();
