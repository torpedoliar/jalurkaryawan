import { describe, expect, test, vi } from "vitest";
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

  test("reset password keeps every earlier one-time password", async () => {
    const { user } = await renderApp("/karyawan", "ga");
    await user.upload(await screen.findByLabelText("File Excel"), xlsxFile([
      { NIK: "K2001", Nama: "Baru Satu", Departemen: "QC", "No HP": "0813" },
      { NIK: "K2002", Nama: "Baru Dua", Departemen: "QC", "No HP": "0814" },
    ]));
    await user.click(await screen.findByRole("button", { name: "Simpan import" }));
    const table = () => screen.getByText(/Password sementara/).closest("table")!;
    expect(within(table()).getByRole("cell", { name: "K2001" })).toBeTruthy();

    // Reset an unrelated employee: the two imported passwords must survive (the endpoint serves them only once).
    const row = (await screen.findByRole("cell", { name: "Budi Santoso" })).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Reset password" }));
    await user.click(within(row).getByRole("button", { name: "Ya, reset password" }));
    expect(within(table()).getByRole("cell", { name: "K1002" })).toBeTruthy();
    expect(within(table()).getByRole("cell", { name: "K2001" })).toBeTruthy();
    expect(within(table()).getByRole("cell", { name: "K2002" })).toBeTruthy();

    // Re-resetting the same user supersedes his row instead of adding a second one.
    await user.click(within(row).getByRole("button", { name: "Reset password" }));
    await user.click(within(row).getByRole("button", { name: "Ya, reset password" }));
    expect(within(table()).getAllByRole("cell", { name: "K1002" }).length).toBe(1);
    expect(within(table()).getAllByRole("cell", { name: "K2001" }).length).toBe(1);
  });

  test("an expired suspension reads as Aktif", async () => {
    const { user } = await renderApp("/karyawan", "ga");
    await user.type(await screen.findByLabelText("Cari NIK / nama"), "Budi Santoso");
    const row = () => screen.getByRole("cell", { name: "Budi Santoso" }).closest("tr")!;
    await user.click(within(row()).getByRole("button", { name: "Bekukan" }));
    fireEvent.change(screen.getByLabelText("Beku sampai"), { target: { value: "2026-10-15" } });
    await user.type(screen.getByLabelText("Alasan"), "Sementara");
    await user.click(screen.getByRole("button", { name: "Simpan pembekuan" }));
    expect(within(row()).getByRole("cell", { name: "Beku s/d 2026-10-15" })).toBeTruthy();

    // Test clock 2026-10-14; moving to 2026-10-16 makes that end date past, which every other screen reads as none.
    vi.setSystemTime(new Date("2026-10-16T09:00:00+07:00"));
    fireEvent.change(screen.getByLabelText("Cari NIK / nama"), { target: { value: "Budi Santos" } });
    expect(await within(row()).findByRole("cell", { name: "Aktif" })).toBeTruthy();
    expect(within(row()).queryByRole("button", { name: "Cabut pembekuan" })).toBeNull();
    expect(within(row()).getByRole("button", { name: "Bekukan" })).toBeTruthy();
    vi.setSystemTime(new Date("2026-10-14T00:00:00+07:00"));
  });

  test("lowercase CSV headers import", async () => {
    const { user } = await renderApp("/karyawan", "ga");
    const csv = new File([new TextEncoder().encode("nik,nama,departemen,no hp\nK2003,Baru Tiga,QC,0812 ext 5\n")], "karyawan.csv");
    await user.upload(await screen.findByLabelText("File Excel"), csv);
    expect(await screen.findByText("Baru: 1 · Diperbarui: 0 · Error: 0")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Simpan import" }));
    expect(within(screen.getByText(/Password sementara/).closest("table")!).getByRole("cell", { name: "K2003" })).toBeTruthy();
    expect(getDb().users.find((u) => u.nik === "K2003")).toMatchObject({ name: "Baru Tiga", department: "QC", phone: "0812 ext 5" });
  });

  test("CSV import keeps a leading zero in NIK and phone", async () => {
    const { user } = await renderApp("/karyawan", "ga");
    const csv = new File([new TextEncoder().encode("NIK,Nama,Departemen,No HP\n00123,Ani,QC,081200001001\n")], "karyawan.csv");
    await user.upload(await screen.findByLabelText("File Excel"), csv);
    expect(await screen.findByText("Baru: 1 · Diperbarui: 0 · Error: 0")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Simpan import" }));
    // raw: true is what keeps SheetJS from turning both cells into numbers and eating the zero.
    const stored = getDb().users.find((u) => u.nik === "00123");
    expect(stored).toMatchObject({ nik: "00123", name: "Ani", department: "QC", phone: "081200001001" });
    expect(getDb().users.some((u) => u.nik === "123" || u.phone === "81200001001")).toBe(false);
  });

  test("a list change closes the row-scoped suspend form", async () => {
    const { user } = await renderApp("/karyawan", "ga");
    expect(await screen.findByText("Halaman 1 dari 2")).toBeTruthy();
    await user.type(screen.getByLabelText("Cari NIK / nama"), "Budi");
    const row = screen.getByRole("cell", { name: "Budi Santoso" }).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Bekukan" }));
    expect(screen.getByLabelText("Beku sampai")).toBeTruthy();

    // Searching so the row disappears must drop the form rather than leave it bound to a row nobody can see.
    fireEvent.change(screen.getByLabelText("Cari NIK / nama"), { target: { value: "Siti" } });
    expect(await screen.findByRole("cell", { name: "Siti Aminah" })).toBeTruthy();
    expect(screen.queryByLabelText("Beku sampai")).toBeNull();
    expect(getDb().users.find((u) => u.id === "k1002")!.bookingSuspendedUntil).toBeNull();
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

    // Reset is irreversible (it invalidates the password and every session), so it arms first.
    await user.click(within(row()).getByRole("button", { name: "Reset password" }));
    expect(screen.queryByText(/Password sementara/)).toBeNull();
    await user.click(within(row()).getByRole("button", { name: "Ya, reset password" }));
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

  test("creating a second account keeps the first account's password", async () => {
    const { user } = await renderApp("/admin-user", "admin");
    await screen.findByLabelText("NIK");
    const create = async (nik: string, name: string) => {
      await user.type(screen.getByLabelText("NIK"), nik);
      await user.type(screen.getByLabelText("Nama"), name);
      await user.click(screen.getByRole("button", { name: "Simpan akun" }));
      await screen.findByText(/Password sementara/);
    };
    await create("op9", "Operator Sembilan");
    await create("op8", "Operator Delapan");
    const table = screen.getByText(/Password sementara/).closest("table")!;
    expect(within(table).getByRole("cell", { name: "op9" })).toBeTruthy();
    expect(within(table).getByRole("cell", { name: "op8" })).toBeTruthy();
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

  test("admin GA sees the admin accounts page but only vendor accounts", async () => {
    await renderApp("/admin-user", "ga");
    await screen.findByRole("heading", { name: "Admin & Vendor" });
    // Spec 6.1: vendor accounts are ADMIN_GA work; admin accounts are Super-Admin-only, so the
    // role select offers VENDOR alone and no admin row is listed.
    const options = within(await screen.findByLabelText("Role")).getAllByRole("option");
    expect(options.map((o) => (o as HTMLOptionElement).value)).toEqual(["VENDOR"]);
    const table = (await screen.findByText("Akun admin & vendor")).closest("table")!;
    expect(within(table).getByRole("cell", { name: "Operator PT Trans Jaya" })).toBeTruthy();
    expect(within(table).queryByRole("cell", { name: "Super Admin" })).toBeNull();
    expect(within(table).queryByRole("cell", { name: "Admin GA" })).toBeNull();
  });

  test("admin reset password needs a confirmation", async () => {
    const { user } = await renderApp("/admin-user", "admin");
    const row = (await screen.findByRole("cell", { name: "Operator PT Trans Jaya" })).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Reset password" }));
    expect(screen.queryByText(/Password sementara/)).toBeNull();
    await user.click(within(row).getByRole("button", { name: "Ya, reset password" }));
    const table = (await screen.findByText(/Password sementara/)).closest("table")!;
    expect(within(table).getByRole("cell", { name: getDb().users.find((u) => u.id === "vendor")!.password })).toBeTruthy();
  });

  test("admin GA cannot open the super-admin-only pages", async () => {
    await renderApp("/admin-user", "ga");
    await screen.findByRole("heading", { name: "Admin & Vendor" });
    // /admin-user is ADMIN_GA's since vendor accounts are theirs; /pengaturan is still Super only.
    expect(screen.getByRole("link", { name: "Admin & Vendor" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Pengaturan" })).toBeNull();
  });
});
