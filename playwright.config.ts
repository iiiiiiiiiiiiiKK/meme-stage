import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.BASE_URL ?? "https://meme-stage.pages.dev";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    // Chromium-based mobile emulation: the local network intercepts TLS for WebKit.
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    // Real Safari engine (iPhone 13 viewport). ignoreHTTPSErrors is only for the
    // sandbox proxy between this machine and playwright.dev/CDN certificates.
    {
      name: "safari",
      retries: 1,
      use: { ...devices["iPhone 13"], ignoreHTTPSErrors: true },
    },
  ],
});
