import { describe, expect, test } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { getDb } from "@bms/mock-api";
import { renderApp } from "./render";

describe("admin master data", () => {
  test("create vendor, then a bus for it with plate upper-cased", async () => {
    const { user } = await renderApp("/vendor-bus", "ga");
    await user.type(await screen.findByLabelText("Nama vendor"), "PT Baru");
    await user.type(screen.getByLabelText("Kontak"), "021-1");
    await user.click(screen.getByRole("button", { name: "Simpan vendor" }));
    expect(await screen.findByRole("cell", { name: "PT Baru" })).toBeTruthy();
    const vendor = getDb().vendors.find((v) => v.name === "PT Baru")!;

    await user.type(screen.getByLabelText("Plat"), "b 9999 zz");
    await user.clear(screen.getByLabelText("Kapasitas"));
    await user.type(screen.getByLabelText("Kapasitas"), "40");
    await user.selectOptions(screen.getByLabelText("Vendor"), vendor.id);
    await user.click(screen.getByRole("button", { name: "Simpan bus" }));
    expect(await screen.findByRole("cell", { name: "B 9999 ZZ" })).toBeTruthy();
    expect(getDb().buses.find((b) => b.plate === "B 9999 ZZ")).toMatchObject({ capacity: 40, vendorId: vendor.id });
  });

  test("edit vendor contact via Ubah", async () => {
    const { user } = await renderApp("/vendor-bus", "ga");
    const row = (await screen.findByRole("cell", { name: "PT Trans Jaya" })).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Ubah" }));
    await user.clear(screen.getByLabelText("Kontak"));
    await user.type(screen.getByLabelText("Kontak"), "021-999");
    await user.click(screen.getByRole("button", { name: "Simpan vendor" }));
    expect(await screen.findByRole("cell", { name: "021-999" })).toBeTruthy();
    expect(getDb().vendors.find((v) => v.id === "v1")!.contact).toBe("021-999");
  });

  test("duplicate plate shows server message", async () => {
    const { user } = await renderApp("/vendor-bus", "ga");
    await user.type(await screen.findByLabelText("Plat"), "B 7101 FX");
    await user.selectOptions(screen.getByLabelText("Vendor"), "v1");
    await user.click(screen.getByRole("button", { name: "Simpan bus" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Plat B 7101 FX sudah terdaftar.");
  });

  test("route stops listed in seq order; add a stop", async () => {
    const { user } = await renderApp("/rute", "ga");
    await user.selectOptions(await screen.findByLabelText("Lihat titik rute"), "r1");
    const stops = await screen.findByRole("table", { name: "Titik jemput" });
    await within(stops).findByText("Terminal Cikarang");
    const names = within(stops).getAllByRole("row").slice(1).map((r) => r.querySelectorAll("td")[1]!.textContent);
    expect(names).toEqual(["Terminal Cikarang", "Pasar Lemahabang", "Simpang Cibarusah"]);

    await user.type(screen.getByLabelText("Nama titik"), "Halte Baru");
    await user.type(screen.getByLabelText("Urutan"), "4");
    await user.type(screen.getByLabelText("Menit dari berangkat"), "45");
    await user.click(screen.getByRole("button", { name: "Simpan titik" }));
    expect(await within(stops).findByText("Halte Baru")).toBeTruthy();
    expect(getDb().stops.find((s) => s.name === "Halte Baru")).toMatchObject({ routeId: "r1", seq: 4, offsetMinutes: 45 });
  });

  test("a stop's coordinates are saved from the manual fields and marked on the map list", async () => {
    const { user } = await renderApp("/rute", "ga");
    await user.selectOptions(await screen.findByLabelText("Lihat titik rute"), "r1");
    const stops = await screen.findByRole("table", { name: "Titik jemput" });
    const row = (await within(stops).findByText("Terminal Cikarang")).closest("tr")!;
    expect(within(row).getByText("Belum dipetakan")).toBeTruthy();
    expect(screen.getByRole("application", { name: "Peta titik jemput" })).toBeTruthy();

    await user.click(within(row).getByRole("button", { name: "Ubah" }));
    await user.type(screen.getByLabelText("Latitude"), "-6.285");
    await user.type(screen.getByLabelText("Longitude"), "107.171");
    await user.click(screen.getByRole("button", { name: "Simpan titik" }));
    expect(await within(row).findByText("Di peta")).toBeTruthy();
    expect(getDb().stops.find((s) => s.name === "Terminal Cikarang")).toMatchObject({ lat: -6.285, lng: 107.171 });
  });

  test("a stop is deleted with confirmation, hidden by default and restorable", async () => {
    const { user } = await renderApp("/rute", "ga");
    await user.selectOptions(await screen.findByLabelText("Lihat titik rute"), "r1");
    const stops = await screen.findByRole("table", { name: "Titik jemput" });
    await within(stops).findByText("Terminal Cikarang");

    await user.type(screen.getByLabelText("Nama titik"), "Halte Sementara");
    await user.type(screen.getByLabelText("Urutan"), "9");
    await user.type(screen.getByLabelText("Menit dari berangkat"), "60");
    await user.click(screen.getByRole("button", { name: "Simpan titik" }));
    const row = (await within(stops).findByText("Halte Sementara")).closest("tr")!;

    await user.click(within(row).getByRole("button", { name: "Hapus" }));
    await user.click(within(row).getByRole("button", { name: "Ya, hapus" }));
    await waitFor(() => expect(within(stops).queryByText("Halte Sementara")).toBeNull());
    expect(getDb().stops.find((s) => s.name === "Halte Sementara")!.active).toBe(false);

    await user.click(screen.getByLabelText("Tampilkan nonaktif"));
    const grey = (await within(stops).findByText("Halte Sementara")).closest("tr")!;
    expect(within(grey).getByText("Tidak")).toBeTruthy();
    await user.click(within(grey).getByRole("button", { name: "Aktifkan" }));
    await waitFor(() => expect(getDb().stops.find((s) => s.name === "Halte Sementara")!.active).toBe(true));
    expect(within(await screen.findByRole("table", { name: "Titik jemput" })).getByText("Halte Sementara")).toBeTruthy();
  });

  test("duplicate route code shows server message", async () => {    const { user } = await renderApp("/rute", "ga");
    await user.type(await screen.findByLabelText("Kode"), "R1");
    await user.type(screen.getByLabelText("Nama rute"), "Lain");
    await user.click(screen.getByRole("button", { name: "Simpan rute" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Kode rute R1 sudah dipakai.");
  });

  test("create shift, then a template using it", async () => {
    const { user } = await renderApp("/shift-jadwal", "ga");
    await user.type(await screen.findByLabelText("Nama shift"), "Lembur");
    fireEvent.change(screen.getByLabelText("Jam mulai"), { target: { value: "18:00" } });
    fireEvent.change(screen.getByLabelText("Jam selesai"), { target: { value: "02:00" } });
    await user.click(screen.getByRole("button", { name: "Simpan shift" }));
    expect(await screen.findByRole("cell", { name: "Lembur" })).toBeTruthy();
    const shift = getDb().shifts.find((s) => s.name === "Lembur")!;

    const before = getDb().templates.length;
    await user.selectOptions(screen.getByLabelText("Rute"), "r2");
    await user.selectOptions(screen.getByLabelText("Shift"), shift.id);
    await user.selectOptions(screen.getByLabelText("Arah"), "PICKUP");
    await user.selectOptions(screen.getByLabelText("Bus"), "b3");
    fireEvent.change(screen.getByLabelText("Jam berangkat"), { target: { value: "17:00" } });
    await user.click(screen.getByRole("button", { name: "Simpan jadwal" }));
    await screen.findByRole("cell", { name: "17:00" });
    expect(getDb().templates.length).toBe(before + 1);
    expect(getDb().templates.at(-1)).toMatchObject({ routeId: "r2", shiftId: shift.id, direction: "PICKUP", busId: "b3", departureTime: "17:00", dayOffset: 0 });
  });

  test("employee cannot open admin pages", async () => {
    await renderApp("/vendor-bus", "K1001");
    expect(await screen.findByRole("heading", { name: "Beranda" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Vendor & Bus" })).toBeNull();
  });
});
