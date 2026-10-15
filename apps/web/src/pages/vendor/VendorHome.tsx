import { useState } from "react";
import { z } from "zod";
import { addDays, ENDPOINTS, OccupancyRow, RejectedRequest, Shift } from "@bms/shared";
import { api } from "../../api";
import { DIRECTION_LABEL, ErrorText, downloadXlsx, pct, today, useLoad } from "../../ui";

/** Spec 6.3: satu dashboard vendor — keterisian, rute yang sering penuh, permintaan ditolak, semua bisa diekspor. Tanpa data karyawan (peran vendor tidak boleh membaca /api/users). */
export function VendorHome() {
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(addDays(today(), 6));
  const occ = useLoad(() => api.get(ENDPOINTS.occupancy, z.array(OccupancyRow), { from, to }), [from, to]);
  const rejected = useLoad(() => api.get(ENDPOINTS.rejected, z.array(RejectedRequest), { from, to }), [from, to]);
  const lookups = useLoad(() => api.get(ENDPOINTS.shifts, z.array(Shift)), []);
  const shifts = lookups.data ?? [];
  const shiftName = (id: string) => shifts.find((s) => s.id === id)?.name ?? id;

  const often = new Map<string, { label: string; full: number; days: number }>();
  for (const r of occ.data ?? []) {
    const label = `${r.routeCode} ${r.routeName} ${r.shiftName} ${DIRECTION_LABEL[r.direction]}`;
    const e = often.get(label) ?? { label, full: 0, days: 0 };
    e.days++;
    if (r.booked >= r.capacity) e.full++;
    often.set(label, e);
  }

  return (
    <>
      <h1>Dashboard Vendor</h1>
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
        <button disabled={!occ.data?.length} onClick={() => downloadXlsx(
          (occ.data ?? []).map((r) => ({ Tanggal: r.date, Rute: r.routeCode, "Nama rute": r.routeName, Shift: r.shiftName, Arah: DIRECTION_LABEL[r.direction], Kuota: r.capacity, Terisi: r.booked, "%": pct(r.booked, r.capacity), Ditolak: r.rejected })),
          `keterisian-vendor-${from}-${to}.xlsx`,
        )}>Export Excel</button>
      </section>

      <section className="card">
        <table>
          <caption>Rute yang sering penuh</caption>
          <thead><tr><th>Rute</th><th>Hari penuh</th></tr></thead>
          <tbody>
            {[...often.values()].filter((e) => e.full >= 2).sort((a, b) => b.full - a.full).map((e) => (
              <tr key={e.label}><td>{e.label}</td><td>{e.full} dari {e.days} hari</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <table>
          <caption>Permintaan ditolak</caption>
          <thead><tr><th>Tanggal</th><th>Rute</th><th>Shift</th><th>Arah</th><th>Sumber</th></tr></thead>
          <tbody>
            {rejected.data?.map((r) => (
              <tr key={r.id}>
                <td>{r.date}</td><td>{r.routeId}</td><td>{shiftName(r.shiftId)}</td><td>{DIRECTION_LABEL[r.direction]}</td>
                <td>{r.source === "SUBSCRIPTION" ? "Langganan" : "Harian"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>{rejected.data?.length ?? 0} permintaan</p>
      </section>
    </>
  );
}
