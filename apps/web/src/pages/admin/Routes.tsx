import { useState, type FormEvent } from "react";
import { z } from "zod";
import { ENDPOINTS, Route, RouteInput, Stop, StopInput } from "@bms/shared";
import { api } from "../../api";
import { ErrorText, upsert, useAction, useLoad } from "../../ui";

const NEW_ROUTE = { id: "", code: "", name: "", color: "#1F6FD1", active: true };
const NEW_STOP = { id: "", name: "", seq: "", offsetMinutes: "", lat: null as number | null, lng: null as number | null, active: true };

/** Spec 6.1 master data: routes and their ordered stops (seq + minutes after departure). */
export function RoutesStops() {
  const routes = useLoad(() => api.get(ENDPOINTS.routes, z.array(Route)), []);
  const [routeId, setRouteId] = useState("");
  const stops = useLoad(() => (routeId ? api.get(ENDPOINTS.routeStops(routeId), z.array(Stop)) : Promise.resolve([])), [routeId]);
  const [r, setR] = useState(NEW_ROUTE);
  const [s, setS] = useState(NEW_STOP);
  const { busy, error, run } = useAction();

  async function saveRoute(e: FormEvent) {
    e.preventDefault();
    const { id, ...rest } = r;
    if (await run(() => upsert(id, ENDPOINTS.routes, ENDPOINTS.route, Route, RouteInput.parse(rest)))) { setR(NEW_ROUTE); routes.reload(); }
  }
  async function saveStop(e: FormEvent) {
    e.preventDefault();
    const { id, ...rest } = s;
    const body = () => StopInput.parse({ ...rest, seq: Number(rest.seq), offsetMinutes: Number(rest.offsetMinutes) });
    if (await run(() => upsert(id, ENDPOINTS.routeStops(routeId), (x) => ENDPOINTS.stop(routeId, x), Stop, body()))) { setS(NEW_STOP); stops.reload(); }
  }

  return (
    <>
      <h1>Rute &amp; Titik</h1>
      <ErrorText error={error ?? routes.error ?? stops.error} />
      <form className="card row" onSubmit={saveRoute}>
        <label>Kode<input value={r.code} maxLength={10} onChange={(e) => setR({ ...r, code: e.target.value })} required /></label>
        <label>Nama rute<input value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} required /></label>
        <label>Warna<input type="color" value={r.color} onChange={(e) => setR({ ...r, color: e.target.value.toUpperCase() })} /></label>
        <label><input type="checkbox" checked={r.active} onChange={(e) => setR({ ...r, active: e.target.checked })} />Aktif</label>
        <button className="primary" disabled={busy}>Simpan rute</button>
        {r.id && <button type="button" onClick={() => setR(NEW_ROUTE)}>Batal</button>}
      </form>
      <table className="card">
        <caption>Daftar rute</caption>
        <thead><tr><th>Kode</th><th>Nama</th><th>Warna</th><th>Aktif</th><th></th></tr></thead>
        <tbody>
          {routes.data?.map((x) => (
            <tr key={x.id}>
              <td>{x.code}</td><td>{x.name}</td>
              <td><span className="swatch" style={{ background: x.color }} /> {x.color}</td>
              <td>{x.active ? "Ya" : "Tidak"}</td>
              <td><button onClick={() => setR({ ...x })}>Ubah</button></td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="card">
        <label>Lihat titik rute
          <select value={routeId} onChange={(e) => { setRouteId(e.target.value); setS(NEW_STOP); }}>
            <option value="">Pilih</option>
            {routes.data?.map((x) => <option key={x.id} value={x.id}>{x.code} {x.name}</option>)}
          </select>
        </label>
        {routeId && (
          <>
            <table>
              <caption>Titik jemput</caption>
              <thead><tr><th>Urutan</th><th>Nama</th><th>Menit dari berangkat</th><th>Aktif</th><th></th></tr></thead>
              <tbody>
                {stops.data?.map((x) => (
                  <tr key={x.id}>
                    <td>{x.seq}</td><td>{x.name}</td><td>{x.offsetMinutes}</td><td>{x.active ? "Ya" : "Tidak"}</td>
                    <td><button onClick={() => setS({ ...x, seq: String(x.seq), offsetMinutes: String(x.offsetMinutes) })}>Ubah</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <form className="row" onSubmit={saveStop}>
              <label>Nama titik<input value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} required /></label>
              <label>Urutan<input type="number" min={1} value={s.seq} onChange={(e) => setS({ ...s, seq: e.target.value })} required /></label>
              <label>Menit dari berangkat<input type="number" min={0} max={300} value={s.offsetMinutes} onChange={(e) => setS({ ...s, offsetMinutes: e.target.value })} required /></label>
              <label><input type="checkbox" checked={s.active} onChange={(e) => setS({ ...s, active: e.target.checked })} />Aktif</label>
              <button className="primary" disabled={busy}>Simpan titik</button>
              {s.id && <button type="button" onClick={() => setS(NEW_STOP)}>Batal</button>}
            </form>
          </>
        )}
      </section>
    </>
  );
}
