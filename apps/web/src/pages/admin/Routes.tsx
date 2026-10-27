import { useState, type FormEvent } from "react";
import { z } from "zod";
import { ENDPOINTS, Route, RouteInput, Stop, StopInput } from "@bms/shared";
import { api } from "../../api";
import { RouteMap } from "../../RouteMap";
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
  const { busy, error, run } = useAction();
  const selected = routes.data?.find((x) => x.id === routeId);
  const unplaced = stops.data?.filter((x) => x.lat === null || x.lng === null).length ?? 0;

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
  const edit = (x: Stop) => setS({ ...x, seq: String(x.seq), offsetMinutes: String(x.offsetMinutes), lat: x.lat === null ? "" : String(x.lat), lng: x.lng === null ? "" : String(x.lng) });

  return (
    <>
      <PageHeader title="Rute & Titik" eyebrow="Data master" description="Rute bus beserta titik jemputnya. Menit dari berangkat menentukan jam jemput di tiap titik." />
      <ErrorText error={error ?? routes.error ?? stops.error} />
      <StatGrid>
        <Stat label="Rute" value={routes.data?.length ?? 0} hint={`${routes.data?.filter((r) => r.active).length ?? 0} aktif`} />
        <Stat label="Titik rute terpilih" value={routeId ? (stops.data?.length ?? 0) : "—"} hint={routeId ? "titik jemput terdaftar" : "pilih rute di bawah"} tone="accent" />
        <Stat label="Sudah dipetakan" value={routeId ? (stops.data?.filter((x) => x.lat !== null).length ?? 0) : "—"} hint="memiliki koordinat" tone="ok" />
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
            <label>Lihat titik rute
              <select value={routeId} onChange={(e) => { setRouteId(e.target.value); setS(NEW_STOP); }}>
                <option value="">Pilih</option>
                {routes.data?.map((x) => <option key={x.id} value={x.id}>{x.code} {x.name}</option>)}
              </select>
            </label>
            {!routeId && <p className="empty-note">Pilih rute untuk melihat dan mengelola titik jemputnya.</p>}
            {routeId && (
              <table>
                <caption>Titik jemput</caption>
                <thead><tr><th>Urutan</th><th>Nama</th><th>Menit dari berangkat</th><th>Lokasi</th><th>Aktif</th><th></th></tr></thead>
                <tbody>
                  {stops.data?.map((x) => (
                    <tr key={x.id}>
                      <td>{x.seq}</td><td>{x.name}</td><td>{x.offsetMinutes}</td>
                      <td>{x.lat === null ? <span className="pill warn">Belum dipetakan</span> : <span className="pill ok">Di peta</span>}</td>
                      <td><YesNo on={x.active} /></td>
                      <td><div className="actions"><button onClick={() => edit(x)}>Ubah</button></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>
      </div>

      {routeId && (
        <>
          <h2 className="section-title">Peta {selected ? `${selected.code} ${selected.name}` : "rute"}</h2>
          {unplaced > 0 && <p className="muted">{unplaced} titik belum memiliki lokasi. Pilih Ubah pada titik itu, lalu klik peta.</p>}
          <div className="map-layout">
            <RouteMap
              stops={stops.data ?? []}
              color={selected?.color ?? "#1F6FD1"}
              draft={{ id: s.id, lat: coord(s.lat), lng: coord(s.lng) }}
              onPick={(p) => setS((cur) => ({ ...cur, lat: String(p.lat), lng: String(p.lng) }))}
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
