import { useState } from "react";
import { z } from "zod";
import { addDays, Booking, ENDPOINTS, OccupancyRow, Paginated, RejectedRequest, Route, Shift, UserSummary } from "@bms/shared";
import { api } from "../../api";
import { BOOKING_STATUS_TEXT, DIRECTION_LABEL, ErrorText, downloadXlsx, pct, today, useLoad } from "../../ui";

const defaultRange = () => ({ from: today(), to: addDays(today(), 6) });

/** Spec 6.1 Laporan: keterisian, permintaan ditolak, riwayat per karyawan — semuanya bisa diekspor. */
export function Reports() {
  const [from, setFrom] = useState(defaultRange().from);
  const [to, setTo] = useState(defaultRange().to);
  const occ = useLoad(() => api.get(ENDPOINTS.occupancy, z.array(OccupancyRow), { from, to }), [from, to]);
  const rejected = useLoad(() => api.get(ENDPOINTS.rejected, z.array(RejectedRequest), { from, to }), [from, to]);
  const lookups = useLoad(() => Promise.all([
    api.get(ENDPOINTS.routes, z.array(Route)), api.get(ENDPOINTS.shifts, z.array(Shift)),
  ]), []);
  const [routes = [], shifts = []] = lookups.data ?? [];
  const code = (id: string) => routes.find((r) => r.id === id)?.code ?? id;
  const shiftName = (id: string) => shifts.find((s) => s.id === id)?.name ?? id;
  const exportOcc = () => downloadXlsx(
    (occ.data ?? []).map((r) => ({ Tanggal: r.date, Rute: r.routeCode, "Nama rute": r.routeName, Shift: r.shiftName, Arah: DIRECTION_LABEL[r.direction], Trip: r.trips, Kuota: r.capacity, Terisi: r.booked, "%": pct(r.booked, r.capacity), Ditolak: r.rejected })),
    `keterisian-${from}-${to}.xlsx`,
  );
  const exportRejected = () => downloadXlsx(
    (rejected.data ?? []).map((r) => ({ Tanggal: r.date, "ID karyawan": r.userId, Rute: code(r.routeId), Shift: shiftName(r.shiftId), Arah: DIRECTION_LABEL[r.direction], Sumber: r.source === "SUBSCRIPTION" ? "Langganan" : "Harian", Dibuat: r.createdAt })),
    `ditolak-${from}-${to}.xlsx`,
  );

  return (
    <>
      <h1>Laporan</h1>
      <ErrorText error={occ.error ?? rejected.error ?? lookups.error} />
      <div className="card row">
        <label>Dari tanggal<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>Sampai tanggal<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>

      <section className="card">
        <table>
          <caption>Keterisian</caption>
          <thead><tr><th>Tanggal</th><th>Rute</th><th>Shift</th><th>Arah</th><th>Terisi</th><th>Ditolak</th></tr></thead>
          <tbody>
            {occ.data?.map((r) => (
              <tr key={`${r.date}|${r.routeId}|${r.shiftId}|${r.direction}`}>
                <td>{r.date}</td><td>{r.routeCode} {r.routeName}</td><td>{r.shiftName}</td><td>{DIRECTION_LABEL[r.direction]}</td>
                <td>{r.booked}/{r.capacity} ({pct(r.booked, r.capacity)}%)</td><td>{r.rejected}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>{occ.data?.length ?? 0} baris</p>
        <button disabled={!occ.data?.length} onClick={exportOcc}>Export Excel</button>
      </section>

      <section className="card">
        <table>
          <caption>Permintaan ditolak</caption>
          <thead><tr><th>Tanggal</th><th>ID karyawan</th><th>Rute</th><th>Shift</th><th>Arah</th><th>Sumber</th></tr></thead>
          <tbody>
            {rejected.data?.map((r) => (
              <tr key={r.id}>
                <td>{r.date}</td><td>{r.userId}</td><td>{code(r.routeId)}</td><td>{shiftName(r.shiftId)}</td>
                <td>{DIRECTION_LABEL[r.direction]}</td><td>{r.source === "SUBSCRIPTION" ? "Langganan" : "Harian"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>{rejected.data?.length ?? 0} permintaan</p>
        <button disabled={!rejected.data?.length} onClick={exportRejected}>Export Excel</button>
      </section>

      <EmployeeHistory />
    </>
  );
}

/** Spec 6.1: riwayat booking satu karyawan, dipilih lewat pencarian nama/NIK. */
const EmployeeHistory = () => {
  const [term, setTerm] = useState("");
  const [userId, setUserId] = useState("");
  const matches = useLoad(
    () => (term.trim() ? api.get(ENDPOINTS.users, Paginated(UserSummary), { q: term.trim() }) : Promise.resolve(undefined)),
    [term],
  );
  const list = useLoad(
    () => (userId ? api.get(ENDPOINTS.userBookings(userId), z.array(Booking)) : Promise.resolve(undefined)),
    [userId],
  );
  return (
    <section className="card">
      <h2>Riwayat per karyawan</h2>
      <label>Cari karyawan<input value={term} onChange={(e) => { setTerm(e.target.value); setUserId(""); }} /></label>
      {matches.data && (
        <label>Karyawan
          <select value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Pilih karyawan</option>
            {matches.data.items.map((u) => <option key={u.id} value={u.id}>{u.nik} — {u.name}</option>)}
          </select>
        </label>
      )}
      <ErrorText error={matches.error ?? list.error} />
      {list.data && (
        <>
          <table>
            <caption>Riwayat booking</caption>
            <thead><tr><th>Tanggal</th><th>Rute</th><th>Shift</th><th>Arah</th><th>Titik</th><th>Bus</th><th>Jemput</th><th>Status</th></tr></thead>
            <tbody>
              {list.data.map((b) => (
                <tr key={b.id}>
                  <td>{b.date}</td><td>{b.routeCode}</td><td>{b.shiftId}</td><td>{DIRECTION_LABEL[b.direction]}</td>
                  <td>{b.stopName}</td><td>{b.busPlate}</td><td>{b.pickupAt.slice(11, 16)}</td>
                  <td>{BOOKING_STATUS_TEXT[b.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>{list.data.length} booking</p>
          <button disabled={!list.data.length} onClick={() => downloadXlsx(
            list.data!.map((b) => ({ Tanggal: b.date, Rute: b.routeCode, "Nama rute": b.routeName, Shift: b.shiftId, Arah: DIRECTION_LABEL[b.direction], Titik: b.stopName, Bus: b.busPlate, Jemput: b.pickupAt, Status: BOOKING_STATUS_TEXT[b.status], Sumber: b.source === "SUBSCRIPTION" ? "Langganan" : "Harian" })),
            `riwayat-${userId}.xlsx`,
          )}>Export Excel</button>
        </>
      )}
    </section>
  );
};
