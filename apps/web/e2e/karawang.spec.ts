import { expect, test } from "@playwright/test";

test("sidebar groups are bold colored blocks", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("NIK").fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("demo1234");
  await page.getByRole("button", { name: "Masuk" }).click();
  const title = page.locator('.nav-group[data-group="Operasional"] .nav-label');
  await expect(title).toBeVisible();
  const visual = await title.evaluate((el) => {
    const style = getComputedStyle(el);
    return { weight: Number(style.fontWeight), border: style.borderLeftWidth, background: style.backgroundColor };
  });
  expect(visual.weight).toBeGreaterThanOrEqual(700);
  expect(visual.border).toBe("4px");
  expect(visual.background).not.toBe("rgba(0, 0, 0, 0)");
});
