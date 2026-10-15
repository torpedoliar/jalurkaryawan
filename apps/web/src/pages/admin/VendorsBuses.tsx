import { useState, type FormEvent } from "react";
import { z } from "zod";
import { Bus, BusInput, ENDPOINTS, Vendor, VendorInput } from "@bms/shared";
import { api } from "../../api";
import { ErrorText, upsert, useAction, useLoad } from "../../ui";

const NEW_VENDOR = { id: "", name: "", contact: "", active: true };
const NEW_BUS = { id: "", plate: "", capacity: "50", vendorId: "", active: true };

/** Spec 6.1 master data: vendors and their buses. */
export function VendorsBuses() {
  const vendors = useLoad(() => api.get(ENDPOINTS.vendors, z.array(Vendor)), []);
  const buses = useLoad(() => api.get(ENDPOINTS.buses, z.array(Bus)), []);
  const [v, setV] = useState(NEW_VENDOR);
  const [b, setB] = useState(NEW_BUS);
  const { busy, error, run } = useAction();
  const vendorName = (id: string) => vendors.data?.find((x) => x.id === id)?.name ?? id;

  async function saveVendor(e: FormEvent) {
    e.preventDefault();
    const { id, ...rest } = v;
    if (await run(() => upsert(id, ENDPOINTS.vendors, ENDPOINTS.vendor, Vendor, VendorInput.parse(rest)))) { setV(NEW_VENDOR); vendors.reload(); }
  }
  async function saveBus(e: FormEvent) {
    e.preventDefault();
    const { id, ...rest } = b;
    if (await run(() => upsert(id, ENDPOINTS.buses, ENDPOINTS.bus, Bus, BusInput.parse({ ...rest, capacity: Number(rest.capacity) })))) { setB(NEW_BUS); buses.reload(); }
  }

  return (
    <>
      <h1>Vendor &amp; Bus</h1>
      <ErrorText error={error ?? vendors.error ?? buses.error} />
      <form className="card row" onSubmit={saveVendor}>
        <label>Nama vendor<input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required /></label>
        <label>Kontak<input value={v.contact} onChange={(e) => setV({ ...v, contact: e.target.value })} /></label>
        <label><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} />Aktif</label>
        <button className="primary" disabled={busy}>Simpan vendor</button>
        {v.id && <button type="button" onClick={() => setV(NEW_VENDOR)}>Batal</button>}
      </form>
      <table className="card">
        <caption>Daftar vendor</caption>
        <thead><tr><th>Nama</th><th>Kontak</th><th>Aktif</th><th></th></tr></thead>
        <tbody>
          {vendors.data?.map((x) => (
            <tr key={x.id}>
              <td>{x.name}</td><td>{x.contact}</td><td>{x.active ? "Ya" : "Tidak"}</td>
              <td><button onClick={() => setV({ ...x })}>Ubah</button></td>
            </tr>
          ))}
        </tbody>
      </table>

      <form className="card row" onSubmit={saveBus}>
        <label>Plat<input value={b.plate} onChange={(e) => setB({ ...b, plate: e.target.value })} required /></label>
        <label>Kapasitas<input type="number" min={1} max={100} value={b.capacity} onChange={(e) => setB({ ...b, capacity: e.target.value })} required /></label>
        <label>Vendor
          <select value={b.vendorId} onChange={(e) => setB({ ...b, vendorId: e.target.value })} required>
            <option value="">Pilih</option>
            {vendors.data?.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </label>
        <label><input type="checkbox" checked={b.active} onChange={(e) => setB({ ...b, active: e.target.checked })} />Aktif</label>
        <button className="primary" disabled={busy}>Simpan bus</button>
        {b.id && <button type="button" onClick={() => setB(NEW_BUS)}>Batal</button>}
      </form>
      <table className="card">
        <caption>Daftar bus</caption>
        <thead><tr><th>Plat</th><th>Kapasitas</th><th>Vendor</th><th>Aktif</th><th></th></tr></thead>
        <tbody>
          {buses.data?.map((x) => (
            <tr key={x.id}>
              <td>{x.plate}</td><td>{x.capacity}</td><td>{vendorName(x.vendorId)}</td><td>{x.active ? "Ya" : "Tidak"}</td>
              <td><button onClick={() => setB({ ...x, capacity: String(x.capacity) })}>Ubah</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
