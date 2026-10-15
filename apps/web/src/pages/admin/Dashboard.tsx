import { useState } from "react";
import { addDays, ENDPOINTS, DashboardSummary } from "@bms/shared";
import { api } from "../../api";
import { ErrorText, pct, today, useLoad } from "../../ui";

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
