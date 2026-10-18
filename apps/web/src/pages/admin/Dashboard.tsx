import { useState } from "react";
import { addDays, ENDPOINTS, DashboardSummary } from "@bms/shared";
import { api } from "../../api";
import { ErrorText, pct, today, useLoad } from "../../ui";

/** Bento sparkline; the trend table below stays the accessible source of the numbers. */
function Spark({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const step = 100 / Math.max(1, values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(30 - (v / max) * 28).toFixed(1)}`).join(" ");
  return (
    <svg className="spark" viewBox="0 0 100 32" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Spec 6.1 Dashboard: angka hari ini plus tren booking ditolak 7 hari. */
export function Dashboard() {
  const [date, setDate] = useState(today());
  const summary = useLoad(() => api.get(ENDPOINTS.dashboard, DashboardSummary, { date }), [date]);
  const d = summary.data;

  return (
    <>
      <h1>Dashboard</h1>
      <ErrorText error={summary.error} />
      {d && (
        <>
          <div className="card row">
            <label>Tanggal<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          </div>
          {d.backupWarning && <div className="banner" role="status">{d.backupWarning}</div>}
          <div className="bento" aria-hidden="true">
            <div className="tile"><span className="eyebrow">Trip</span><span className="n">{d.trips}</span></div>
            <div className="tile"><span className="eyebrow">Terisi</span><span className="n">{pct(d.booked, d.capacity)}<small>%</small></span><div className="meter"><i style={{ width: `${pct(d.booked, d.capacity)}%` }} /></div></div>
            <div className={d.fullTrips ? "tile hot" : "tile"}><span className="eyebrow">Trip penuh</span><span className="n">{d.fullTrips}</span></div>
            <div className={d.rejectedToday ? "tile hot" : "tile"}><span className="eyebrow">Ditolak</span><span className="n">{d.rejectedToday}<small> / kmrn {d.rejectedYesterday}</small></span></div>
            <div className="tile wide"><span className="eyebrow">Ditolak 7 hari</span><Spark values={d.rejectedLast7.map((r) => r.count)} /></div>
          </div>
          <table className="card">
            <caption>Ringkasan {d.date}</caption>
            <tbody>
              <tr><th>Trip</th><td>{d.trips}</td></tr>
              <tr><th>Terisi</th><td>{d.booked}/{d.capacity} ({pct(d.booked, d.capacity)}%)</td></tr>
              <tr><th>Trip penuh</th><td>{d.fullTrips}</td></tr>
              {/* Both counts are relative to the requested date, so the label names that date, not "today". */}
              <tr><th>Booking ditolak {d.date}</th><td>{d.rejectedToday}</td></tr>
              <tr><th>Booking ditolak {addDays(d.date, -1)}</th><td>{d.rejectedYesterday}</td></tr>
            </tbody>
          </table>
          <table className="card">
            <caption>Booking ditolak 7 hari terakhir</caption>
            <thead><tr><th>Tanggal</th><th>Ditolak</th></tr></thead>
            <tbody>
              {d.rejectedLast7.map((r) => (
                <tr key={r.date}><td>{r.date}</td><td>{r.count}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
