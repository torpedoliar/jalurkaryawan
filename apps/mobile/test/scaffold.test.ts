import { describe, expect, test } from "@jest/globals";
import { renderApp } from "./render";

describe("scaffold", () => {
  test("App renders the Bus Karyawan heading", async () => {
    const { findByText } = await renderApp();
    expect(await findByText("Bus Karyawan")).toBeTruthy();
  });
});
