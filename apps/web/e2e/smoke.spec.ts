import { expect, test } from "@playwright/test";
import { addDays, jakartaDate } from "@bms/shared";

const NIK = "K1001";
const PASSWORD = "demo1234";
// Book's option list is today()..today()+7, so pick tomorrow from the browser's clock rather than a fixed date.
const DATE = addDays(jakartaDate(new Date()), 1);

test("login, daily booking, then cancel", async ({ page }) => {
  // 1. Login
  await page.goto("/");
  await page.getByLabel("NIK").fill(NIK);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Masuk" }).click();

  // A role's first visible page is its landing page (pages.tsx), so a successful login lands on Beranda.
  await expect(page.getByRole("heading", { name: "Beranda" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Pengaturan" })).toHaveCount(0);

  // 2. Daily booking
  await page.getByRole("link", { name: "Booking Harian" }).click();
  await expect(page.getByRole("heading", { name: "Booking Harian" })).toBeVisible();
  await page.getByLabel("Tanggal").selectOption(DATE);
  // Shift's option label carries a time suffix (`Malam (23:00-07:00)`), and selectOption's label match is whole-string, so select by id.
  // Malam PICKUP departs 21:25, the latest cutoff of the day, so the "Batalkan" button below is present whenever this runs.
  await page.getByLabel("Shift").selectOption("malam");
  await page.getByLabel("Arah").selectOption({ label: "Jemput" });
  await page.getByLabel("Rute").selectOption({ label: "R2 Bekasi Timur" });
  // Titik jemput only appears once a route is chosen.
  await page.getByLabel("Titik jemput").selectOption({ label: "1. Halte Bulak Kapal" });

  await expect(page.getByText(/Sisa kursi: \d+ dari 50/)).toBeVisible();
  await page.getByRole("button", { name: "Pesan" }).click();
  // The success line renders booked.routeCode, which is "R2", not the route name.
  await expect(page.getByText(/^Booking berhasil: R2 Halte Bulak Kapal,/)).toBeVisible();

  // 3. The new booking is on Beranda, and cancelling flips its status
  await page.getByRole("link", { name: "Beranda" }).click();
  const card = page.locator("article").filter({ hasText: DATE }).filter({ hasText: "Jemput · R2 Bekasi Timur" });
  await expect(card).toHaveCount(1);
  await expect(card.getByText("Terbooked")).toBeVisible();
  await card.getByRole("button", { name: "Batalkan" }).click();
  await expect(card.getByText("Dibatalkan")).toBeVisible();
  await expect(card.getByRole("button", { name: "Batalkan" })).toHaveCount(0);
});
