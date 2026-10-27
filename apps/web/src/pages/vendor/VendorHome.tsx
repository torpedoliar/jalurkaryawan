import { useState } from "react";
import { z } from "zod";
import { addDays, ENDPOINTS, OccupancyRow, RejectedRequest, Shift } from "@bms/shared";
import { api } from "../../api";
import { DIRECTION_LABEL, ErrorText, PageHeader, Panel, Stat, StatGrid, downloadXlsx, pct, today, useLoad } from "../../ui";

/** Spec 6.3: satu dashboard vendor — keterisian, rute yang sering penuh, permintaan ditolak, semua bisa diekspor. Tanpa data karyawan (peran vendor tidak boleh membaca /api/users). */
export function VendorHome() {
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(addDays(today(), 6));
  const occ = useLoad(() => api.get(ENDPOINTS.occupancy, z.array(OccupancyRow), { from, to }), [from, to]);
  const rejected = useLoad(() => api.get(ENDPOINTS.rejected, z.array(RejectedRequest), { from, to }), [from, to]);
  const lookups = useLoad(() => api.get(ENDPOINTS.shifts, z.array(Shift)), []);
  const shifts = lookups.data ?? [];
  const shiftName = (id: string) => shifts.find((s) => s.id === id)?.name ?? id;
  const exportOcc = () => downloadXlsx(
    (occ.data ?? []).map((r) => ({ Tanggal: r.date, Rute: r.routeCode, "Nama rute": r.routeName, Shift: r.shiftName, Arah: DIRECTION_LABEL[r.direction], Kuota: r.capacity, Terisi: r.booked, "%": pct(r.booked, r.capacity), Ditolak: r.rejected })),
    `keterisian-vendor-${from}-${to}.xlsx`,
  );

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
      <PageHeader
        title="Dashboard Vendor"
        eyebrow="Pantauan"
        description="Keterisian armada, rute yang sering penuh, dan permintaan yang ditolak pada rentang tanggal terpilih."
        actions={
          <>
            <label>Dari tanggal<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label>Sampai tanggal<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          </>
        }
      />
      <ErrorText error={occ.error ?? rejected.error ?? lookups.error} />
      <StatGrid>
        <Stat label="Keterisian armada" value={`${pct(occ.data?.reduce((n, r) => n + r.booked, 0) ?? 0, occ.data?.reduce((n, r) => n + r.capacity, 0) ?? 0)}%`} hint={`${occ.data?.reduce((n, r) => n + r.trips, 0) ?? 0} trip`} tone="accent" />
        <Stat label="Rute sering penuh" value={[...often.values()].filter((e) => e.full >= 2).length} hint="penuh minimal 2 hari" tone="warn" />
        <Stat label="Total ditolak" value={rejected.data?.length ?? 0} hint={`${from} s/d ${to}`} tone={(rejected.data?.length ?? 0) ? "bad" : "ok"} />
        <Stat label="Baris keterisian" value={occ.data?.length ?? 0} hint="rute–shift–arah" />
      </StatGrid>

      <div className="grid-2">
        <Panel>
          <table>
            <caption>Rute yang sering penuh</caption>
            <thead><tr><th>Rute</th><th>Hari penuh</th></tr></thead>
            <tbody>
              {[...often.values()].filter((e) => e.full >= 2).sort((a, b) => b.full - a.full).map((e) => (
                <tr key={e.label}><td>{e.label}</td><td>{e.full} dari {e.days} hari</td></tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel actions={<p className="count">{rejected.data?.length ?? 0} permintaan</p>}>
          <div className="table-scroll"><table>
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
          </table></div>
        </Panel>
      </div>

      <Panel actions={<><p className="count">{occ.data?.length ?? 0} baris</p><button disabled={!occ.data?.length} onClick={exportOcc}>Export Excel</button></>}>
        <div className="table-scroll tall"><table>
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
        </table></div>
      </Panel>
    </>
  );
}
