import { describe, expect, test, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { addDays, ERROR_MESSAGES } from "@bms/shared";
import { getDb, resetDb } from "@bms/mock-api";
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

  test("admin can book, cancel and see the booking in history", async () => {
    const { user } = await renderApp("/booking", "admin");
    await user.selectOptions(await screen.findByLabelText("Tanggal"), TOMORROW);
    await user.selectOptions(screen.getByLabelText("Shift"), "siang");
    await user.selectOptions(screen.getByLabelText("Arah"), "PICKUP");
    await user.selectOptions(screen.getByLabelText("Rute"), "r2");
    await user.selectOptions(await screen.findByLabelText("Titik jemput"), "r2s1");
    await user.click(screen.getByRole("button", { name: "Pesan" }));
    expect(await screen.findByText(/Booking berhasil/)).toBeTruthy();

    await user.click(screen.getByRole("link", { name: "Beranda" }));
    const card = (await screen.findAllByRole("article")).find((a) => within(a).queryByText(/R2 Bekasi Timur/))!;
    await user.click(within(card).getByRole("button", { name: "Batalkan" }));
    expect(await within(card).findByText("Dibatalkan")).toBeTruthy();

    await user.click(screen.getByRole("link", { name: "Riwayat" }));
    const row = (await screen.findAllByRole("row")).find((r) => within(r).queryByText(/R2/))!;
    expect(within(row).getByText("Dibatalkan")).toBeTruthy();
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

  test("ending a subscription needs a confirmation", async () => {
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
    // Ending a subscription is irreversible and cancels every future booking in it, so it arms first.
    await user.click(within(row).getByRole("button", { name: "Akhiri" }));
    expect(within(row).queryByText("Berakhir")).toBeNull();
    await user.click(within(row).getByRole("button", { name: "Ya, akhiri" }));
    expect(await within(row).findByText("Berakhir")).toBeTruthy();
  });

  // Review Focus: spec 5.4 wants the server's TRIP_FULL/CUTOFF_PASSED message to surface, not a dead button.
  test("a full trip reports TRIP_FULL verbatim (submit stays enabled)", async () => {
    // K1061 books siang/r1, so it has no pagi/r1 booking tomorrow; r1 pagi pickup is 8/8 full after seeding.
    const { user } = await renderApp("/booking", "K1061");
    await user.selectOptions(await screen.findByLabelText("Tanggal"), TOMORROW);
    await user.selectOptions(screen.getByLabelText("Shift"), "pagi");
    await user.selectOptions(screen.getByLabelText("Arah"), "PICKUP");
    await user.selectOptions(screen.getByLabelText("Rute"), "r1");
    await user.selectOptions(await screen.findByLabelText("Titik jemput"), "r1s1");
    await user.click(screen.getByRole("button", { name: "Pesan" }));
    expect((await screen.findByRole("alert")).textContent).toBe(ERROR_MESSAGES.TRIP_FULL);
    expect((screen.getByRole("button", { name: "Pesan" }) as HTMLButtonElement).disabled).toBe(false);
  });

  test("a past-cutoff trip reports CUTOFF_PASSED verbatim", async () => {
    // Server clock at 03:30 today: today's r2 pagi pickup (departs 05:25) is past its 03:25 cutoff but not full (10/50).
    // resetDb is the only way to move the server clock; the client clock follows via setSystemTime.
    const at = () => new Date(`${TODAY}T03:30:00+07:00`);
    resetDb(at);
    vi.setSystemTime(at());
    const { user } = await renderApp("/booking", "K1061"); // K1061 books siang/r1, so no pagi/r2 booking today
    await user.selectOptions(await screen.findByLabelText("Tanggal"), TODAY);
    await user.selectOptions(screen.getByLabelText("Shift"), "pagi");
    await user.selectOptions(screen.getByLabelText("Arah"), "PICKUP");
    await user.selectOptions(screen.getByLabelText("Rute"), "r2");
    await user.selectOptions(await screen.findByLabelText("Titik jemput"), "r2s1");
    await user.click(screen.getByRole("button", { name: "Pesan" }));
    expect((await screen.findByRole("alert")).textContent).toBe(ERROR_MESSAGES.CUTOFF_PASSED);
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

  test("empty states on the employee screens", async () => {
    // A fresh employee with no bookings, subscriptions or notifications renders each screen's empty line, not a blank grid.
    const db = getDb();
    const u = db.users.find((x) => x.nik === "K1001")!;
    db.bookings.length = 0;
    db.subscriptions.length = 0;
    db.notifications.length = 0;
    const { user } = await renderApp("/beranda", "K1001");
    expect(await screen.findByText("Belum ada booking 7 hari ke depan.")).toBeTruthy();

    await user.click(screen.getByRole("link", { name: "Langganan" }));
    expect(await screen.findByText("Belum ada langganan.")).toBeTruthy();

    await user.click(screen.getByRole("link", { name: "Riwayat" }));
    expect(await screen.findByText("Belum ada riwayat booking.")).toBeTruthy();

    await user.click(screen.getByRole("link", { name: "Notifikasi" }));
    expect(await screen.findByText("Belum ada notifikasi.")).toBeTruthy();
  });
});
