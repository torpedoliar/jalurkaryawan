import { describe, expect, test } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { utils, write } from "xlsx";
import { getDb } from "@bms/mock-api";
import { renderApp } from "./render";

/** Build a real .xlsx in memory, exactly what an admin would upload. */
function xlsxFile(rows: Record<string, unknown>[]) {
  const wb = utils.book_new();
  utils.book_append_sheet(wb, utils.json_to_sheet(rows), "Karyawan");
  return new File([write(wb, { type: "array", bookType: "xlsx" })], "karyawan.xlsx");
}

describe("employees", () => {
  test("import preview, commit, one-time passwords", async () => {
    const { user } = await renderApp("/karyawan", "ga");
    await user.upload(await screen.findByLabelText("File Excel"), xlsxFile([
      { NIK: "K2001", Nama: "Baru Satu", Departemen: "QC", "No HP": "0813" },
      { NIK: "K1001", Nama: "Rina W", Departemen: "Produksi", "No HP": "0812" },
    ]));
    expect(await screen.findByText("Baru: 1 · Diperbarui: 1 · Error: 0")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Simpan import" }));
    const table = (await screen.findByText(/Password sementara/)).closest("table")!;
    expect(within(table).getByRole("cell", { name: "K2001" })).toBeTruthy();
    expect(getDb().users.find((u) => u.nik === "K2001")).toMatchObject({ role: "EMPLOYEE", mustChangePassword: true });
    expect(getDb().users.find((u) => u.nik === "K1001")!.name).toBe("Rina W");
    await user.click(screen.getByRole("button", { name: "Tutup" }));
    expect(screen.queryByText(/Password sementara/)).toBeNull();
  });

  test("file with errors lists rows and blocks commit", async () => {
    const { user } = await renderApp("/karyawan", "ga");
    await user.upload(await screen.findByLabelText("File Excel"), xlsxFile([
      { NIK: "K2001", Nama: "Baru Satu", Departemen: "QC", "No HP": "" },
      { NIK: "K2001", Nama: "Ganda", Departemen: "QC", "No HP": "" },
      { NIK: "admin", Nama: "Bukan karyawan", Departemen: "", "No HP": "" },
    ]));
    const errors = (await screen.findByText("Error import")).closest("table")!;
    expect(within(errors).getByRole("row", { name: "3 NIK K2001 ganda di file" })).toBeTruthy();
    expect(within(errors).getByRole("row", { name: "4 NIK admin milik akun non-karyawan" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Simpan import" }) as HTMLButtonElement).disabled).toBe(true);
    expect(getDb().users.some((u) => u.nik === "K2001")).toBe(false);
  });

  test("empty NIK is reported with its Excel row", async () => {
    const { user } = await renderApp("/karyawan", "ga");
    await user.upload(await screen.findByLabelText("File Excel"), xlsxFile([{ NIK: "", Nama: "Tanpa NIK", Departemen: "", "No HP": "" }]));
    const errors = (await screen.findByText("Error import")).closest("table")!;
    expect(within(errors).getByRole("row", { name: "2 nik: NIK kosong" })).toBeTruthy();
  });

  test("search, paginate, suspend then lift suspension", async () => {
    const { user } = await renderApp("/karyawan", "ga");
    expect(await screen.findByText("Halaman 1 dari 2")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Berikutnya" }));
    expect(await screen.findByRole("cell", { name: "K1090" })).toBeTruthy();

    await user.type(screen.getByLabelText("Cari NIK / nama"), "Rina");
    const row = (await screen.findByRole("cell", { name: "Rina Wulandari" })).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Bekukan" }));
    fireEvent.change(screen.getByLabelText("Beku sampai"), { target: { value: "2026-10-20" } });
    await user.type(screen.getByLabelText("Alasan"), "No-show 3x");
    await user.click(screen.getByRole("button", { name: "Simpan pembekuan" }));
    expect(await screen.findByRole("cell", { name: "Beku s/d 2026-10-20" })).toBeTruthy();
    expect(getDb().users.find((u) => u.id === "k1001")).toMatchObject({ bookingSuspendedUntil: "2026-10-20", suspendReason: "No-show 3x" });

    const again = screen.getByRole("cell", { name: "Rina Wulandari" }).closest("tr")!;
    await user.click(within(again).getByRole("button", { name: "Cabut pembekuan" }));
    expect(await screen.findByRole("cell", { name: "Aktif" })).toBeTruthy();
    expect(getDb().users.find((u) => u.id === "k1001")!.bookingSuspendedUntil).toBeNull();
  });

  test("reset password shows it once; deactivate needs confirmation", async () => {
    const { user } = await renderApp("/karyawan", "ga");
    await user.type(await screen.findByLabelText("Cari NIK / nama"), "K1002");
    const row = () => screen.getByRole("cell", { name: "Budi Santoso" }).closest("tr")!;
    await screen.findByRole("cell", { name: "Budi Santoso" });
    await user.click(within(row()).getByRole("button", { name: "Reset password" }));
    const table = (await screen.findByText(/Password sementara/)).closest("table")!;
    expect(within(table).getByRole("cell", { name: getDb().users.find((u) => u.id === "k1002")!.password })).toBeTruthy();

    await user.click(within(row()).getByRole("button", { name: "Nonaktifkan" }));
    expect(getDb().users.find((u) => u.id === "k1002")!.active).toBe(true);
    await user.click(within(row()).getByRole("button", { name: "Ya, nonaktifkan" }));
    expect(await screen.findByRole("cell", { name: "Nonaktif" })).toBeTruthy();
    expect(getDb().users.find((u) => u.id === "k1002")!.active).toBe(false);
  });
});

describe("admin & vendor accounts", () => {
  test("super admin creates a vendor account", async () => {
    const { user } = await renderApp("/admin-user", "admin");
    await user.type(await screen.findByLabelText("NIK"), "op2");
    await user.type(screen.getByLabelText("Nama"), "Operator Mitra");
    await user.selectOptions(screen.getByLabelText("Role"), "VENDOR");
    await user.selectOptions(screen.getByLabelText("Vendor"), "v2");
    await user.click(screen.getByRole("button", { name: "Simpan akun" }));
    const table = (await screen.findByText(/Password sementara/)).closest("table")!;
    expect(within(table).getByRole("cell", { name: "op2" })).toBeTruthy();
    expect(getDb().users.find((u) => u.nik === "op2")).toMatchObject({ role: "VENDOR", vendorId: "v2" });
    expect(await screen.findByRole("cell", { name: "Operator Mitra" })).toBeTruthy();
  });

  test("vendor role without vendor is rejected client-side", async () => {
    const { user } = await renderApp("/admin-user", "admin");
    await user.type(await screen.findByLabelText("NIK"), "op3");
    await user.type(screen.getByLabelText("Nama"), "Tanpa Vendor");
    await user.selectOptions(screen.getByLabelText("Role"), "VENDOR");
    await user.click(screen.getByRole("button", { name: "Simpan akun" }));
    expect((await screen.findByRole("alert")).textContent).toBe("vendorId wajib hanya untuk role VENDOR");
    expect(getDb().users.some((u) => u.nik === "op3")).toBe(false);
  });

  test("admin GA does not see the admin accounts page", async () => {
    await renderApp("/karyawan", "ga");
    await screen.findByLabelText("File Excel");
    expect(screen.queryByRole("link", { name: "Admin & Vendor" })).toBeNull();
  });
});
