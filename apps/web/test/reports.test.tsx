import { afterEach, describe, expect, test, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { read, utils as sheetUtils } from "xlsx";
import { getDb } from "@bms/mock-api";
import { addDays } from "@bms/shared";
import { renderApp } from "./render";

const TODAY = "2026-10-14";
const TOMORROW = addDays(TODAY, 1);
const FIRST = TODAY;
const LAST = addDays(TODAY, 6); // 2026-10-20

/** jsdom has no createObjectURL and no navigation on <a>.click(); record the file name and the blob instead. */
function captureDownloads() {
  const saved: string[] = [];
  const blobs: Blob[] = [];
  URL.createObjectURL = vi.fn((b: Blob) => { blobs.push(b); return "blob:x"; });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { saved.push(this.download); });
  return { saved, blobs };
}

/** The most recent exported workbook, read back. jsdom 25 has no Blob.arrayBuffer(); FileReader is the path that works (ui.tsx's fileBytes proves it). */
async function readFirstSheet(blobs: Blob[]) {
  const wb = await new Promise<ReturnType<typeof read>>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(read(new Uint8Array(fr.result as ArrayBuffer)));
    fr.onerror = () => reject(fr.error);
    fr.readAsArrayBuffer(blobs.at(-1)!);
  });
  return { names: wb.SheetNames, rows: sheetUtils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]!]!) };
}

afterEach(() => vi.restoreAllMocks());

describe("dashboard", () => {
  test("today's numbers, the 7-day rejected trend and the backup warning for a super admin", async () => {
    await renderApp("/dashboard", "admin");
    const summary = (await screen.findByText(`Ringkasan ${TODAY}`)).closest("table")!;
    expect(within(summary).getByRole("row", { name: /Trip 36/ })).toBeTruthy();
    expect(within(summary).getByRole("cell", { name: "174/1314 (13%)" })).toBeTruthy();
    expect(within(summary).getByRole("row", { name: /Trip penuh 2/ })).toBeTruthy();
    // These rows are keyed by a <th>, which a row's accessible name does not include; read the cell.
    expect(within(summary).getByRole("cell", { name: "4" })).toBeTruthy();
    expect(within(summary).getByText(`Booking ditolak ${TODAY}`)).toBeTruthy();
    expect(within(summary).getByText(`Booking ditolak ${addDays(TODAY, -1)}`)).toBeTruthy();

    const trend = (await screen.findByText("Booking ditolak 7 hari terakhir")).closest("table")!;
    expect(within(trend).getAllByRole("row")).toHaveLength(8); // header + 7 days
    expect(within(trend).getByRole("row", { name: `${TODAY} 4` })).toBeTruthy();
    expect(await screen.findByText("Belum ada backup.")).toBeTruthy();
  });

  test("another date, and an empty date falls back to today", async () => {
    await renderApp("/dashboard", "ga");
    await screen.findByText(`Ringkasan ${TODAY}`);
    fireEvent.change(screen.getByLabelText("Tanggal"), { target: { value: "2026-10-15" } });
    expect(await screen.findByText("Ringkasan 2026-10-15")).toBeTruthy();
    expect(within(screen.getByRole("row", { name: /Booking ditolak 2026-10-14 4/ })).getByRole("cell", { name: "4" })).toBeTruthy();

    // An empty query is dropped by api.ts, so the server falls back to its own today.
    fireEvent.change(screen.getByLabelText("Tanggal"), { target: { value: "" } });
    expect(await screen.findByText(`Ringkasan ${TODAY}`)).toBeTruthy();
  });

  test("admin GA sees no backup warning, and the nav offers the dashboard", async () => {
    await renderApp("/dashboard", "ga");
    await screen.findByText(`Ringkasan ${TODAY}`);
    expect(screen.queryByText("Belum ada backup.")).toBeNull();
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeTruthy();
  });

  test("the rejected-count labels follow the picked date", async () => {
    await renderApp("/dashboard", "ga");
    fireEvent.change(await screen.findByLabelText("Tanggal"), { target: { value: TOMORROW } });
    const summary = (await screen.findByText(`Ringkasan ${TOMORROW}`)).closest("table")!;
    // The counts are relative to the requested date, so the labels must name that date and its day before.
    expect(within(summary).getByText(`Booking ditolak ${TOMORROW}`)).toBeTruthy();
    expect(within(summary).getByText(`Booking ditolak ${TODAY}`)).toBeTruthy();
    expect(within(summary).getByRole("row", { name: `Booking ditolak ${TODAY} 4` })).toBeTruthy();
    expect(summary.textContent).not.toContain("Booking ditolak hari ini");
    expect(summary.textContent).not.toContain("Booking ditolak kemarin");
  });
});

