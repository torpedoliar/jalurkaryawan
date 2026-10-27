import { describe, expect, test } from "vitest";
import { screen } from "@testing-library/react";
import { renderApp } from "./render";

describe("dashboard insights", () => {
  test("shows occupancy gauge, rejection chart, route and shift breakdowns", async () => {
    await renderApp("/dashboard", "ga");
    await screen.findByRole("heading", { name: "Dashboard" });
    expect(await screen.findByRole("img", { name: /Keterisian \d+ persen/ })).toBeTruthy();
    expect(await screen.findByRole("img", { name: /Penolakan per hari/ })).toBeTruthy();
    expect(screen.getByText("Rute paling padat")).toBeTruthy();
    expect(screen.getByText("Beban per shift")).toBeTruthy();
    expect(screen.getByText("Ringkasan angka")).toBeTruthy();
    // The chart is backed by the table, so both views agree.
    expect(await screen.findByText("Booking ditolak 7 hari terakhir")).toBeTruthy();
  });
});
