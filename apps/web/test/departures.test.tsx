import { describe, expect, test } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderApp } from "./render";

describe("papan keberangkatan", () => {
  test("summary, next departure, and direction filter keep the board readable", async () => {
    const { user } = await renderApp("/keberangkatan", "K1001");
    await screen.findByRole("heading", { name: "Papan Keberangkatan" });
    expect(await screen.findByText("BERIKUTNYA")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Saring arah" })).toBeTruthy();
    const table = await screen.findByRole("table", { name: /Jadwal keberangkatan/ });
    const dataRows = () => within(table).getAllByRole("row").slice(1);

    await user.click(within(screen.getByRole("group", { name: "Saring arah" })).getByRole("button", { name: "Antar" }));
    expect(dataRows().length).toBeGreaterThan(0);
    for (const row of dataRows()) expect(row.textContent).toContain("Antar");

    // The employee's own trips stay marked after filtering.
    await user.click(within(screen.getByRole("group", { name: "Saring arah" })).getByRole("button", { name: "Jemput" }));
    expect(dataRows().some((row) => row.classList.contains("mine"))).toBe(true);
  });
});
