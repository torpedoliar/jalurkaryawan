import { expect, test } from "@playwright/test";

test("a route pin can be dragged, and a stop can be deleted and restored", async ({ page }) => {
  await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
  await page.goto("/");
  await page.getByLabel("NIK").fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("demo1234");
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Rute & Titik" }).click();
  await page.getByLabel("Lihat titik rute").selectOption("r1");
  await expect(page.getByRole("application", { name: "Peta titik jemput" })).toBeVisible();

  // The fixture starts unmapped, so give one stop a coordinate to drag.
  const firstStop = page.getByRole("row").filter({ hasText: "Terminal Cikarang" });
  await firstStop.getByRole("button", { name: "Ubah" }).click();
  await page.getByLabel("Latitude", { exact: true }).fill("-6.285");
  await page.getByLabel("Longitude", { exact: true }).fill("107.171");
  await page.getByRole("button", { name: "Simpan titik" }).click();
  await expect(page.locator(".map-pin")).toHaveCount(1);

  // Dragging a saved pin writes the new position through the normal PUT path.
  // Leaflet ignores a drag while fitBounds' zoom animation class is still on the icon.
  const first = page.locator(".leaflet-marker-icon").first();
  await expect(first).not.toHaveClass(/(^|\s)leaflet-zoom-anim($|\s)/);
  const box = (await first.boundingBox())!;
  const saved = page.waitForResponse((r) => r.url().includes("/api/routes/r1/stops/") && r.request().method() === "PUT");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 8 });
  await page.mouse.up();
  const response = await saved;
  expect(response.status()).toBe(200);
  const body = response.request().postDataJSON() as { lat: number; lng: number; name: string };
  expect(Number.isFinite(body.lat)).toBe(true);
  expect(Number.isFinite(body.lng)).toBe(true);
  expect(body.name.length).toBeGreaterThan(0);

  // A freshly created stop is unused, so it can be deleted with the two-step confirm.
  const stops = page.getByRole("table", { name: "Titik jemput" });
  await page.getByLabel("Nama titik").fill("Halte Uji");
  await page.getByLabel("Urutan", { exact: true }).fill("9");
  await page.getByLabel("Menit dari berangkat", { exact: true }).fill("60");
  await page.getByRole("button", { name: "Simpan titik" }).click();
  const row = stops.getByRole("row").filter({ hasText: "Halte Uji" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Hapus" }).click();
  await row.getByRole("button", { name: "Ya, hapus" }).click();
  await expect(stops.getByText("Halte Uji")).toHaveCount(0);
  await expect(page.getByText("1 titik nonaktif disembunyikan.")).toBeVisible();

  // Deletion is a deactivation: the point comes back when inactive points are shown.
  await page.getByLabel("Tampilkan nonaktif").check();
  const grey = stops.getByRole("row").filter({ hasText: "Halte Uji" });
  await expect(grey.getByText("Tidak")).toBeVisible();
  await grey.getByRole("button", { name: "Aktifkan" }).click();
  await expect(page.getByText("1 titik nonaktif disembunyikan.")).toHaveCount(0);
});
