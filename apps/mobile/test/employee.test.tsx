import { describe, expect, jest, test } from "@jest/globals";
import { fireEvent, screen, within } from "@testing-library/react-native";
import { addDays, ERROR_MESSAGES } from "@bms/shared";
import { getDb, resetDb } from "@bms/mock-api";
import { renderApp } from "./render";

const TODAY = "2026-10-14";
const TOMORROW = addDays(TODAY, 1);

async function choose(label: string, value: string) {
  await fireEvent.press(screen.getByLabelText(value));
}

describe("employee", () => {
  test("lands on Beranda with the next 7 days of bookings", async () => {
    await renderApp("beranda", "K1001");
    expect(await screen.findByRole("header", { name: "Beranda" })).toBeTruthy();
    const cards = await screen.findAllByRole("summary");
    expect(cards.length).toBe(14);
    expect(screen.getAllByText(/R1 Cikarang/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Terminal Cikarang/).length).toBeGreaterThan(0);
  });

  test("cancel button hidden once cutoff has passed", async () => {
    jest.setSystemTime(new Date(`${TODAY}T04:00:00+07:00`)); // today's 05:20 pickup cutoff was 03:20
    await renderApp("beranda", "K1001");
    await screen.findAllByRole("summary");
    expect(screen.queryAllByText("Batalkan").length).toBe(13);
    expect(screen.getAllByText("Batas batal lewat").length).toBe(1);
  });

  test("daily booking shows seats left, books, and appears on Beranda; then cancel", async () => {
    await renderApp("booking", "K1001");
    await screen.findByRole("header", { name: "Booking Harian" });
    await choose("Tanggal", TOMORROW);
    await choose("Shift", "siang");
    await choose("Arah", "PICKUP");
    await choose("Rute", "r2");
    await choose("Titik jemput", "r2s1");
    expect(await screen.findByText(/Sisa kursi: \d+ dari 50/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Pesan" }));
    expect(await screen.findByText(/Booking berhasil/)).toBeTruthy();

    await fireEvent.press(screen.getByRole("button", { name: "Beranda" }));
    await screen.findAllByRole("summary");
    expect(screen.getAllByText(/R2 Bekasi Timur/).length).toBeGreaterThan(0);
  });

  test("booking error from server is shown verbatim (already booked pagi pickup)", async () => {
    await renderApp("booking", "K1001");
    await screen.findByRole("header", { name: "Booking Harian" });
    await choose("Tanggal", TOMORROW);
    await choose("Shift", "pagi");
    await choose("Arah", "PICKUP");
    await choose("Rute", "r2");
    await choose("Titik jemput", "r2s1");
    await fireEvent.press(screen.getByRole("button", { name: "Pesan" }));
    expect(await screen.findByText("Kamu sudah punya booking di tanggal, shift, dan arah yang sama.")).toBeTruthy();
    expect(getDb().bookings.filter((b) => b.source === "DAILY")).toHaveLength(0);
  });

  // Review Focus 4
  test("suspended employee sees the banner and cannot submit a booking", async () => {
    await renderApp("booking", "K1059");
    expect(await screen.findByText(`Booking kamu dibekukan sampai ${addDays(TODAY, 3)}. Alasan: No-show 3x dalam 30 hari`)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pesan" }).props.accessibilityState?.disabled).toBe(true);
  });

  test("ending a subscription needs a confirmation", async () => {
    await renderApp("langganan", "K1001");
    await screen.findByRole("header", { name: "Langganan" });
    await choose("Shift", "siang");
    await choose("Arah", "DROPOFF");
    await choose("Rute", "r3");
    await choose("Titik jemput", "r3s2");
    await fireEvent.press(screen.getByText("Buat langganan"));
    expect(await screen.findByText(/Terbooked 8 tanggal/)).toBeTruthy();

    await fireEvent.press(screen.getByText("Buat langganan"));
    expect(await screen.findByText("Langganan bentrok dengan langganan lain di shift dan arah yang sama.")).toBeTruthy();

    // K1001 also has seeded R1 subscriptions with their own Akhiri; act on the new R3 card only.
    const card = (await screen.findAllByRole("summary")).find((c) => within(c).queryByText(/^R3 /))!;
    await fireEvent.press(within(card).getByText("Akhiri"));
    expect(within(card).queryByText(/Berakhir/)).toBeNull();
    await fireEvent.press(within(card).getByText("Ya, akhiri"));
    expect(await within(card).findByText(/Berakhir/)).toBeTruthy();
  });

  // Review Focus: spec 5.4 wants the server's TRIP_FULL/CUTOFF_PASSED message to surface, not a dead button.
  test("a full trip reports TRIP_FULL verbatim (submit stays enabled)", async () => {
    await renderApp("booking", "K1061");
    await screen.findByRole("header", { name: "Booking Harian" });
    await choose("Tanggal", TOMORROW);
    await choose("Shift", "pagi");
    await choose("Arah", "PICKUP");
    await choose("Rute", "r1");
    await choose("Titik jemput", "r1s1");
    await fireEvent.press(screen.getByRole("button", { name: "Pesan" }));
    expect(await screen.findByText(ERROR_MESSAGES.TRIP_FULL)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pesan" }).props.accessibilityState?.disabled).toBe(false);
  });

  test("a past-cutoff trip reports CUTOFF_PASSED verbatim", async () => {
    const at = () => new Date(`${TODAY}T03:30:00+07:00`);
    resetDb(at);
    jest.setSystemTime(at());
    await renderApp("booking", "K1061");
    await screen.findByRole("header", { name: "Booking Harian" });
    await choose("Tanggal", TODAY);
    await choose("Shift", "pagi");
    await choose("Arah", "PICKUP");
    await choose("Rute", "r2");
    await choose("Titik jemput", "r2s1");
    await fireEvent.press(screen.getByRole("button", { name: "Pesan" }));
    expect(await screen.findByText(ERROR_MESSAGES.CUTOFF_PASSED)).toBeTruthy();
  });

  test("history lists bookings newest first; notifications mark as read", async () => {
    const db = getDb();
    const u = db.users.find((x) => x.nik === "K1001")!;
    db.notifications.push({ id: "n-test", userId: u.id, type: "TRIP_CANCELLED", title: "Trip dibatalkan", body: "R1 pagi dibatalkan.", data: {}, readAt: null, createdAt: `${TODAY}T00:00:00+07:00` });
    await renderApp("riwayat", "K1001");
    const rows = await screen.findAllByRole("row");
    expect(within(rows[0]!).getByText(addDays(TODAY, 7), { exact: false })).toBeTruthy();

    await fireEvent.press(screen.getByRole("button", { name: "Notifikasi" }));
    await fireEvent.press(await screen.findByText("Tandai dibaca"));
    expect(await screen.findByText("Dibaca")).toBeTruthy();
    expect(db.notifications.find((n) => n.id === "n-test")!.readAt).not.toBeNull();
  });

  test("departure board highlights the employee's own trips and labels status", async () => {
    await renderApp("keberangkatan", "K1001");
    await screen.findByRole("header", { name: "Keberangkatan" });
    const mine = await screen.findAllByRole("selected");
    expect(mine.length).toBeGreaterThan(0);
    expect(screen.getAllByText("TERSEDIA").length).toBeGreaterThan(0);
  });

  test("empty states on the employee screens", async () => {
    const db = getDb();
    db.bookings.length = 0;
    db.subscriptions.length = 0;
    db.notifications.length = 0;
    await renderApp("beranda", "K1001");
    expect(await screen.findByText("Belum ada booking 7 hari ke depan.")).toBeTruthy();

    await fireEvent.press(screen.getByRole("button", { name: "Langganan" }));
    expect(await screen.findByText("Belum ada langganan.")).toBeTruthy();

    await fireEvent.press(screen.getByRole("button", { name: "Riwayat" }));
    expect(await screen.findByText("Belum ada riwayat booking.")).toBeTruthy();

    await fireEvent.press(screen.getByRole("button", { name: "Notifikasi" }));
    expect(await screen.findByText("Belum ada notifikasi.")).toBeTruthy();
  });
});