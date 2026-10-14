import { afterEach, describe, expect, test, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
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
    await user.click(screen.getByRole("button", { name: "Batalkan semua trip tanggal ini" }));
    await user.click(screen.getByRole("button", { name: "Ya, batalkan semua trip 2026-10-15" }));
    expect((await screen.findByRole("status")).textContent).toBe("36 trip dibatalkan.");
    const day = getDb().trips.filter((t) => t.date === "2026-10-15");
    expect(day.every((t) => t.status === "CANCELLED")).toBe(true);
    expect(getDb().trips.filter((t) => t.date === "2026-10-14").every((t) => t.status === "SCHEDULED")).toBe(true);
  });

  test("passenger list and Excel export", async () => {
    const saved: string[] = [];
    URL.createObjectURL = vi.fn(() => "blob:x");
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
  });
});
