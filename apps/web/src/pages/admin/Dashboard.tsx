import { useState } from "react";
import { z } from "zod";
import { addDays, ENDPOINTS, DashboardSummary, OccupancyRow } from "@bms/shared";
import { api } from "../../api";
import { DIRECTION_LABEL, ErrorText, PageHeader, Panel, pct, today, useLoad } from "../../ui";

const longDate = (date: string) => new Date(`${date}T12:00:00+07:00`).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const shortDay = (date: string) => new Date(`${date}T12:00:00+07:00`).toLocaleDateString("id-ID", { weekday: "short", day: "numeric" });
const signed = (n: number) => `${n > 0 ? "+" : ""}${n}`;

/** Ring gauge; the numbers beside it carry the same value, so the SVG itself is decorative. */
function Gauge({ value }: { value: number }) {
  const capped = Math.min(100, Math.max(0, value));
  const tone = capped >= 90 ? "full" : capped >= 70 ? "warn" : "ok";
  return (
    <div className={`dash-gauge ${tone}`} role="img" aria-label={`Keterisian ${value} persen`}>
      <svg viewBox="0 0 36 36" aria-hidden="true">
        <circle className="gauge-track" cx="18" cy="18" r="15.5" pathLength={100} />
        <circle className="gauge-value" cx="18" cy="18" r="15.5" pathLength={100} strokeDasharray={`${capped} ${100 - capped}`} />
      </svg>
      <div><b>{value}%</b><span>keterisian</span></div>
    </div>
  );
}

