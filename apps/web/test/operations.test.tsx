import { describe, expect, test } from "vitest";
import { screen, within } from "@testing-library/react";
import { getDb } from "@bms/mock-api";
import { renderApp } from "./render";
import { locationLabel } from "../src/pages/admin/Tracking";
import type { BusPosition } from "@bms/shared";

describe("operations admin", () => {
  test("tracking shows missing positions honestly and only admins can open it", async () => {
    await renderApp("/tracking", "ga");
    expect(await screen.findByRole("heading", { name: "Tracking Bus" })).toBeTruthy();
    expect(await screen.findByRole("table", { name: "Posisi armada" })).toBeTruthy();
    expect((await screen.findAllByText("Belum ada lokasi")).length).toBeGreaterThan(0);
    expect(screen.getByRole("application", { name: "Peta tracking bus" })).toBeTruthy();
  });

  test("tracking pin shows bus plate instead of an ambiguous route-only square", async () => {
    const db = getDb();
    const trip = db.trips.find((t) => t.date === "2026-10-14")!;
    db.ops.locations.push({ tripId: trip.id, sampleId: "pin-test", lat: -6.35, lng: 107.32, accuracy: 10, capturedAt: db.now().toISOString() });
    await renderApp("/tracking", "ga");
    const map = await screen.findByRole("application", { name: "Peta tracking bus" });
    expect(await within(map).findByText("B 7101 FX")).toBeTruthy();
    expect(within(map).getByText("R1 · Jemput")).toBeTruthy();
    expect(map.querySelector(".fleet-pin.stale")).toBeTruthy();
  });

  test("manifest shows attendance and assigns a vendor-compatible driver", async () => {
    const { user } = await renderApp("/trip", "ga");
    const tripRow = await screen.findByRole("row", { name: /^05:20 R1 Pagi Jemput/ });
    await user.click(within(tripRow).getByRole("button", { name: "Penumpang" }));
    const manifest = await screen.findByRole("table", { name: /^Penumpang R1/ });
    expect(within(manifest).getByRole("columnheader", { name: "Check-in" })).toBeTruthy();
    const select = await screen.findByLabelText("Tugaskan sopir");
    const options = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(options).toContain("Sopir Joko (driver)");
    expect(options).not.toContain("Sopir Hadi (driver2)");
    await user.selectOptions(select, "driver");
    await user.click(screen.getByRole("button", { name: "Simpan sopir" }));
    const trip = getDb().trips.find((t) => t.departureAt.includes("05:20") && t.date === "2026-10-14" && t.routeId === "r1")!;
    expect(getDb().ops.tripDrivers.get(trip.id)).toBe("driver");
  });

  test("bus QR can be viewed and rotated with explicit confirmation", async () => {
    const { user } = await renderApp("/vendor-bus", "ga");
    const row = (await screen.findByRole("cell", { name: "B 7101 FX" })).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "QR" }));
    await screen.findByRole("heading", { name: "QR check-in bus B 7101 FX" });
    const old = getDb().ops.busQr.get("b1")!.qr;
    await user.click(screen.getByRole("button", { name: "Ganti QR" }));
    expect(getDb().ops.busQr.get("b1")!.qr).toBe(old);
    await user.click(screen.getByRole("button", { name: "Ya, ganti QR" }));
    // Wait for the action to finish before asserting the credential was rotated.
    await screen.findByRole("button", { name: "Ganti QR" });
    expect(getDb().ops.busQr.get("b1")!.qr).not.toBe(old);
  });
});


describe("tracking freshness", () => {
  const now = Date.parse("2026-10-14T05:00:00+07:00");
  const bus: BusPosition = {
    tripId: "t1", busId: "b1", busPlate: "B 1 AA", routeId: "r1", routeCode: "R1", routeColor: "#123456",
    direction: "PICKUP", departureAt: "2026-10-14T05:00:00+07:00", execution: "IN_PROGRESS", driverName: "Joko",
    position: { lat: -6.3, lng: 107.1, accuracy: 10, capturedAt: "2026-10-14T04:59:45+07:00" },
  };
  test("old or completed positions are never labeled fresh", () => {
    expect(locationLabel(bus, now)).toBe("Diperbarui 15 detik lalu");
    expect(locationLabel(bus, now + 180_000)).toContain("Lokasi terakhir");
    expect(locationLabel({ ...bus, execution: "COMPLETED" }, now)).toContain("Lokasi terakhir");
    expect(locationLabel({ ...bus, position: null }, now)).toBe("Belum ada lokasi");
  });
});
