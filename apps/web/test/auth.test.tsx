import { describe, expect, test } from "vitest";
import { screen, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { DEMO_PASSWORD, getDb } from "@bms/mock-api";
import { ENDPOINTS } from "@bms/shared";
import { renderApp } from "./render";
import { server } from "./setup";

const MAINTENANCE = { code: "MAINTENANCE", message: "Sistem sedang memulihkan database. Coba lagi beberapa menit lagi." };

describe("app shell", () => {
  test("login shows the server error verbatim, then signs in", async () => {
    const { user } = await renderApp("/");
    await user.type(await screen.findByLabelText("NIK"), "K1001");
    await user.type(screen.getByLabelText("Password"), "salah");
    await user.click(screen.getByRole("button", { name: "Masuk" }));
    expect((await screen.findByRole("alert")).textContent).toBe("NIK atau password salah.");
    await user.clear(screen.getByLabelText("Password"));
    await user.type(screen.getByLabelText("Password"), DEMO_PASSWORD);
    await user.click(screen.getByRole("button", { name: "Masuk" }));
    expect(await screen.findByRole("button", { name: "Keluar" })).toBeTruthy();
    expect(screen.getByText("Rina Wulandari")).toBeTruthy();
  });

  test("logout returns to the login form", async () => {
    const { user } = await renderApp("/", "K1001");
    await user.click(await screen.findByRole("button", { name: "Keluar" }));
    expect(await screen.findByRole("button", { name: "Masuk" })).toBeTruthy();
  });

  // Review Focus 2
  test("mustChangePassword user sees only the change form on any URL until changed", async () => {
    const { user } = await renderApp("/keberangkatan", "K1090");
    expect(await screen.findByText("Kamu wajib mengganti password sebelum melanjutkan.")).toBeTruthy();
    expect(screen.queryByRole("navigation")).toBeNull();
    const fill = async (pw: string) => {
      for (const l of ["Password lama", "Password baru", "Ulangi password baru"]) await user.clear(screen.getByLabelText(l));
      await user.type(screen.getByLabelText("Password lama"), DEMO_PASSWORD);
      await user.type(screen.getByLabelText("Password baru"), pw);
      await user.type(screen.getByLabelText("Ulangi password baru"), pw);
      await user.click(screen.getByRole("button", { name: "Simpan" }));
    };
    await fill("abc123x"); // passes shared min(6), fails server password_min_length 8
    expect((await screen.findByRole("alert")).textContent).toBe("Password minimal 8 karakter.");
    await fill("rahasia123");
    expect(await screen.findByRole("heading", { name: "Papan Keberangkatan" })).toBeTruthy();
    expect(screen.getByRole("navigation")).toBeTruthy();
  });

  test("change password rejects a mismatched confirmation before calling the server", async () => {
    const { user } = await renderApp("/ganti-password", "K1001");
    await user.type(await screen.findByLabelText("Password lama"), DEMO_PASSWORD);
    await user.type(screen.getByLabelText("Password baru"), "rahasia123");
    await user.type(screen.getByLabelText("Ulangi password baru"), "rahasia124");
    await user.click(screen.getByRole("button", { name: "Simpan" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Konfirmasi password tidak sama.");
  });

  test("first-run setup creates the Super Admin and signs in", async () => {
    const db = getDb();
    db.users.splice(db.users.findIndex((u) => u.role === "SUPER_ADMIN"), 1);
    const { user } = await renderApp("/");
    expect(await screen.findByRole("heading", { name: "Setup Awal" })).toBeTruthy();
    await user.type(screen.getByLabelText("NIK"), "SA01");
    await user.type(screen.getByLabelText("Nama"), "Kepala GA");
    await user.type(screen.getByLabelText("Password"), "rahasia123");
    await user.click(screen.getByRole("button", { name: "Buat Super Admin" }));
    expect(await screen.findByRole("button", { name: "Keluar" })).toBeTruthy();
    expect(screen.getByText("Kepala GA")).toBeTruthy();
  });

  test("setup screen never shows once a Super Admin exists", async () => {
    await renderApp("/");
    expect(await screen.findByRole("button", { name: "Masuk" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Setup Awal" })).toBeNull();
  });

  // Review Focus 3
  test("MAINTENANCE swaps to the maintenance screen, which polls systemStatus and returns", async () => {
    server.use(
      http.get(`*${ENDPOINTS.departures}`, () => HttpResponse.json(MAINTENANCE, { status: 503 })),
      http.get(`*${ENDPOINTS.systemStatus}`, () => HttpResponse.json({ maintenance: true, message: MAINTENANCE.message })),
    );
    await renderApp("/keberangkatan", "admin");
    expect(await screen.findByRole("heading", { name: "Sistem sedang dalam pemeliharaan" })).toBeTruthy();
    server.resetHandlers();
    expect(await screen.findByRole("heading", { name: "Papan Keberangkatan" }, { timeout: 5000 })).toBeTruthy();
  }, 10_000);

  test("departure board highlights the employee's own trips and labels status", async () => {
    await renderApp("/keberangkatan", "K1001");
    await screen.findByRole("heading", { name: "Papan Keberangkatan" });
    const mine = (await screen.findAllByRole("row")).filter((r) => r.classList.contains("mine"));
    expect(mine.length).toBeGreaterThan(0);
    for (const r of mine) expect(within(r).getByText(/R1/)).toBeTruthy();
    expect(screen.getAllByText("TERSEDIA").length).toBeGreaterThan(0);
  });
});
