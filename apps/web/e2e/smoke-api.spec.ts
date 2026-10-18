import { test, expect } from '@playwright/test';

/**
 * Same flow as smoke.spec.ts but against the real API (VITE_USE_MOCK=false).
 * Requires the backend running on VITE_API_URL (default 127.0.0.1:3000; vite proxies /api).
 * Run: VITE_USE_MOCK=false pnpm exec playwright test e2e/smoke-api.spec.ts
 */
test.describe.configure({ mode: 'serial' });

test('login → book daily → cancel against live API', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel(/nik/i).fill('K1001');
  await page.getByLabel(/password/i).fill('demo1234');
  await page.getByRole('button', { name: /masuk/i }).click();
  await expect(page).toHaveURL(/\/(beranda|home|)$/);

  await page.getByRole('link', { name: /booking harian/i }).click();
  // tomorrow's date. Deviation from brief: Tanggal is a <select> (today..today+7), not a date input, so fill() cannot drive it.
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel(/tanggal/i).selectOption(tomorrow);
  await page.getByLabel(/shift/i).selectOption('malam');
  await page.getByLabel(/arah/i).selectOption('PICKUP');
  await page.getByLabel(/rute/i).selectOption('r2');
  await page.getByLabel(/titik jemput/i).selectOption('r2s1');
  await expect(page.getByText(/sisa kursi:\s*\d+\s*dari\s*50/i)).toBeVisible();
  await page.getByRole('button', { name: /pesan/i }).click();
  await expect(page.getByText(/booking berhasil/i)).toBeVisible();

  await page.getByRole('link', { name: /beranda/i }).click();
  // Deviation from brief: the ticket card puts date and route on separate rows, so one regex cannot span both; two hasText filters do.
  const card = page.locator('article').filter({ hasText: tomorrow }).filter({ hasText: /R2 Bekasi Timur/ });
  await expect(card).toHaveCount(1);
  await expect(card.getByText(/terbooked/i)).toBeVisible();

  // Deviation from brief: /riwayat (Terbooked) renders a table with no Batalkan button; cancel lives on the Beranda card (same as smoke.spec.ts).
  await card.getByRole('button', { name: /batalkan/i }).click();
  await expect(card.getByText(/dibatalkan/i)).toBeVisible();
});
