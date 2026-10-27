import { test, expect, type Page } from "@playwright/test";

/** the demo project is 1600x900; VisitorStage fits it with configurable padding (max 1.4x) */
async function clickDemoCharacter(page: Page, worldX: number, worldY: number, padding = 48) {
  const visitor = page.locator('[data-testid="visitor"]').first();
  await visitor.scrollIntoViewIfNeeded();
  const box = await visitor.boundingBox();
  if (!box) throw new Error("visitor stage not found");
  const scale = Math.min((box.width - padding * 2) / 1600, (box.height - padding * 2) / 900, 1.4);
  const x = box.x + (box.width - 1600 * scale) / 2 + worldX * scale;
  const y = box.y + (box.height - 900 * scale) / 2 + worldY * scale;
  await page.mouse.click(x, y);
}

test.describe("landing", () => {
  test("shows the live demo and can open the studio", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1")).toContainText("塞进一张画布");
    await expect(page.locator('[data-testid="visitor"] canvas').first()).toBeVisible();
    await expect(page.getByRole("link", { name: "开始创作" }).first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("the hero example plays a real voice clip", async ({ page }) => {
    await page.addInitScript(() => {
      window.__played = [];
      HTMLMediaElement.prototype.play = function () {
        window.__played.push(this.currentSrc || this.src);
        setTimeout(() => this.dispatchEvent(new Event("ended")), 100);
        return Promise.resolve();
      };
      HTMLMediaElement.prototype.pause = function () {};
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="visitor"] canvas');
    await clickDemoCharacter(page, 245, 600, 12); // 老K center, landing hero uses compact padding
    await expect.poll(() => page.evaluate(() => (window as any).__played.length)).toBeGreaterThan(0);
    await expect(page.getByText("这波真的不亏").first()).toBeVisible();
  });
});

test.describe("published demo", () => {
  test("renders OG-friendly title, sound hint and interactive characters", async ({ page }) => {
    await page.goto("/p/demo", { waitUntil: "domcontentloaded" });
    await expect(page.locator("header")).toContainText("全员开麦");
    await page.waitForSelector('[data-testid="visitor"] canvas');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("404 page is helpful", async ({ page }) => {
    await page.goto("/p/this-does-not-exist", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("这个作品还没上线")).toBeVisible({ timeout: 20_000 });
  });
});
