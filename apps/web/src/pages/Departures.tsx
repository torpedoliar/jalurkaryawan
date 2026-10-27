import { useEffect, useState } from "react";
import { z } from "zod";
import { Departure, ENDPOINTS, addDays } from "@bms/shared";
import { api } from "../api";
import { DIRECTION_LABEL, ErrorText, PageHeader, StatusBadge, hhmm, pct, today, useLoad } from "../ui";

const clockWib = (ms: number) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
const longDate = (date: string) => new Date(`${date}T12:00:00+07:00`).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
function until(ms: number) {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} menit lagi`;
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return rest ? `${hours} jam ${rest} menit lagi` : `${hours} jam lagi`;
}

/** Spec 6.2 papan keberangkatan: today or tomorrow, own trips highlighted. All roles. Styled as station signage. */
export function Departures() {
  const [date, setDate] = useState(today());
  const [route, setRoute] = useState("");
  const [direction, setDirection] = useState<"" | "PICKUP" | "DROPOFF">("");
  const [now, setNow] = useState(Date.now());
  const { data, error } = useLoad(() => api.get(ENDPOINTS.departures, z.array(Departure), { date }), [date]);
  const tomorrow = addDays(today(), 1);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const routes = [...new Map((data ?? []).map((d) => [d.routeId, { id: d.routeId, code: d.routeCode, color: d.routeColor }])).values()];
  const rows = (data ?? []).filter((d) => (!route || d.routeId === route) && (!direction || d.direction === direction));
  const totalSeats = rows.reduce((n, d) => n + d.capacity, 0);
  const bookedSeats = rows.reduce((n, d) => n + d.bookedCount, 0);
  const fullTrips = rows.filter((d) => d.status === "FULL").length;
  const next = (distance: (d: Departure) => number) => rows
    .filter((d) => d.status !== "CANCELLED")
    .map((d) => ({ d, gap: distance(d) }))
    .filter((x) => x.gap >= 0)
    .sort((a, b) => a.gap - b.gap)[0];
  const upcoming = date === today() ? next((d) => Date.parse(d.departureAt) - now) : next(() => 0);

  return (
    <>
      <PageHeader title="Papan Keberangkatan" eyebrow={`Semua rute · ${longDate(date)}`} description="Jadwal dan keterisian seluruh armada. Baris kuning adalah tiketmu; jam besar menunjukkan keberangkatan berikutnya." />
      <ErrorText error={error} />
      <section className="board">
        <div className="board-top">
          <div className="board-id">
            <span className="board-live"><i aria-hidden="true" /> LIVE</span>
            <h2>Keberangkatan</h2>
            <p>{longDate(date)}</p>
          </div>
          <div className="board-clock" aria-label={`Waktu Jakarta ${clockWib(now)}`}>
            <b>{clockWib(now)}</b><span>WIB</span>
          </div>
          <div className="board-tabs" role="group" aria-label="Pilih tanggal keberangkatan">
            <button aria-pressed={date === today()} onClick={() => { setDate(today()); setRoute(""); }}>Hari ini</button>
            <button aria-pressed={date === tomorrow} onClick={() => { setDate(tomorrow); setRoute(""); }}>Besok</button>
          </div>
        </div>

        <div className="board-stats">
          <div><span>Keberangkatan</span><b>{rows.length}</b><small>{fullTrips} penuh</small></div>
          <div><span>Kursi terisi</span><b>{bookedSeats}<em>/{totalSeats}</em></b><small>{pct(bookedSeats, totalSeats)}% keterisian armada</small></div>
          <div><span>Sisa kursi</span><b>{Math.max(0, totalSeats - bookedSeats)}</b><small>di semua trip terpilih</small></div>
          <div className={fullTrips ? "stat-alert" : ""}><span>Status armada</span><b>{fullTrips ? "Padat" : "Lancar"}</b><small>{fullTrips ? "Ada trip penuh" : "Semua trip masih tersedia"}</small></div>
        </div>

        {upcoming && (
          <div className={`board-next${upcoming.d.mine ? " mine" : ""}`}>
            <div className="next-label">BERIKUTNYA{upcoming.d.mine && <span className="mine-tag">Tiket saya</span>}</div>
            <div className="next-time">{hhmm(upcoming.d.departureAt)}</div>
            <div className="next-route">
              <span className="dot" style={{ background: upcoming.d.routeColor }}>{upcoming.d.routeCode}</span>
              <div>
                <strong>{upcoming.d.routeName}</strong>
                <span>{DIRECTION_LABEL[upcoming.d.direction]} · {upcoming.d.shiftName} · {upcoming.d.busPlate}</span>
              </div>
            </div>
            <div className="next-load">
              <span>{date === today() ? until(upcoming.gap) : "Keberangkatan pertama"}</span>
              <div className="meter"><i style={{ width: `${pct(upcoming.d.bookedCount, upcoming.d.capacity)}%` }} /></div>
              <small>{upcoming.d.bookedCount}/{upcoming.d.capacity} kursi terisi</small>
            </div>
          </div>
        )}

        <div className="board-toolbar">
          <div className="chips" role="group" aria-label="Saring rute">
            <button aria-pressed={!route} onClick={() => setRoute("")}>Semua rute</button>
            {routes.map((r) => <button key={r.id} aria-pressed={route === r.id} onClick={() => setRoute(r.id)}><span className="swatch" style={{ background: r.color }} />{r.code}</button>)}
          </div>
          <div className="chips" role="group" aria-label="Saring arah">
            <button aria-pressed={!direction} onClick={() => setDirection("")}>Semua arah</button>
            <button aria-pressed={direction === "PICKUP"} onClick={() => setDirection("PICKUP")}>Jemput</button>
            <button aria-pressed={direction === "DROPOFF"} onClick={() => setDirection("DROPOFF")}>Antar</button>
          </div>
        </div>

        <div className="scroll">
          <table>
            <caption className="sr-only">Jadwal keberangkatan {longDate(date)}</caption>
            <colgroup><col className="c-time" /><col /><col className="c-shift" /><col className="c-dir" /><col className="c-bus" /><col className="c-load" /><col className="c-status" /></colgroup>
            <thead><tr><th>Jam</th><th>Rute</th><th>Shift</th><th>Arah</th><th>Bus</th><th>Kursi</th><th>Status</th></tr></thead>
            <tbody key={date}>
              {rows.map((d) => {
                const isNext = upcoming?.d.tripId === d.tripId;
                const fill = pct(d.bookedCount, d.capacity);
                return (
                  <tr key={d.tripId} className={[d.mine ? "mine" : "", isNext ? "next" : "", d.status === "CANCELLED" ? "cancelled" : ""].filter(Boolean).join(" ") || undefined}>
                    <td className="t">
                      <span className="dep-time">{hhmm(d.departureAt)}</span>
                      {d.departureAt.slice(0, 10) !== d.date && <sup className="h1">H+1</sup>}
                      {isNext && <em className="next-flag">Berikutnya</em>}
                      {d.mine && <em className="mine-tag">Tiket saya</em>}
                    </td>
                    <td>
                      <span className="rt"><span className="dot" style={{ background: d.routeColor }}>{d.routeCode}</span><span className="route-name" title={d.routeName}><b>{d.routeName.split(" → ")[0]}</b>{d.routeName.includes(" → ") && <small>{d.routeName.split(" → ").slice(1).join(" → ")}</small>}</span></span>
                    </td>
                    <td>{d.shiftName}</td>
                    <td><span className={`dir-pill ${d.direction}`}>{DIRECTION_LABEL[d.direction]}</span></td>
                    <td><span className="bus-chip">{d.busPlate}</span></td>
                    <td>
                      <span className="board-load">
                        <span className="load-num">{d.bookedCount}<small>/{d.capacity}</small></span>
                        <span className="meter"><i className={fill >= 90 ? "hot" : ""} style={{ width: `${fill}%` }} /></span>
                        <span className="load-pct">{fill}%</span>
                      </span>
                    </td>
                    <td><StatusBadge status={d.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {data && rows.length === 0 && <p className="empty">Tidak ada keberangkatan untuk filter ini.</p>}
        {!data && !error && <p className="empty">Memuat jadwal keberangkatan…</p>}
        <div className="board-foot">
          <span><i className="key mine" /> Tiket saya</span>
          <span><i className="key next" /> Keberangkatan berikutnya</span>
          <span><i className="key full" /> Kursi hampir penuh</span>
          <span className="board-foot-note">Data mengikuti jadwal trip yang dipublikasikan admin.</span>
        </div>
      </section>
    </>
  );
}
