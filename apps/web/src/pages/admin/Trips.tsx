import { useState } from "react";
import { z } from "zod";
import { Bus, ENDPOINTS, Passenger, Route, Shift, Trip } from "@bms/shared";
import { api } from "../../api";
import { DIRECTION_LABEL, ErrorText, downloadXlsx, hhmm, today, useAction, useLoad } from "../../ui";

const CancelDateResponse = z.object({ cancelled: z.number().int() });

/** Manifest for one trip; label is "R1 Pagi Jemput 05:20". */
function Passengers({ trip, label }: { trip: Trip; label: string }) {
  const list = useLoad(() => api.get(ENDPOINTS.tripPassengers(trip.id), z.array(Passenger)), [trip.id]);
  const exportXlsx = () => downloadXlsx(
    (list.data ?? []).map((p) => ({ Jam: hhmm(p.pickupAt), Titik: p.stopName, NIK: p.nik, Nama: p.name, Departemen: p.department, "No HP": p.phone })),
    `penumpang-${label.split(" ")[0]}-${trip.date}-${hhmm(trip.departureAt).replace(":", "")}.xlsx`,
  );
  return (
    <section className="card">
      <ErrorText error={list.error} />
      <table>
        <caption>Penumpang {label}</caption>
        <thead><tr><th>Jam</th><th>Titik</th><th>NIK</th><th>Nama</th><th>Departemen</th><th>No HP</th></tr></thead>
        <tbody>
          {list.data?.map((p) => (
            <tr key={p.bookingId}><td>{hhmm(p.pickupAt)}</td><td>{p.stopName}</td><td>{p.nik}</td><td>{p.name}</td><td>{p.department}</td><td>{p.phone}</td></tr>
          ))}
        </tbody>
      </table>
      <button disabled={!list.data?.length} onClick={exportXlsx}>Export Excel</button>
    </section>
  );
}

/** Spec 6.1 Trip harian: filter, change bus, cancel a trip or a whole date, passenger manifest. */
export function Trips() {
  const [date, setDate] = useState(today());
  const [routeId, setRouteId] = useState("");
  const [shiftId, setShiftId] = useState("");
  const trips = useLoad(
    () => api.get(ENDPOINTS.trips, z.array(Trip), { date, routeId: routeId || undefined, shiftId: shiftId || undefined }),
    [date, routeId, shiftId],
  );
  const lookups = useLoad(() => Promise.all([
    api.get(ENDPOINTS.routes, z.array(Route)), api.get(ENDPOINTS.shifts, z.array(Shift)), api.get(ENDPOINTS.buses, z.array(Bus)),
  ]), []);
  const [routes = [], shifts = [], buses = []] = lookups.data ?? [];
  const [change, setChange] = useState<{ tripId: string; busId: string }>();
  const [confirm, setConfirm] = useState(""); // trip id, or "date"
  const [open, setOpen] = useState<Trip>();
  const [done, setDone] = useState("");
  const { busy, error, run } = useAction();

  const code = (t: Trip) => routes.find((r) => r.id === t.routeId)?.code ?? t.routeId;
  const shiftName = (t: Trip) => shifts.find((s) => s.id === t.shiftId)?.name ?? t.shiftId;
  const plate = (t: Trip) => buses.find((b) => b.id === t.busId)?.plate ?? t.busId;
  const label = (t: Trip) => `${code(t)} ${shiftName(t)} ${DIRECTION_LABEL[t.direction]} ${hhmm(t.departureAt)}`;
  // A mutation invalidates the manifest and the open dialog alike: they belong to the row before it changed.
  const reset = () => { setChange(undefined); setConfirm(""); setOpen(undefined); trips.reload(); };

  async function saveBus() {
    if (change && await run(() => api.put(ENDPOINTS.tripBus(change.tripId), Trip, { busId: change.busId }))) reset();
  }
  async function cancelTrip(id: string) {
    if (await run(() => api.post(ENDPOINTS.tripCancel(id), Trip))) reset();
  }
  async function cancelDate() {
    const res = await run(() => api.post(ENDPOINTS.tripsCancelDate, CancelDateResponse, { date }));
    if (res) { setDone(`${res.cancelled} trip dibatalkan.`); reset(); }
  }

  return (
    <>
      <h1>Trip Harian</h1>
      <ErrorText error={error ?? trips.error ?? lookups.error} />
      {done && <p role="status">{done}</p>}
      <div className="card row">
        <label>Tanggal<input type="date" value={date} onChange={(e) => { setDate(e.target.value); setOpen(undefined); setChange(undefined); setConfirm(""); setDone(""); }} /></label>
        <label>Rute
          <select value={routeId} onChange={(e) => setRouteId(e.target.value)}>
            <option value="">Semua</option>
            {routes.map((r) => <option key={r.id} value={r.id}>{r.code} {r.name}</option>)}
          </select>
        </label>
        <label>Shift
          <select value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
            <option value="">Semua</option>
            {shifts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        {confirm === "date"
          ? <button className="primary" disabled={busy} onClick={() => void cancelDate()}>Ya, batalkan semua trip {date}</button>
          : <button onClick={() => setConfirm("date")}>Batalkan semua trip tanggal ini</button>}
      </div>

      {change && (
        <div className="card row">
          <label>Bus baru
            <select value={change.busId} onChange={(e) => setChange({ ...change, busId: e.target.value })}>
              {buses.filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{b.plate} ({b.capacity})</option>)}
            </select>
          </label>
          <button className="primary" disabled={busy} onClick={() => void saveBus()}>Simpan bus</button>
          <button onClick={() => setChange(undefined)}>Batal</button>
        </div>
      )}

      <p>{trips.data?.length ?? 0} trip</p>
      <table className="card">
        <caption>Daftar trip</caption>
        <thead><tr><th>Jam</th><th>Rute</th><th>Shift</th><th>Arah</th><th>Bus</th><th>Terisi</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {trips.data?.map((t) => (
            <tr key={t.id}>
              <td>{hhmm(t.departureAt)}{t.departureAt.slice(0, 10) !== t.date && " (H+1)"}</td>
              <td>{code(t)}</td><td>{shiftName(t)}</td><td>{DIRECTION_LABEL[t.direction]}</td><td>{plate(t)}</td>
              <td>{t.bookedCount}/{t.capacity}</td>
              <td>{t.status === "CANCELLED" ? "Dibatalkan" : "Terjadwal"}</td>
              <td>
                <button onClick={() => setOpen(t)}>Penumpang</button>
                {/* The server also rejects a departed trip; hiding the affordance beats a verbatim rejection on a row nobody can still act on. */}
                {t.status === "SCHEDULED" && Date.now() < Date.parse(t.departureAt) && (
                  <>
                    <button onClick={() => setChange({ tripId: t.id, busId: t.busId })}>Ganti bus</button>
                    {confirm === t.id
                      ? <button disabled={busy} onClick={() => void cancelTrip(t.id)}>Ya, batalkan</button>
                      : <button onClick={() => setConfirm(t.id)}>Batalkan</button>}
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {open && <Passengers key={open.id} trip={open} label={label(open)} />}
    </>
  );
}