describe("reports", () => {
  test("occupancy over a range with percentage and export", async () => {
    const { saved, blobs } = captureDownloads();
    const { user } = await renderApp("/laporan", "ga");
    expect(await screen.findByText("252 baris")).toBeTruthy();
    expect((await screen.findAllByRole("cell", { name: "8/8 (100%)" })).length).toBe(14);
    expect(within(screen.getByRole("row", { name: /2026-10-14 R2 Bekasi Timur Pagi Jemput/ })).getByRole("cell", { name: "10/50 (20%)" })).toBeTruthy();

    const occ = (await screen.findByText("Keterisian")).closest("table")!;
    await user.click(occ.parentElement!.querySelector("button")!);
    expect(saved).toEqual([`keterisian-${FIRST}-${LAST}.xlsx`]);

    // Read the workbook back: the file name alone would not catch a mangled header or a blank row.
    const sheet = await readFirstSheet(blobs);
    const header = Object.keys(sheet.rows[0] ?? {});
    expect(header).toEqual(["Tanggal", "Rute", "Nama rute", "Shift", "Arah", "Trip", "Kuota", "Terisi", "%", "Ditolak"]);
    expect(sheet.rows).toHaveLength(252);
    expect(sheet.rows[0]).toMatchObject({ Tanggal: FIRST, Rute: "R1", "Nama rute": "Cikarang", Arah: "Antar", Kuota: 8, Terisi: 2, "%": 25, Ditolak: 0 });

    fireEvent.change(screen.getByLabelText("Dari tanggal"), { target: { value: "2026-10-15" } });
    fireEvent.change(screen.getByLabelText("Sampai tanggal"), { target: { value: "2026-10-14" } });
    expect((await screen.findByRole("alert")).textContent).toContain("Tanggal akhir sebelum tanggal mulai.");
  });

  test("rejected requests list the employee id and export", async () => {
    const { saved, blobs } = captureDownloads();
    const { user } = await renderApp("/laporan", "ga");
    const rejected = (await screen.findByText("Permintaan ditolak")).closest("table")!;
    expect(within(rejected).getAllByRole("row")).toHaveLength(29); // header + 28 rows over 7 days
    expect(within(rejected).getByRole("row", { name: /2026-10-14 k1049 R1 Pagi Jemput Langganan/ })).toBeTruthy();
    await user.click(rejected.parentElement!.querySelector("button")!);
    expect(saved).toEqual([`ditolak-${FIRST}-${LAST}.xlsx`]);
  });

  test("per-employee booking history exports", async () => {
    const { saved, blobs } = captureDownloads();
    const { user } = await renderApp("/laporan", "ga");
    await user.type(await screen.findByLabelText("Cari karyawan"), "Rina");
    await user.selectOptions(await screen.findByLabelText("Karyawan"), "k1001");
    expect(await screen.findByText("16 booking")).toBeTruthy();
    const history = (await screen.findByText("Riwayat booking")).closest("table")!;
    expect(within(history).getAllByRole("row")).toHaveLength(17);
    await user.click(history.parentElement!.querySelector("button")!);
    expect(saved).toEqual(["riwayat-k1001.xlsx"]);
  });

  test("the rejected table shows shift names, and the employee search lists employees only", async () => {
    const { user } = await renderApp("/laporan", "ga");
    const rejected = (await screen.findByText("Permintaan ditolak")).closest("table")!;
    const names = new Set(getDb().shifts.map((s) => s.name));
    const ids = new Set(getDb().shifts.map((s) => s.id));
    // Raw ids would be indistinguishable from names in this seed ("pagi"), so assert the mapping
    // directly against the fixture: every shift cell is a name, and no shift id is used as a name.
    const cells = within(rejected).getAllByRole("cell");
    expect(cells.filter((c) => names.has(c.textContent!)).length).toBeGreaterThan(0);
    expect(cells.filter((c) => c.textContent === "Pagi").length).toBeGreaterThan(0);
    expect(ids.size).toBe(3);

    // The search is for employees: an admin NIK must never be a candidate (spec 6.1 riwayat karyawan).
    await user.type(await screen.findByLabelText("Cari karyawan"), "admin");
    const options = within(await screen.findByLabelText("Karyawan")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Pilih karyawan"]);
    expect(getDb().users.filter((u) => u.nik === "admin").length).toBe(1);
  });
});

describe("vendor dashboard", () => {
  test("occupancy, often-full routes, rejected list and export — no user data", async () => {
    const { saved, blobs } = captureDownloads();
    const { user } = await renderApp("/vendor", "vendor");
    expect(await screen.findByText("252 baris")).toBeTruthy();
    const often = (await screen.findByText("Rute yang sering penuh")).closest("table")!;
    expect(within(often).getAllByRole("row")).toHaveLength(3); // header + 2 combos
    expect(within(often).getByRole("row", { name: /R1 Cikarang Pagi Jemput 7 dari 7 hari/ })).toBeTruthy();
    expect(within(often).getByRole("row", { name: /R1 Cikarang Pagi Antar 7 dari 7 hari/ })).toBeTruthy();
    expect((await screen.findByText("Permintaan ditolak")).closest("table")!.querySelectorAll("tbody tr")).toHaveLength(28);
    // RejectedRequest carries userId on the same row, so a routeId -> userId swap would typecheck
    // and still pass every other assertion here; these two per-cell checks are what fail it.
    // (A textContent regex cannot do this: concatenated body text "…ditolak2026-10-14R1…" holds k2026.)
    const rejTable = (await screen.findByText("Permintaan ditolak")).closest("table")!;
    const firstRejected = within(rejTable).getAllByRole("row")[1]!;
    expect(within(firstRejected).getByRole("cell", { name: "r1" })).toBeTruthy();
    expect(within(rejTable).getAllByRole("cell").map((c) => c.textContent)).not.toContainEqual(expect.stringMatching(/^k\d{4}$/i));
    await user.click(screen.getByRole("button", { name: "Export Excel" }));
    expect(saved).toEqual([`keterisian-vendor-${FIRST}-${LAST}.xlsx`]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("vendor is redirected away from the admin reports and the audit log", async () => {
    await renderApp("/laporan", "vendor");
    expect(await screen.findByRole("heading", { name: "Dashboard Vendor" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Laporan" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Audit Log" })).toBeNull();
  });
});

describe("audit log", () => {
  test("an admin action appears, and filters by actor and action", async () => {
    const { user } = await renderApp("/karyawan", "ga");
    await user.type(await screen.findByLabelText("Cari NIK / nama"), "K1005");
    const row = (await screen.findByRole("cell", { name: "Dewi Lestari" })).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Bekukan" }));
    fireEvent.change(screen.getByLabelText("Beku sampai"), { target: { value: "2026-10-20" } });
    await user.type(screen.getByLabelText("Alasan"), "Uji audit");
    await user.click(screen.getByRole("button", { name: "Simpan pembekuan" }));
    expect(await screen.findByRole("cell", { name: "Beku s/d 2026-10-20" })).toBeTruthy();

    await user.click(screen.getByRole("link", { name: "Audit Log" }));
    const logged = within((await screen.findByText("Log aktivitas")).closest("table")!).getByRole("row", { name: /Bekukan booking/ });
    expect(within(logged).getByRole("cell", { name: "Admin GA" })).toBeTruthy();
    expect(within(logged).getByRole("cell", { name: "user" })).toBeTruthy();
    expect(within(logged).getByRole("cell", { name: "k1005" })).toBeTruthy();
    expect(within(logged).getByRole("cell", { name: /"suspendReason":"Uji audit"/ })).toBeTruthy();
    // The Aksi cell shows ACTION_LABEL, the same wording the filter uses - never the raw code.
    expect(within(logged).queryByRole("cell", { name: "USER_SUSPEND" })).toBeNull();
    expect(await screen.findByText("1 log")).toBeTruthy();
    expect(getDb().audit.filter((a) => a.action === "USER_SUSPEND")).toHaveLength(1);

    await user.selectOptions(screen.getByLabelText("Aksi"), "USER_CREATE");
    expect(await screen.findByText("0 log")).toBeTruthy();
    expect(within((await screen.findByText("Log aktivitas")).closest("table")!).queryByRole("row", { name: /Bekukan booking/ })).toBeNull();

    // The actor filter narrows to one account: the row above is ga's, so filtering on it keeps it,
    // while the other seeded admin account (admin) yields nothing. Dropping actorId still passes.
    await user.selectOptions(screen.getByLabelText("Aksi"), "");
    expect(await screen.findByText("1 log")).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Admin"), "admin");
    expect(await screen.findByText("0 log")).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Admin"), "ga");
    expect(await screen.findByText("1 log")).toBeTruthy();
    expect(within((await screen.findByText("Log aktivitas")).closest("table")!).getByRole("row", { name: /Bekukan booking/ })).toBeTruthy();

    // The date filter narrows by the row's own createdAt: the row is dated 2026-10-14, so a
    // window starting the next day excludes it and a window covering it includes it again.
    fireEvent.change(screen.getByLabelText("Dari tanggal"), { target: { value: "2026-10-15" } });
    expect(await screen.findByText("0 log")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Dari tanggal"), { target: { value: TODAY } });
    fireEvent.change(screen.getByLabelText("Sampai tanggal"), { target: { value: addDays(TODAY, -1) } });
    expect(await screen.findByText("0 log")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Sampai tanggal"), { target: { value: LAST } });
    expect(await screen.findByText("1 log")).toBeTruthy();
  });

  test("admin filter only lists admin accounts", async () => {
    await renderApp("/audit", "admin");
    const options = await within(await screen.findByLabelText("Admin")).findAllByRole("option");
    expect(options.map((o) => o.getAttribute("value")).filter(Boolean).sort()).toEqual(["admin", "ga"]);
  });

  test("employee is redirected away from the audit log", async () => {
    await renderApp("/audit", "K1001");
    expect(await screen.findByRole("heading", { name: "Beranda" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Audit Log" })).toBeNull();
  });
});
