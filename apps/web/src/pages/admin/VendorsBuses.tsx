import { useState, type FormEvent } from "react";
import { z } from "zod";
import { Bus, BusInput, BusQrResponse, ENDPOINTS, Vendor, VendorInput } from "@bms/shared";
import { api } from "../../api";
import { QrImage } from "../../QrImage";
import { ErrorText, PageHeader, Panel, Stat, StatGrid, YesNo, upsert, useAction, useLoad } from "../../ui";

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
  const [qr, setQr] = useState<BusQrResponse>();
  const [rotateArmed, setRotateArmed] = useState(false);
  const showQr = async (id: string) => { setRotateArmed(false); setQr(await run(() => api.get(ENDPOINTS.busQr(id), BusQrResponse))); };
  const rotate = async () => { if (qr) { setRotateArmed(false); setQr(await run(() => api.post(ENDPOINTS.busQrRotate(qr.busId), BusQrResponse)) ?? qr); } };

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
      <PageHeader title="Vendor & Bus" eyebrow="Data master" description="Perusahaan penyedia armada dan bus yang mereka operasikan. Hanya bus aktif yang bisa dipakai di jadwal trip." />
      <ErrorText error={error ?? vendors.error ?? buses.error} />
      {vendors.data && buses.data && (
        <StatGrid>
          <Stat label="Vendor" value={vendors.data.length} hint={`${vendors.data.filter((v) => v.active).length} aktif`} />
          <Stat label="Bus" value={buses.data.length} hint={`${buses.data.filter((b) => b.active).length} aktif`} tone="accent" />
          <Stat label="Total kapasitas" value={buses.data.reduce((n, b) => n + b.capacity, 0)} hint="kursi seluruh bus" />
          <Stat label="QR check-in" value={buses.data.filter((b) => b.active).length} hint="bus aktif dapat dicetak QR-nya" tone="ok" />
        </StatGrid>
      )}
      {qr && (
        <Panel
          className="editing print-area"
          title={`QR check-in bus ${qr.plate}`}
          description="Tempel di dalam bus. Karyawan memindai QR ini untuk check-in mandiri bila scanner sopir bermasalah. Mengganti QR membuat cetakan lama tidak berlaku."
          actions={<>
            <button onClick={() => window.print()}>Cetak</button>
            {rotateArmed
              ? <button className="danger armed" disabled={busy} onClick={() => void rotate()}>Ya, ganti QR</button>
              : <button className="danger" onClick={() => setRotateArmed(true)}>Ganti QR</button>}
            <button onClick={() => setQr(undefined)}>Tutup</button>
          </>}
        >
          <div className="qr-card">
            <QrImage value={qr.qr} label={`QR check-in bus ${qr.plate}`} />
            <div><strong className="qr-plate">{qr.plate}</strong><p className="muted">Scan untuk check-in · berlaku sejak {qr.rotatedAt.slice(0, 16).replace("T", " ")}</p></div>
          </div>
        </Panel>
      )}
      <div className="grid-2">
        <div className="stack">
          <h2 className="section-title">Vendor</h2>
          <Panel className={v.id ? "editing" : "form"} title={v.id ? `Ubah vendor: ${v.name}` : "Tambah vendor"}>
            <form className="row" onSubmit={saveVendor}>
              <label>Nama vendor<input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required /></label>
              <label>Kontak<input value={v.contact} onChange={(e) => setV({ ...v, contact: e.target.value })} /></label>
              <label><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} />Aktif</label>
              <button className="primary" disabled={busy}>Simpan vendor</button>
              {v.id && <button type="button" onClick={() => setV(NEW_VENDOR)}>Batal</button>}
            </form>
          </Panel>
          <Panel>
            <table>
              <caption>Daftar vendor</caption>
              <thead><tr><th>Nama</th><th>Kontak</th><th>Aktif</th><th></th></tr></thead>
              <tbody>
                {vendors.data?.map((x) => (
                  <tr key={x.id}>
                    <td>{x.name}</td><td>{x.contact}</td><td><YesNo on={x.active} /></td>
                    <td><div className="actions"><button onClick={() => setV({ ...x })}>Ubah</button></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>

        <div className="stack">
          <h2 className="section-title">Bus</h2>
          <Panel className={b.id ? "editing" : "form"} title={b.id ? `Ubah bus: ${b.plate}` : "Tambah bus"}>
            <form className="row" onSubmit={saveBus}>
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
          </Panel>
          <Panel>
            <table>
              <caption>Daftar bus</caption>
              <thead><tr><th>Plat</th><th>Kapasitas</th><th>Vendor</th><th>Aktif</th><th></th></tr></thead>
              <tbody>
                {buses.data?.map((x) => (
                  <tr key={x.id}>
                    <td>{x.plate}</td><td>{x.capacity}</td><td>{vendorName(x.vendorId)}</td><td><YesNo on={x.active} /></td>
                    <td><div className="actions"><button onClick={() => void showQr(x.id)}>QR</button><button onClick={() => setB({ ...x, capacity: String(x.capacity) })}>Ubah</button></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>
      </div>
    </>
  );
}
