import { test, expect, type Page } from "@playwright/test";

/**
 * Studio-side checks that do not need uploads: panels, script creation, templates.
 *
 * The editor has two shells: desktop shows the dock inline, mobile hides every
 * panel behind a bottom-nav drawer. Detection uses the viewport width, because
 * the left panel also has a "人物" tab on desktop.
 */
const isMobileShell = async (page: Page) => (page.viewportSize()?.width ?? 1440) < 1024;

/**
 * WebKit needs the editor shell to finish its first layout before Konva paints,
 * so every test waits for a canvas that actually has size. Retrying the whole
 * navigation is faster and more stable than raising the timeout further.
 */
async function openEditor(page: Page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto("/editor", { waitUntil: "domcontentloaded" });
    try {
      await page.waitForFunction(
        () => {
          const canvas = document.querySelector('[data-testid="canvas"] canvas');
          return !!canvas && (canvas as HTMLCanvasElement).width > 10;
        },
        { timeout: 25_000 },
      );
      return;
    } catch {
      if (attempt === 2) throw new Error("editor canvas did not paint");
      await page.waitForTimeout(1500);
    }
  }
}

/** number of elements currently persisted in the local draft */
async function draftElementCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const keys = Object.keys(localStorage).filter(
      (k) => k.startsWith("ms.draft.") && k !== "ms.draft.index",
    );
    if (keys.length === 0) return 0;
    const items = keys.map((k) => JSON.parse(localStorage.getItem(k) as string));
    const project = items.sort(
      (a: { savedAt: number }, b: { savedAt: number }) => b.savedAt - a.savedAt,
    )[0].project;
    return project.elements?.length ?? 0;
  });
}

async function addDemoCharacter(page: Page) {
  const before = await draftElementCount(page);
  if (await isMobileShell(page)) {
    await page.getByRole("button", { name: "人物", exact: true }).click();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "随机熟人" }).click();
    await page.getByRole("button", { name: "关闭" }).first().click();
  } else {
    await page.getByRole("button", { name: "随机熟人" }).click();
  }
  // the autosave writes the draft asynchronously; wait for the element to land
  await expect.poll(() => draftElementCount(page), { timeout: 25_000 }).toBeGreaterThan(before);
}

/**
 * Opens the bottom dock and selects a tab. Tab buttons carry a count badge, so
 * matching uses a prefix, but must not collide with the left panel's
 * "批量导入人物" button — that one lives outside the dock.
 */
async function openDockTab(page: Page, tab: string) {
  const mobile = await isMobileShell(page);
  const scope = mobile ? page.locator("div.fixed.inset-0.z-40") : page.locator("div.z-20.shrink-0");
  if (mobile && (await scope.count()) === 0) {
    await page.getByRole("button", { name: "互动", exact: true }).click();
    await page.waitForTimeout(400);
  }
  const target =
    tab === "批量"
      ? scope.getByRole("button", { name: "批量", exact: true })
      : scope.getByRole("button", { name: new RegExp(`^${tab}`) });
  await target.first().click();
  await page.waitForTimeout(300);
}

test.describe("studio panels", () => {
  test("script and its sibling panels are reachable", async ({ page }) => {
    await openEditor(page);
    const mobile = await isMobileShell(page);
    for (const tab of ["剧本", "互动", "图层", "模板"]) {
      await openDockTab(page, tab);
      const scope = mobile ? page.locator("div.fixed.inset-0.z-40") : page.locator("div.z-20.shrink-0");
      await expect(scope.getByRole("button", { name: new RegExp(`^${tab}`) }).first()).toBeVisible();
    }
  });

  test("creates a script from the cast and shows the play control", async ({ page }) => {
    await openEditor(page);
    await addDemoCharacter(page);

    await openDockTab(page, "剧本");
    const create = page.getByRole("button", { name: "创建剧本" });
    await expect(create).toBeVisible({ timeout: 20_000 });
    await create.click();
    await page.waitForTimeout(600);

    await expect(page.locator('[data-testid="script-cue"]').first()).toBeVisible();
    await page.getByRole("button", { name: "试演" }).click();
    await expect(page.getByTestId("performance-play")).toBeVisible({ timeout: 25_000 });
  });

  test("bulk panel lists the cast with voice counts", async ({ page }) => {
    await openEditor(page);
    await addDemoCharacter(page);

    await openDockTab(page, "批量");
    const rows = page.locator("tbody tr");
    await expect(rows.first()).toBeVisible({ timeout: 20_000 });
    expect(await rows.count()).toBeGreaterThanOrEqual(1);
    await expect(page.getByRole("button", { name: "全选" })).toBeVisible();
    await expect(page.getByLabel("互动配方")).toBeVisible();
  });

  test("templates list built-in stages and apply one", async ({ page }) => {
    await openEditor(page);
    await addDemoCharacter(page);

    await openDockTab(page, "模板");
    await expect(page.getByRole("button", { name: /群聊截图/ })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: /群聊截图/ }).click();
    await page.getByRole("button", { name: "套用到当前作品" }).click();
    await page.waitForTimeout(900);
    const size = await page.evaluate(() => {
      const keys = Object.keys(localStorage).filter(
        (k) => k.startsWith("ms.draft.") && k !== "ms.draft.index",
      );
      const items = keys.map((k) => JSON.parse(localStorage.getItem(k) as string));
      const p = items.sort(
        (a: { savedAt: number }, b: { savedAt: number }) => b.savedAt - a.savedAt,
      )[0].project;
      return { width: p.width, height: p.height };
    });
    expect(size).toEqual({ width: 900, height: 1600 });
  });
});
