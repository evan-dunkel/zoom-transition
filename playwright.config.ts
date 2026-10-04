import { defineConfig, devices } from "@playwright/test";

// Builds the Book Store demo (dist/) and the plain-HTML harness (test/scan.html) and
// serves the repo root; the tests drive them like a person would.
// Set PLAYWRIGHT_CHROMIUM_EXECUTABLE to use an already-installed Chromium instead of
// running `npx playwright install chromium`.
const PORT = 8765;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}/`,
    viewport: { width: 430, height: 900 },
    launchOptions: { executablePath },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 430, height: 900 } } },
    // WebKit as an iPhone (touch, mobile viewport). Closer to iOS Safari than Chromium,
    // though still not iOS's own compositing or browser toolbars: check those on a phone.
    // `npx playwright install webkit` once.
    // The specs that don't drive Chromium-only input (the wheel, DevTools touch).
    {
      name: "iphone-webkit",
      use: { ...devices["iPhone 15"], launchOptions: {} },
      testMatch: ["flight-invariants.spec.ts", "paging.spec.ts", "fixed-overlay.spec.ts", "standalone-portfolio*.spec.ts"],
    },
  ],
  webServer: {
    command: `npm run build:demo && npm run build:harness && npm run build:portfolio && python3 -m http.server ${PORT}`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
  },
});