/** Spec 6.1 Dashboard: angka hari ini plus tren booking ditolak 7 hari. */
export function Dashboard() {
  const [date, setDate] = useState(today());
  const summary = useLoad(() => api.get(ENDPOINTS.dashboard, DashboardSummary, { date }), [date]);
  const occupancy = useLoad(() => api.get(ENDPOINTS.occupancy, z.array(OccupancyRow), { from: date, to: date }), [date]);
  const d = summary.data;

  const routes = Object.values((occupancy.data ?? []).reduce<Record<string, { id: string; code: string; name: string; color: string; booked: number; capacity: number; trips: number }>>((acc, r) => {
    const row = acc[r.routeId] ?? { id: r.routeId, code: r.routeCode, name: r.routeName, color: r.routeColor, booked: 0, capacity: 0, trips: 0 };
    row.booked += r.booked; row.capacity += r.capacity; row.trips += r.trips; acc[r.routeId] = row;
    return acc;
  }, {})).sort((a, b) => pct(b.booked, b.capacity) - pct(a.booked, a.capacity) || b.booked - a.booked).slice(0, 5);
  const shifts = Object.values((occupancy.data ?? []).reduce<Record<string, { id: string; name: string; booked: number; capacity: number; trips: number }>>((acc, r) => {
    const row = acc[r.shiftId] ?? { id: r.shiftId, name: r.shiftName, booked: 0, capacity: 0, trips: 0 };
    row.booked += r.booked; row.capacity += r.capacity; row.trips += r.trips; acc[r.shiftId] = row;
    return acc;
  }, {})).sort((a, b) => pct(b.booked, b.capacity) - pct(a.booked, a.capacity));
  const trendMax = Math.max(1, ...(d?.rejectedLast7.map((r) => r.count) ?? [1]));
  const trendTotal = d?.rejectedLast7.reduce((n, r) => n + r.count, 0) ?? 0;
  const delta = d ? d.rejectedToday - d.rejectedYesterday : 0;

  return (
    <>
      <PageHeader
        title="Dashboard"
        eyebrow="Pantauan"
        description="Keterisian armada, penolakan booking, dan titik yang perlu perhatian pada tanggal operasional terpilih."
        actions={<><label>Tanggal<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label><button onClick={() => { summary.reload(); occupancy.reload(); }}>Muat ulang</button></>}
      />
      <ErrorText error={summary.error ?? occupancy.error} />
      {d && (
        <>
          {d.backupWarning && <div className="banner" role="status">{d.backupWarning}</div>}

          <section className="dash-hero">
            <div className="dash-hero-copy">
              <span className="dash-kicker">Ringkasan operasional</span>
              <h2>{longDate(d.date)}</h2>
              <p>Semua rute · {d.trips} trip terjadwal</p>
              <div className="dash-flags">
                <span className={`dash-flag ${d.fullTrips ? "warn" : "ok"}`}>{d.fullTrips ? `${d.fullTrips} trip penuh` : "Tidak ada trip penuh"}</span>
                <span className={`dash-flag ${d.rejectedToday ? "warn" : "ok"}`}>{d.rejectedToday ? `${d.rejectedToday} booking ditolak` : "Tidak ada penolakan"}</span>
              </div>
            </div>
            <Gauge value={pct(d.booked, d.capacity)} />
            <div className="dash-hero-metrics">
              <div><span>Trip</span><b>{d.trips}</b><small>{d.fullTrips} penuh</small></div>
              <div><span>Kursi terisi</span><b>{d.booked}</b><small>dari {d.capacity} kursi</small></div>
              <div><span>Ditolak</span><b>{d.rejectedToday}</b><small className={delta > 0 ? "delta-up" : delta < 0 ? "delta-down" : ""}>{signed(delta)} vs kemarin</small></div>
            </div>
          </section>

          <div className="dash-grid">
            <Panel className="dash-trend">
              <div className="panel-head"><div><h2>Tren penolakan 7 hari</h2><p className="muted">Permintaan yang tidak mendapat kursi, sampai {longDate(d.date)}.</p></div><span className="dash-pill">{trendTotal} total</span></div>
              <div className="dash-trend-body">
                <div className="dash-trend-main">
                  <div className="trend-chart" role="img" aria-label={`Penolakan per hari: ${d.rejectedLast7.map((r) => `${r.date} sebanyak ${r.count}`).join(", ")}`}>
                    {d.rejectedLast7.map((r, i) => (
                      <div key={r.date} className={`trend-col${i === d.rejectedLast7.length - 1 ? " current" : ""}`} title={`${r.date}: ${r.count} ditolak`}>
                        <span className="trend-val">{r.count}</span>
                        <div className="trend-bar"><i style={{ height: `${Math.max(r.count ? 12 : 3, (r.count / trendMax) * 100)}%` }} /></div>
                        <span className="trend-day">{shortDay(r.date)}</span>
                      </div>
                    ))}
                  </div>
                  <p className="dash-note">Puncak {Math.max(...d.rejectedLast7.map((r) => r.count))} penolakan dalam sehari · rata-rata {(trendTotal / 7).toFixed(1)} per hari.</p>
                </div>
                <div className="dash-details">
                  <h3>Angka harian</h3>
                  <table>
                    <caption>Booking ditolak 7 hari terakhir</caption>
                    <thead><tr><th>Tanggal</th><th>Ditolak</th></tr></thead>
                    <tbody>
                      {d.rejectedLast7.map((r) => (
                        <tr key={r.date}><td>{r.date}</td><td>{r.count}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </Panel>

            <Panel className="dash-side">
              <div className="panel-head"><div><h2>Rute paling padat</h2><p className="muted">Berdasarkan kursi terisi hari ini.</p></div></div>
              {occupancy.data && routes.length === 0 && <p className="empty-note">Belum ada trip pada tanggal ini.</p>}
              {!occupancy.data && !occupancy.error && <p className="empty-note">Memuat rute…</p>}
              <ul className="dash-routes">
                {routes.map((r) => {
                  const p = pct(r.booked, r.capacity);
                  return (
                    <li key={r.id}>
                      <div className="dash-route-head">
                        <span className="rt"><span className="dot" style={{ background: r.color }}>{r.code}</span><span className="dash-route-name" title={r.name}>{r.name}</span></span>
                        <b>{p}%</b>
                      </div>
                      <div className="meter"><i style={{ width: `${p}%`, background: r.color }} /></div>
                      <small>{r.booked}/{r.capacity} kursi · {r.trips} trip</small>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          </div>

          <div className="dash-grid">
            <Panel className="dash-side">
              <div className="panel-head"><div><h2>Beban per shift</h2><p className="muted">Keterisian tiap shift di seluruh rute.</p></div></div>
              {shifts.length === 0 && occupancy.data && <p className="empty-note">Belum ada data shift.</p>}
              <ul className="dash-shifts">
                {shifts.map((s) => {
                  const p = pct(s.booked, s.capacity);
                  return (
                    <li key={s.id}>
                      <div className="dash-shift-head"><strong>{s.name}</strong><span>{s.booked}/{s.capacity} · {p}%</span></div>
                      <div className="meter"><i style={{ width: `${p}%` }} /></div>
                      <small>{s.trips} trip</small>
                    </li>
                  );
                })}
              </ul>
              <p className="dash-note">Arah jemput {DIRECTION_LABEL.PICKUP} dan antar {DIRECTION_LABEL.DROPOFF} digabung per shift.</p>
            </Panel>

            <Panel className="dash-summary">
              <div className="panel-head"><div><h2>Ringkasan angka</h2><p className="muted">Sumber nilai pada kartu di atas.</p></div></div>
              <table>
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
              <p className="dash-note">Rata-rata penolakan tujuh hari: {(trendTotal / 7).toFixed(1)} per hari.</p>
            </Panel>
          </div>
        </>
      )}
    </>
  );
}
