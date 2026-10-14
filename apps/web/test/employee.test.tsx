import { describe, expect, test, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { addDays } from "@bms/shared";
import { getDb } from "@bms/mock-api";
import { renderApp } from "./render";

const TODAY = "2026-10-14";
const TOMORROW = addDays(TODAY, 1);

describe("employee", () => {
  test("lands on Beranda with the next 7 days of bookings", async () => {
    await renderApp("/", "K1001");
    expect(await screen.findByRole("heading", { name: "Beranda" })).toBeTruthy();
    const cards = await screen.findAllByRole("article");
    expect(cards.length).toBe(14); // pagi PICKUP + DROPOFF for 7 days
    expect(within(cards[0]!).getByText(/R1 Cikarang/)).toBeTruthy();
    expect(within(cards[0]!).getByText(/Terminal Cikarang/)).toBeTruthy();
  });

  test("cancel button hidden once cutoff has passed", async () => {
    vi.setSystemTime(new Date(`${TODAY}T04:00:00+07:00`)); // today's 05:20 pickup cutoff was 03:20
    await renderApp("/beranda", "K1001");
    const [first, second] = await screen.findAllByRole("article");
    expect(within(first!).queryByRole("button", { name: "Batalkan" })).toBeNull();
    expect(within(first!).getByText("Batas batal lewat")).toBeTruthy();
    expect(within(second!).getByRole("button", { name: "Batalkan" })).toBeTruthy();
  });

  test("daily booking shows seats left, books, and appears on Beranda; then cancel", async () => {
    const { user } = await renderApp("/booking", "K1001");
    await user.selectOptions(await screen.findByLabelText("Tanggal"), TOMORROW);
    await user.selectOptions(screen.getByLabelText("Shift"), "siang");
    await user.selectOptions(screen.getByLabelText("Arah"), "PICKUP");
    await user.selectOptions(screen.getByLabelText("Rute"), "r2");
    await user.selectOptions(await screen.findByLabelText("Titik jemput"), "r2s1");
    expect(await screen.findByText(/Sisa kursi: \d+ dari 50/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Pesan" }));
    expect(await screen.findByText(/Booking berhasil/)).toBeTruthy();

    await user.click(screen.getByRole("link", { name: "Beranda" }));
    const card = (await screen.findAllByRole("article")).find((a) => within(a).queryByText(/R2 Bekasi Timur/))!;
    await user.click(within(card).getByRole("button", { name: "Batalkan" }));
    expect(await within(card).findByText("Dibatalkan")).toBeTruthy();
  });

  test("booking error from server is shown verbatim (already booked pagi pickup)", async () => {
    const { user } = await renderApp("/booking", "K1001");
    await user.selectOptions(await screen.findByLabelText("Tanggal"), TOMORROW);
    await user.selectOptions(screen.getByLabelText("Shift"), "pagi");
    await user.selectOptions(screen.getByLabelText("Arah"), "PICKUP");
    await user.selectOptions(screen.getByLabelText("Rute"), "r2");
    await user.selectOptions(await screen.findByLabelText("Titik jemput"), "r2s1");
    await user.click(screen.getByRole("button", { name: "Pesan" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Kamu sudah punya booking di tanggal, shift, dan arah yang sama.");
    expect(getDb().bookings.filter((b) => b.source === "DAILY")).toHaveLength(0);
  });

  // Review Focus 4
  test("suspended employee sees the banner and cannot submit a booking", async () => {
    await renderApp("/booking", "K1059");
    expect((await screen.findByRole("status")).textContent).toBe(
      `Booking kamu dibekukan sampai ${addDays(TODAY, 3)}. Alasan: No-show 3x dalam 30 hari`);
    expect((screen.getByRole("button", { name: "Pesan" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("subscriptions: create reports booked dates, overlap error verbatim, end", async () => {
    const { user } = await renderApp("/langganan", "K1001");
    await user.selectOptions(await screen.findByLabelText("Shift"), "siang");
    await user.selectOptions(screen.getByLabelText("Arah"), "DROPOFF");
    await user.selectOptions(screen.getByLabelText("Rute"), "r3");
    await user.selectOptions(await screen.findByLabelText("Titik jemput"), "r3s2");
    await user.click(screen.getByRole("button", { name: "Buat langganan" }));
    expect(await screen.findByText(/Terbooked 8 tanggal/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Buat langganan" })); // same again overlaps
    expect((await screen.findByRole("alert")).textContent).toBe("Langganan bentrok dengan langganan lain di shift dan arah yang sama.");

    const row = (await screen.findAllByRole("row")).find((r) => within(r).queryByText(/R3/))!;
    await user.click(within(row).getByRole("button", { name: "Akhiri" }));
    expect(await within(row).findByText("Berakhir")).toBeTruthy();
  });

  test("history lists bookings newest first; notifications mark as read", async () => {
    const db = getDb();
    const u = db.users.find((x) => x.nik === "K1001")!;
    db.notifications.push({ id: "n-test", userId: u.id, type: "TRIP_CANCELLED", title: "Trip dibatalkan", body: "R1 pagi dibatalkan.", data: {}, readAt: null, createdAt: `${TODAY}T00:00:00+07:00` });
    const { user } = await renderApp("/riwayat", "K1001");
    const rows = (await screen.findAllByRole("row")).slice(1);
    expect(within(rows[0]!).getByText(addDays(TODAY, 7))).toBeTruthy();

    await user.click(screen.getByRole("link", { name: "Notifikasi" }));
    await user.click(await screen.findByRole("button", { name: "Tandai dibaca" }));
    expect(await screen.findByText("Dibaca")).toBeTruthy();
    expect(db.notifications.find((n) => n.id === "n-test")!.readAt).not.toBeNull();
  });
});
