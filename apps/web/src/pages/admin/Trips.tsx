import { useState } from "react";
import { z } from "zod";
import { Bus, BusPosition, ENDPOINTS, Paginated, Passenger, Route, Shift, Trip, TripAttendanceRow, UserSummary, type CheckinMethod } from "@bms/shared";
import { api } from "../../api";
import { DIRECTION_LABEL, ErrorText, PageHeader, Panel, Stat, StatGrid, downloadXlsx, hhmm, pct, today, useAction, useLoad } from "../../ui";

const CancelDateResponse = z.object({ cancelled: z.number().int() });
export const METHOD_LABEL: Record<CheckinMethod, string> = {
  DRIVER_SCANNER: "Scanner sopir", DRIVER_CAMERA: "Kamera sopir", EMPLOYEE_BUS_QR: "Scan QR bus", ADMIN_MANUAL: "Manual admin",
};

/** Manifest for one trip; label is "R1 Pagi Jemput 05:20". */
function Passengers({ trip, label, vendorId, onClose }: { trip: Trip; label: string; vendorId?: string; onClose(): void }) {
  const list = useLoad(() => api.get(ENDPOINTS.tripPassengers(trip.id), z.array(Passenger)), [trip.id]);
  const attendance = useLoad(() => api.get(ENDPOINTS.tripAttendance(trip.id), z.array(TripAttendanceRow)), [trip.id]);
  const att = (id: string) => attendance.data?.find((a) => a.bookingId === id);
  const boarded = attendance.data?.length ?? 0;
  // The bus's vendor scopes who may drive it; the tracking row carries the currently assigned driver.
  const drivers = useLoad(() => api.get(ENDPOINTS.users, Paginated(UserSummary), { role: "DRIVER" }).then((r) => r.items.filter((d) => d.active && d.vendorId === vendorId)), [vendorId]);
  const current = useLoad(() => api.get(ENDPOINTS.tracking, z.array(BusPosition), { date: trip.date }).then((r) => r.find((x) => x.tripId === trip.id)?.driverName ?? null), [trip.id]);
  const [driverId, setDriverId] = useState("");
  const assign = useAction();
  async function saveDriver() {
    if (await assign.run(() => api.put(ENDPOINTS.tripDriver(trip.id), Trip, { driverId: driverId || null }))) { setDriverId(""); current.reload(); }
  }
  const exportXlsx = () => downloadXlsx(
    (list.data ?? []).map((p) => ({ Jam: hhmm(p.pickupAt), Titik: p.stopName, NIK: p.nik, Nama: p.name, Departemen: p.department, "No HP": p.phone, "Check-in": att(p.bookingId) ? hhmm(att(p.bookingId)!.checkedInAt) : "", Cara: att(p.bookingId) ? METHOD_LABEL[att(p.bookingId)!.method] : "" })),
    `penumpang-${label.split(" ")[0]}-${trip.date}-${hhmm(trip.departureAt).replace(":", "")}.xlsx`,
  );
  return (
    <Panel
      className="editing"
      title={`Manifest penumpang ${label}`}
      description={list.data ? `${boarded} dari ${list.data.length} penumpang sudah check-in.` : undefined}
      actions={<><button disabled={!list.data?.length} onClick={exportXlsx}>Export Excel</button><button onClick={onClose}>Tutup</button></>}
    >
      <ErrorText error={list.error ?? attendance.error ?? assign.error ?? drivers.error ?? current.error} />
      {trip.status === "SCHEDULED" && (
        <div className="row">
          <p className="muted">Sopir: <strong>{current.data ?? "belum ditugaskan"}</strong></p>
          <label>Tugaskan sopir
            <select value={driverId} onChange={(e) => setDriverId(e.target.value)}>
              <option value="">Tanpa sopir</option>
              {drivers.data?.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.nik})</option>)}
            </select>
          </label>
          <button disabled={assign.busy} onClick={() => void saveDriver()}>Simpan sopir</button>
        </div>
      )}
      <table>
        <caption>Penumpang {label}</caption>
        <thead><tr><th>Jam</th><th>Titik</th><th>NIK</th><th>Nama</th><th>Departemen</th><th>No HP</th><th>Check-in</th></tr></thead>
        <tbody>
          {list.data?.map((p) => (
            <tr key={p.bookingId}><td>{hhmm(p.pickupAt)}</td><td>{p.stopName}</td><td>{p.nik}</td><td>{p.name}</td><td>{p.department}</td><td>{p.phone}</td>
              <td className={att(p.bookingId) ? "st-ok" : undefined}>{att(p.bookingId) ? `${hhmm(att(p.bookingId)!.checkedInAt)} · ${METHOD_LABEL[att(p.bookingId)!.method]}` : "Belum"}</td></tr>
          ))}
        </tbody>
      </table>
      {list.data?.length === 0 && <p className="empty-note">Belum ada penumpang.</p>}
    </Panel>
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
  /** A filter change also drops every row-scoped panel: it would be bound to a trip nobody can see. */
  const clear = () => { setChange(undefined); setConfirm(""); setOpen(undefined); setDone(""); };

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

  const changing = change && trips.data?.find((t) => t.id === change.tripId);
  return (
    <>
      <PageHeader
        title="Trip Harian"
        eyebrow="Operasional"
        description="Trip yang berjalan pada satu tanggal: lihat manifest penumpang, ganti bus, atau batalkan."
        actions={
          <>
            <label>Tanggal<input type="date" value={date} onChange={(e) => { setDate(e.target.value); clear(); }} /></label>
            <label>Rute
              <select value={routeId} onChange={(e) => { setRouteId(e.target.value); clear(); }}>
                <option value="">Semua</option>
                {routes.map((r) => <option key={r.id} value={r.id}>{r.code} {r.name}</option>)}
              </select>
            </label>
            <label>Shift
              <select value={shiftId} onChange={(e) => { setShiftId(e.target.value); clear(); }}>
                <option value="">Semua</option>
                {shifts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          </>
        }
      />
      <ErrorText error={error ?? trips.error ?? lookups.error} />
      {done && <p role="status">{done}</p>}
      {trips.data && <StatGrid>
        <Stat label="Trip" value={trips.data.length} hint={`${trips.data.filter((t) => t.status === "SCHEDULED").length} terjadwal`} />
        <Stat label="Kursi terisi" value={trips.data.reduce((n, t) => n + t.bookedCount, 0)} hint={`dari ${trips.data.reduce((n, t) => n + t.capacity, 0)} kursi`} tone="accent" />
        <Stat label="Trip penuh" value={trips.data.filter((t) => t.bookedCount >= t.capacity).length} hint="tidak bisa menerima booking" tone={trips.data.some((t) => t.bookedCount >= t.capacity) ? "warn" : "ok"} />
        <Stat label="Dibatalkan" value={trips.data.filter((t) => t.status === "CANCELLED").length} hint="tidak beroperasi" tone={trips.data.some((t) => t.status === "CANCELLED") ? "bad" : "ok"} />
      </StatGrid>}

      {change && (
        <Panel className="editing" title="Ganti bus">
          <div className="row">
            {/* A filter or page change closes this panel; while it is open it must name its trip. */}
            <strong>{changing ? label(changing) : ""}</strong>
            <label>Bus baru
              <select value={change.busId} onChange={(e) => setChange({ ...change, busId: e.target.value })}>
                {buses.filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{b.plate} ({b.capacity})</option>)}
              </select>
            </label>
            <button className="primary" disabled={busy} onClick={() => void saveBus()}>Simpan bus</button>
            <button onClick={() => setChange(undefined)}>Batal</button>
          </div>
        </Panel>
      )}

      {open && <Passengers key={open.id} trip={open} label={label(open)} vendorId={buses.find((b) => b.id === open.busId)?.vendorId} onClose={() => setOpen(undefined)} />}

      <Panel>
        <div className="toolbar">
          <p className="count">{trips.data?.length ?? 0} trip</p>
        </div>
        <div className="table-scroll tall"><table>
          <caption>Daftar trip</caption>
          <thead><tr><th>Jam</th><th>Rute</th><th>Shift</th><th>Arah</th><th>Bus</th><th>Terisi</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {trips.data?.map((t) => (
              <tr key={t.id}>
                <td>{hhmm(t.departureAt)}{t.departureAt.slice(0, 10) !== t.date && " (H+1)"}</td>
                <td>{code(t)}</td><td>{shiftName(t)}</td><td>{DIRECTION_LABEL[t.direction]}</td><td>{plate(t)}</td>
                <td>{t.bookedCount}/{t.capacity} <span className="load-pct">{pct(t.bookedCount, t.capacity)}%</span><div className="meter cell-meter"><i style={{ width: `${pct(t.bookedCount, t.capacity)}%` }} /></div></td>
                <td><span className={t.status === "CANCELLED" ? "pill bad" : "pill ok"}>{t.status === "CANCELLED" ? "Dibatalkan" : "Terjadwal"}</span></td>
                <td>
                  <div className="actions">
                    <button aria-pressed={open?.id === t.id} onClick={() => setOpen(t)}>Penumpang</button>
                    {/* The server also rejects a departed trip; hiding the affordance beats a verbatim rejection on a row nobody can still act on. */}
                    {t.status === "SCHEDULED" && Date.now() < Date.parse(t.departureAt) && (
                      <>
                        <button onClick={() => setChange({ tripId: t.id, busId: t.busId })}>Ganti bus</button>
                        {confirm === t.id
                          ? <button className="danger armed" disabled={busy} onClick={() => void cancelTrip(t.id)}>Ya, batalkan</button>
                          : <button className="danger" onClick={() => setConfirm(t.id)}>Batalkan</button>}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </Panel>

      <Panel className="danger-zone" title="Batalkan semua trip" description="Membatalkan seluruh trip pada tanggal terpilih, untuk semua rute dan shift (mis. hari libur mendadak).">
        <div className="row">
          {/* The request carries only the date, so the label must name every route and shift it hits. */}
          {confirm === "date"
            ? <>
                <button className="danger armed" disabled={busy} onClick={() => void cancelDate()}>Ya, batalkan semua trip {date} (semua rute &amp; shift)</button>
                <button onClick={() => setConfirm("")}>Batal</button>
              </>
            : <button className="danger" onClick={() => setConfirm("date")}>Batalkan semua trip {date} (semua rute &amp; shift)</button>}
        </div>
      </Panel>
    </>
  );
}
