import { describe, expect, jest, test } from "@jest/globals";
import { HttpResponse, http } from "msw";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { DEMO_PASSWORD, getDb } from "@bms/mock-api";
import { ENDPOINTS } from "@bms/shared";
import { renderApp } from "./render";
import { server } from "./setup";

const MAINTENANCE = { code: "MAINTENANCE", message: "Sistem sedang memulihkan database. Coba lagi beberapa menit lagi." };

describe("app shell", () => {
  test("login shows the server error verbatim, then signs in", async () => {
    await renderApp();
    await fireEvent.changeText(await screen.findByLabelText("NIK"), "K1001");
    await fireEvent.changeText(screen.getByLabelText("Password"), "salah");
    await fireEvent.press(screen.getByText("Masuk"));
    expect(await screen.findByText("NIK atau password salah.")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Password"), DEMO_PASSWORD);
    await fireEvent.press(screen.getByText("Masuk"));
    expect(await screen.findByText("Keluar")).toBeTruthy();
    expect(await screen.findByText("Rina Wulandari")).toBeTruthy();
  });

  test("logout returns to the login form", async () => {
    await renderApp("beranda", "K1001");
    await fireEvent.press(await screen.findByText("Keluar"));
    expect(await screen.findByText("Masuk")).toBeTruthy();
  });

  // Review Focus 3
  test("mustChangePassword user sees only the change form on any tab until changed", async () => {
    await renderApp("keberangkatan", "K1090");
    expect(await screen.findByText("Kamu wajib mengganti password sebelum melanjutkan.")).toBeTruthy();
    expect(screen.queryByText("Beranda")).toBeNull();
    const fill = async (pw: string) => {
      await fireEvent.changeText(screen.getByLabelText("Password lama"), DEMO_PASSWORD);
      await fireEvent.changeText(screen.getByLabelText("Password baru"), pw);
      await fireEvent.changeText(screen.getByLabelText("Ulangi password baru"), pw);
      await fireEvent.press(screen.getByText("Simpan"));
    };
    await fill("abc123x");
    expect(await screen.findByText("Password minimal 8 karakter.")).toBeTruthy();
    await fill("rahasia123");
    expect(await screen.findByText("Papan Keberangkatan")).toBeTruthy();
    expect(screen.getByText("Beranda")).toBeTruthy();
  });

  test("change password rejects a mismatched confirmation before calling the server", async () => {
    await renderApp("ganti-password", "K1001");
    await fireEvent.changeText(await screen.findByLabelText("Password lama"), DEMO_PASSWORD);
    await fireEvent.changeText(screen.getByLabelText("Password baru"), "rahasia123");
    await fireEvent.changeText(screen.getByLabelText("Ulangi password baru"), "rahasia124");
    await fireEvent.press(screen.getByText("Simpan"));
    expect(await screen.findByText("Konfirmasi password tidak sama.")).toBeTruthy();
  });

  test("first-run setup shows the contact-admin message instead of a form", async () => {
    const db = getDb();
    db.users.splice(db.users.findIndex((u) => u.role === "SUPER_ADMIN"), 1);
    await renderApp();
    expect(await screen.findByText("Setup Awal")).toBeTruthy();
    expect(screen.getByText("Hubungi admin untuk setup awal lewat web.")).toBeTruthy();
  });

  // Review Focus 3
  test("MAINTENANCE swaps to the maintenance screen, which polls systemStatus and returns", async () => {
    server.use(
      http.get(`*${ENDPOINTS.me}`, () => HttpResponse.json(MAINTENANCE, { status: 503 })),
      http.get(`*${ENDPOINTS.systemStatus}`, () => HttpResponse.json({ maintenance: true, message: MAINTENANCE.message })),
    );
    await renderApp("keberangkatan", "K1001");
    expect(await screen.findByText("Sistem sedang dalam pemeliharaan")).toBeTruthy();
    server.resetHandlers();
    jest.advanceTimersByTime(2000);
    await waitFor(() => expect(screen.getByText("Papan Keberangkatan")).toBeTruthy(), { timeout: 5000 });
  }, 10_000);

  test("admin can use the employee self-service screens", async () => {
    await renderApp("beranda", "admin");
    expect((await screen.findAllByText("Beranda")).length).toBeGreaterThan(0);
    expect(screen.getByText("Booking Harian")).toBeTruthy();
    expect(screen.getByText("Riwayat")).toBeTruthy();
  });

  test("an external vendor is rejected with logout", async () => {
    await renderApp("beranda", "vendor");
    expect(await screen.findByText("Akun ini tidak memakai aplikasi mobile. Gunakan web.")).toBeTruthy();
    await fireEvent.press(screen.getByText("Keluar"));
    expect(await screen.findByText("Masuk")).toBeTruthy();
  });
});
