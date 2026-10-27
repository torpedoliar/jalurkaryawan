import { useState, type FormEvent } from "react";
import { z } from "zod";
import { ENDPOINTS, Route, RouteInput, Stop, StopInput } from "@bms/shared";
import { api } from "../../api";
import { RouteMap, type LatLng } from "../../RouteMap";
import { ErrorText, PageHeader, Panel, Stat, StatGrid, YesNo, upsert, useAction, useLoad } from "../../ui";

const NEW_ROUTE = { id: "", code: "", name: "", color: "#1F6FD1", active: true };
/** lat/lng are text while typing so a half-typed "-6." is not coerced; empty means "no coordinate". */
const NEW_STOP = { id: "", name: "", seq: "", offsetMinutes: "", lat: "", lng: "", active: true };
const coord = (v: string) => (v.trim() === "" ? null : Number(v));

/** Spec 6.1 master data: routes and their ordered stops (seq + minutes after departure), placed on a map. */
export function RoutesStops() {
  const routes = useLoad(() => api.get(ENDPOINTS.routes, z.array(Route)), []);
  const [routeId, setRouteId] = useState("");
  const stops = useLoad(() => (routeId ? api.get(ENDPOINTS.routeStops(routeId), z.array(Stop)) : Promise.resolve([])), [routeId]);
  const [r, setR] = useState(NEW_ROUTE);
  const [s, setS] = useState(NEW_STOP);
  const [showInactive, setShowInactive] = useState(false);
  const [confirmStop, setConfirmStop] = useState(""); // stop id armed for deletion
  const [redraw, setRedraw] = useState(0); // bumps when a drag save fails so the pin snaps back
  const { busy, error, run } = useAction();
  const selected = routes.data?.find((x) => x.id === routeId);
  const all = stops.data ?? [];
  const visible = all.filter((x) => showInactive || x.active);
  const inactive = all.length - all.filter((x) => x.active).length;
  const unplaced = visible.filter((x) => x.lat === null || x.lng === null).length;

  async function saveRoute(e: FormEvent) {
    e.preventDefault();
    const { id, ...rest } = r;
    if (await run(() => upsert(id, ENDPOINTS.routes, ENDPOINTS.route, Route, RouteInput.parse(rest)))) { setR(NEW_ROUTE); routes.reload(); }
  }
  async function saveStop(e: FormEvent) {
    e.preventDefault();
    const { id, ...rest } = s;
    const body = () => StopInput.parse({ ...rest, seq: Number(rest.seq), offsetMinutes: Number(rest.offsetMinutes), lat: coord(rest.lat), lng: coord(rest.lng) });
    if (await run(() => upsert(id, ENDPOINTS.routeStops(routeId), (x) => ENDPOINTS.stop(routeId, x), Stop, body()))) { setS(NEW_STOP); stops.reload(); }
  }
  const edit = (x: Stop) => { setS({ ...x, seq: String(x.seq), offsetMinutes: String(x.offsetMinutes), lat: x.lat === null ? "" : String(x.lat), lng: x.lng === null ? "" : String(x.lng) }); setConfirmStop(""); };
  const stopBody = (x: Stop, p: { lat: number | null; lng: number | null }, active: boolean) => StopInput.parse({ name: x.name, seq: x.seq, offsetMinutes: x.offsetMinutes, lat: p.lat, lng: p.lng, active });

  /** A dropped pin is a real edit: put the same stop back with its new coordinates. */
  async function moveStop(x: Stop, p: LatLng) {
    if (x.id === s.id) { setS((cur) => ({ ...cur, lat: String(p.lat), lng: String(p.lng) })); return; }
    const saved = await run(() => api.put(ENDPOINTS.stop(routeId, x.id), Stop, stopBody(x, p, x.active)));
    if (saved) stops.reload(); else setRedraw((n) => n + 1);
  }
  async function removeStop(x: Stop) {
    setConfirmStop("");
    if (await run(() => api.del(ENDPOINTS.stop(routeId, x.id), Stop))) {
      if (s.id === x.id) setS(NEW_STOP);
      stops.reload();
    }
  }
  async function reactivate(x: Stop) {
    if (await run(() => api.put(ENDPOINTS.stop(routeId, x.id), Stop, stopBody(x, x, true)))) stops.reload();
  }

  return (
    <>
      <PageHeader title="Rute & Titik" eyebrow="Data master" description="Rute bus beserta titik jemputnya. Menit dari berangkat menentukan jam jemput di tiap titik." />
      <ErrorText error={error ?? routes.error ?? stops.error} />
      <StatGrid>
        <Stat label="Rute" value={routes.data?.length ?? 0} hint={`${routes.data?.filter((r) => r.active).length ?? 0} aktif`} />
        <Stat label="Titik rute terpilih" value={routeId ? visible.length : "—"} hint={routeId ? (inactive ? `ditampilkan · ${inactive} nonaktif` : "titik jemput terdaftar") : "pilih rute di bawah"} tone="accent" />
        <Stat label="Sudah dipetakan" value={routeId ? visible.filter((x) => x.lat !== null).length : "—"} hint="memiliki koordinat" tone="ok" />
        <Stat label="Belum dipetakan" value={routeId ? unplaced : "—"} hint="perlu klik peta atau koordinat" tone={unplaced ? "warn" : "ok"} />
      </StatGrid>
      <div className="grid-2">
        <div className="stack">
          <h2 className="section-title">Rute</h2>
          <Panel className={r.id ? "editing" : "form"} title={r.id ? `Ubah rute: ${r.code}` : "Tambah rute"}>
            <form className="row" onSubmit={saveRoute}>
              <label>Kode<input value={r.code} maxLength={10} size={6} onChange={(e) => setR({ ...r, code: e.target.value })} required /></label>
              <label>Nama rute<input value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} required /></label>
              <label>Warna<input type="color" value={r.color} onChange={(e) => setR({ ...r, color: e.target.value.toUpperCase() })} /></label>
              <label><input type="checkbox" checked={r.active} onChange={(e) => setR({ ...r, active: e.target.checked })} />Aktif</label>
              <button className="primary" disabled={busy}>Simpan rute</button>
              {r.id && <button type="button" onClick={() => setR(NEW_ROUTE)}>Batal</button>}
            </form>
          </Panel>
          <Panel>
            <table>
              <caption>Daftar rute</caption>
              <thead><tr><th>Kode</th><th>Nama</th><th>Warna</th><th>Aktif</th><th></th></tr></thead>
              <tbody>
                {routes.data?.map((x) => (
                  <tr key={x.id}>
                    <td><span className="code-chip">{x.code}</span></td><td><span className="route-stack" title={x.name}><b>{x.name.split(" → ")[0]}</b>{x.name.includes(" → ") && <small>{x.name.split(" → ").slice(1).join(" → ")}</small>}</span></td>
                    <td><span className="swatch" style={{ background: x.color }} /> {x.color}</td>
                    <td><YesNo on={x.active} /></td>
                    <td><div className="actions"><button onClick={() => setR({ ...x })}>Ubah</button></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>

        <div className="stack">
          <h2 className="section-title">Titik jemput</h2>
          <Panel>
            <div className="row">
              <label>Lihat titik rute
                <select value={routeId} onChange={(e) => { setRouteId(e.target.value); setS(NEW_STOP); setConfirmStop(""); }}>
                  <option value="">Pilih</option>
                  {routes.data?.map((x) => <option key={x.id} value={x.id}>{x.code} {x.name}</option>)}
                </select>
              </label>
              {routeId && (
                <label><input type="checkbox" checked={showInactive} onChange={(e) => { setShowInactive(e.target.checked); setConfirmStop(""); }} />Tampilkan nonaktif</label>
              )}
            </div>
            {!routeId && <p className="empty-note">Pilih rute untuk melihat dan mengelola titik jemputnya.</p>}
            {routeId && visible.length === 0 && <p className="empty-note">Tidak ada titik jemput aktif pada rute ini. Tambah titik di bawah{inactive ? " atau tampilkan titik nonaktif" : ""}.</p>}
            {routeId && (
              <table>
                <caption>Titik jemput</caption>
                <thead><tr><th>Urutan</th><th>Nama</th><th>Menit dari berangkat</th><th>Lokasi</th><th>Aktif</th><th></th></tr></thead>
                <tbody>
                  {visible.map((x) => (
                    <tr key={x.id}>
                      <td>{x.seq}</td><td>{x.name}</td><td>{x.offsetMinutes}</td>
                      <td>{x.lat === null ? <span className="pill warn">Belum dipetakan</span> : <span className="pill ok">Di peta</span>}</td>
                      <td><YesNo on={x.active} /></td>
                      <td>
                        <div className="actions">
                          {confirmStop === x.id ? (
                            <>
                              <button className="danger armed" disabled={busy} onClick={() => void removeStop(x)}>Ya, hapus</button>
                              <button onClick={() => setConfirmStop("")}>Batal</button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => edit(x)}>Ubah</button>
                              {x.active
                                ? <button className="danger" disabled={busy} onClick={() => setConfirmStop(x.id)}>Hapus</button>
                                : <button disabled={busy} onClick={() => void reactivate(x)}>Aktifkan</button>}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {routeId && (
              <p className="muted">
                Hapus menonaktifkan titik; riwayat booking dan langganan lama tetap tersimpan. Titik yang masih dipakai langganan aktif atau booking yang belum berangkat tidak bisa dihapus.
                {inactive > 0 && !showInactive && ` ${inactive} titik nonaktif disembunyikan.`}
              </p>
            )}
          </Panel>
        </div>
      </div>

      {routeId && (
        <>
          <h2 className="section-title">Peta {selected ? `${selected.code} ${selected.name}` : "rute"}</h2>
          {unplaced > 0 && <p className="muted">{unplaced} titik belum memiliki lokasi. Pilih Ubah pada titik itu, lalu klik peta.</p>}
          {busy && <p className="muted">Menyimpan perubahan…</p>}
          <div className="map-layout">
            <RouteMap
              stops={all}
              color={selected?.color ?? "#1F6FD1"}
              draft={{ id: s.id, lat: coord(s.lat), lng: coord(s.lng) }}
              showInactive={showInactive}
              redraw={redraw}
              onPick={(p) => setS((cur) => ({ ...cur, lat: String(p.lat), lng: String(p.lng) }))}
              onMove={(id, p) => { const x = all.find((y) => y.id === id); if (x) void moveStop(x, p); }}
              onSelect={(id) => { const x = all.find((y) => y.id === id); if (x) edit(x); }}
            />
            <Panel className={s.id ? "editing" : "form"} title={s.id ? `Ubah titik: ${s.name}` : `Tambah titik ke ${selected?.code ?? "rute"}`}>
              <form className="stack" onSubmit={saveStop}>
                <label>Nama titik<input value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} required /></label>
                <div className="row">
                  <label>Urutan<input type="number" min={1} value={s.seq} onChange={(e) => setS({ ...s, seq: e.target.value })} required /></label>
                  <label>Menit dari berangkat<input type="number" min={0} max={300} value={s.offsetMinutes} onChange={(e) => setS({ ...s, offsetMinutes: e.target.value })} required /></label>
                </div>
                <div className="row">
                  <label>Latitude<input inputMode="decimal" value={s.lat} placeholder="-6.300000" onChange={(e) => setS({ ...s, lat: e.target.value })} /></label>
                  <label>Longitude<input inputMode="decimal" value={s.lng} placeholder="107.150000" onChange={(e) => setS({ ...s, lng: e.target.value })} /></label>
                  {(s.lat || s.lng) && <button type="button" onClick={() => setS({ ...s, lat: "", lng: "" })}>Hapus lokasi</button>}
                </div>
                <label><input type="checkbox" checked={s.active} onChange={(e) => setS({ ...s, active: e.target.checked })} />Aktif</label>
                <div className="row">
                  <button className="primary" disabled={busy}>Simpan titik</button>
                  {s.id && <button type="button" onClick={() => setS(NEW_STOP)}>Batal</button>}
                </div>
              </form>
            </Panel>
          </div>
        </>
      )}
    </>
  );
}
