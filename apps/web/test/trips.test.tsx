import { afterEach, describe, expect, test, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { read, utils as sheetUtils } from "xlsx";
import { getDb } from "@bms/mock-api";
import { renderApp } from "./render";

const row = (name: RegExp) => screen.getByRole("row", { name });
const R1_PAGI = /^05:20 R1 Pagi Jemput/;

afterEach(() => vi.restoreAllMocks());

describe("trip harian", () => {
  test("lists today's trips and filters by route", async () => {
    const { user } = await renderApp("/trip", "ga");
    const table = (await screen.findByText("Daftar trip")).closest("table")!;
    await screen.findByRole("row", { name: R1_PAGI });
    expect(row(R1_PAGI).textContent).toContain("8/8");
    expect(within(table).getAllByRole("row")).toHaveLength(37);
    await user.selectOptions(screen.getByLabelText("Rute"), "r1");
    await screen.findByText("6 trip");
    expect(within(table).getAllByRole("row")).toHaveLength(7);
  });

  test("change bus updates capacity", async () => {
    const { user } = await renderApp("/trip", "ga");
    await screen.findByRole("row", { name: R1_PAGI });
    await user.click(within(row(R1_PAGI)).getByRole("button", { name: "Ganti bus" }));
    await user.selectOptions(screen.getByLabelText("Bus baru"), "b7");
    await user.click(screen.getByRole("button", { name: "Simpan bus" }));
    await screen.findByRole("row", { name: /^05:20 R1 Pagi Jemput B 7401 FX 8\/11/ });
    const trip = getDb().trips.find((t) => t.routeId === "r1" && t.date === "2026-10-14" && t.departureAt.endsWith("05:20:00+07:00"))!;
    expect(trip).toMatchObject({ busId: "b7", capacity: 11 });
  });

  test("smaller bus than bookings shows the server message", async () => {
    const { user } = await renderApp("/trip", "ga");
    const r2 = /^05:25 R2 Pagi Jemput/;
    await screen.findByRole("row", { name: r2 });
    await user.click(within(row(r2)).getByRole("button", { name: "Ganti bus" }));
    await user.selectOptions(screen.getByLabelText("Bus baru"), "b1");
    await user.click(screen.getByRole("button", { name: "Simpan bus" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Bus B 7101 FX hanya 8 kursi, sudah 10 booking.");
  });

  test("cancel one trip needs confirmation and cancels its bookings", async () => {
    const { user } = await renderApp("/trip", "ga");
    await screen.findByRole("row", { name: R1_PAGI });
    await user.click(within(row(R1_PAGI)).getByRole("button", { name: "Batalkan" }));
    expect(getDb().trips.some((t) => t.status === "CANCELLED")).toBe(false);
    await user.click(within(row(R1_PAGI)).getByRole("button", { name: "Ya, batalkan" }));
    await screen.findByRole("row", { name: /^05:20 R1 Pagi Jemput .*Dibatalkan/ });
    const trip = getDb().trips.find((t) => t.status === "CANCELLED")!;
    expect(getDb().bookings.filter((b) => b.tripId === trip.id).every((b) => b.status === "CANCELLED")).toBe(true);
  });

  test("cancel every trip of a date", async () => {
    const { user } = await renderApp("/trip", "ga");
    fireEvent.change(await screen.findByLabelText("Tanggal"), { target: { value: "2026-10-15" } });
    await screen.findByRole("row", { name: R1_PAGI });
    await user.click(screen.getByRole("button", { name: "Batalkan semua trip 2026-10-15 (semua rute & shift)" }));
    await user.click(screen.getByRole("button", { name: "Ya, batalkan semua trip 2026-10-15 (semua rute & shift)" }));
    expect((await screen.findByRole("status")).textContent).toBe("36 trip dibatalkan.");
    const day = getDb().trips.filter((t) => t.date === "2026-10-15");
    expect(day.every((t) => t.status === "CANCELLED")).toBe(true);
    expect(getDb().trips.filter((t) => t.date === "2026-10-14").every((t) => t.status === "SCHEDULED")).toBe(true);
  });

  test("passenger list and Excel export", async () => {
    const saved: string[] = [];
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => { blobs.push(b); return "blob:x"; });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { saved.push(this.download); });

    const { user } = await renderApp("/trip", "ga");
    await screen.findByRole("row", { name: R1_PAGI });
    await user.click(within(row(R1_PAGI)).getByRole("button", { name: "Penumpang" }));
    const list = (await screen.findByText(/^Penumpang R1/)).closest("table")!;
    expect(within(list).getAllByRole("row")).toHaveLength(9);
    expect(within(list).getAllByRole("cell", { name: "Terminal Cikarang" }).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Export Excel" }));
    expect(saved).toEqual(["penumpang-R1-2026-10-14-0520.xlsx"]);
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));

    // Read the actual bytes back: a file that opens as garbage would otherwise ship silently.
    // jsdom 25 has no Blob.arrayBuffer(); FileReader is the path that works here (ui.tsx's fileBytes proves it).
    const wb = await new Promise<ReturnType<typeof read>>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(read(new Uint8Array(fr.result as ArrayBuffer)));
      fr.onerror = () => reject(fr.error);
      fr.readAsArrayBuffer(blobs[0]!);
    });
    expect(wb.SheetNames).toEqual(["Data"]);
    const rows = sheetUtils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]!]!);
    // 8 booked seats on this trip (8/8); the header row is the sheet's first row, not a data row here.
    expect(rows).toHaveLength(8);
    expect(Object.keys(rows[0]!)).toEqual(["Jam", "Titik", "NIK", "Nama", "Departemen", "No HP"]);
    // Derive the expected row from the trip's actual first non-cancelled booking, not a hard-coded seed name.
    const db = getDb();
    const trip = db.trips.find((t) => t.routeId === "r1" && t.date === "2026-10-14" && t.departureAt.endsWith("05:20:00+07:00"))!;
    const booking = db.bookings.find((b) => b.tripId === trip.id && b.status !== "CANCELLED")!;
    const passenger = db.users.find((u) => u.id === booking.userId)!;
    const stop = db.stops.find((s) => s.id === booking.stopId)!;
    const match = rows.find((r) => r.NIK === passenger.nik);
    expect(match).toMatchObject({ Nama: passenger.name, Departemen: passenger.department, "No HP": passenger.phone, Titik: stop.name });
  });

  test("cancelling a trip closes its manifest", async () => {
    const { user } = await renderApp("/trip", "ga");
    await screen.findByRole("row", { name: R1_PAGI });
    await user.click(within(row(R1_PAGI)).getByRole("button", { name: "Penumpang" }));
    expect(await screen.findByText(/^Penumpang R1/)).toBeTruthy();

    // A cancelled trip's manifest is stale, and its useLoad dep (trip.id) never changes to re-fetch.
    await user.click(within(row(R1_PAGI)).getByRole("button", { name: "Batalkan" }));
    await user.click(within(row(R1_PAGI)).getByRole("button", { name: "Ya, batalkan" }));
    await screen.findByRole("row", { name: /^05:20 R1 Pagi Jemput .*Dibatalkan/ });
    expect(screen.queryByText(/^Penumpang R1/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Export Excel" })).toBeNull();
  });

  test("changing the date closes the bus-change dialog", async () => {
    const { user } = await renderApp("/trip", "ga");
    await screen.findByRole("row", { name: R1_PAGI });
    await user.click(within(row(R1_PAGI)).getByRole("button", { name: "Ganti bus" }));
    expect(screen.getByLabelText("Bus baru")).toBeTruthy();

    // The dialog belongs to a trip on the previous date; the table would show the new one.
    fireEvent.change(screen.getByLabelText("Tanggal"), { target: { value: "2026-10-15" } });
    await screen.findByRole("row", { name: R1_PAGI });
    expect(screen.queryByLabelText("Bus baru")).toBeNull();
  });

  test("changing the route or shift filter closes the bus panel and the row confirm", async () => {
    const { user } = await renderApp("/trip", "ga");
    await screen.findByRole("row", { name: R1_PAGI });
    await user.click(within(row(R1_PAGI)).getByRole("button", { name: "Ganti bus" }));
    expect(screen.getByLabelText("Bus baru")).toBeTruthy();

    // The panel is bound to a trip id; a filter change drops that row, so the panel must go with it.
    await user.selectOptions(screen.getByLabelText("Rute"), "r2");
    await screen.findByText("6 trip");
    expect(screen.queryByLabelText("Bus baru")).toBeNull();

    const r2 = /^05:25 R2 Pagi Jemput/;
    await user.click(within(row(r2)).getByRole("button", { name: "Batalkan" }));
    expect(within(row(r2)).getByRole("button", { name: "Ya, batalkan" })).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Shift"), "siang");
    await screen.findByText("2 trip");
    expect(screen.queryByRole("button", { name: "Ya, batalkan" })).toBeNull();
    expect(getDb().trips.some((t) => t.status === "CANCELLED")).toBe(false);
  });

  test("the date-wide cancel button names every route and shift", async () => {
    const { user } = await renderApp("/trip", "ga");
    await screen.findByRole("row", { name: R1_PAGI });
    fireEvent.change(screen.getByLabelText("Tanggal"), { target: { value: "2026-10-15" } });
    // The request carries only the date, so the label has to say it hits every route and shift.
    expect(await screen.findByRole("button", { name: /Batalkan semua trip 2026-10-15 \(semua rute & shift\)/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Batalkan semua trip 2026-10-15 (semua rute & shift)" }));
    expect((await screen.findByRole("button", { name: /Ya, batalkan semua trip 2026-10-15 \(semua rute & shift\)/ })).textContent).toContain("semua rute & shift");
    expect(getDb().trips.some((t) => t.status === "CANCELLED")).toBe(false);
  });

  test("the bus panel names the trip it belongs to", async () => {
    const { user } = await renderApp("/trip", "ga");
    await screen.findByRole("row", { name: R1_PAGI });
    await user.click(within(row(R1_PAGI)).getByRole("button", { name: "Ganti bus" }));
    // A filter or a reload can leave the trip off the list; the panel must still say which one it edits.
    expect(screen.getByText("R1 Pagi Jemput 05:20")).toBeTruthy();
  });

  test("a departed trip offers no change or cancel", async () => {
    // No seed trip is departed (clock is midnight WIB, every trip still future). Move the clock past the
    // 05:20 departures instead of editing a trip, so the row (and its date) stays intact.
    vi.setSystemTime(new Date("2026-10-14T06:00:00+07:00"));
    await renderApp("/trip", "ga");
    await screen.findByRole("row", { name: R1_PAGI });
    expect(within(row(R1_PAGI)).queryByRole("button", { name: "Ganti bus" })).toBeNull();
    expect(within(row(R1_PAGI)).queryByRole("button", { name: "Batalkan" })).toBeNull();
    // The manifest stays reachable: reading a departed trip's passengers is legitimate.
    expect(within(row(R1_PAGI)).getByRole("button", { name: "Penumpang" })).toBeTruthy();
    vi.setSystemTime(new Date("2026-10-14T00:00:00+07:00"));
  });
});
