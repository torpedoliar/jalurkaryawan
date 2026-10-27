import { expect, test } from "@playwright/test";

test("admin map, QR and tracking screens work in a real browser", async ({ page }) => {
  // Keep the smoke independent of a third-party tile provider's availability.
  await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
  await page.goto("/");
  await page.getByLabel("NIK").fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("demo1234");
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Rute & Titik" }).click();
  await page.getByLabel("Lihat titik rute").selectOption("r1");
  await expect(page.getByRole("application", { name: "Peta titik jemput" })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "Terminal Cikarang" });
  await row.getByRole("button", { name: "Ubah" }).click();
  await page.getByLabel("Latitude", { exact: true }).fill("-6.285");
  await page.getByLabel("Longitude", { exact: true }).fill("107.171");
  await page.getByRole("button", { name: "Simpan titik" }).click();
  await expect(row).toContainText("Di peta");
  await expect(page.locator(".map-pin")).toHaveCount(1);

  await page.getByRole("link", { name: "Vendor & Bus" }).click();
  await page.getByRole("row").filter({ hasText: "B 7101 FX" }).getByRole("button", { name: "QR", exact: true }).click();
  await expect(page.getByRole("img", { name: "QR check-in bus B 7101 FX" })).toBeVisible();
  await page.getByRole("link", { name: "Tracking Bus" }).click();
  await expect(page.getByRole("application", { name: "Peta tracking bus" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Posisi armada" })).toBeVisible();
  await expect(page.getByText("Belum ada lokasi", { exact: true }).first()).toBeVisible();
});
