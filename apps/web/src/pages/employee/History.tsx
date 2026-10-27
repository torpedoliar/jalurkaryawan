import { useState } from "react";
import { z } from "zod";
import { Booking, ENDPOINTS, type BookingStatus } from "@bms/shared";
import { api } from "../../api";
import { BOOKING_STATUS_TEXT, DIRECTION_LABEL, ErrorText, PageHeader, Panel, Stat, StatGrid, hhmm, useLoad } from "../../ui";

const FILTERS: { key: "" | BookingStatus; label: string }[] = [
  { key: "", label: "Semua" },
  { key: "BOOKED", label: "Terbooked" },
  { key: "CANCELLED", label: "Dibatalkan" },
  { key: "NO_SHOW", label: "Tidak hadir" },
];
const STATUS_TONE: Record<BookingStatus, string> = { BOOKED: "ok", CANCELLED: "bad", NO_SHOW: "warn" };

/** Spec 6.2 riwayat: every booking, newest first. */
export function History() {
  const [filter, setFilter] = useState<"" | BookingStatus>("");
  const { data, error } = useLoad(
    () => api.get(ENDPOINTS.myBookings, z.array(Booking)).then((rows) => rows.sort((a, b) => b.departureAt.localeCompare(a.departureAt))),
    [],
  );
  const rows = (data ?? []).filter((b) => !filter || b.status === filter);
  const count = (s: BookingStatus) => data?.filter((b) => b.status === s).length ?? 0;
  return (
    <>
      <PageHeader title="Riwayat" eyebrow="Perjalanan saya" description="Semua booking kamu, terbaru di atas. Saring berdasarkan status untuk melihat pola perjalanan." />
      <ErrorText error={error} />
      {data && (
        <StatGrid>
          <Stat label="Total booking" value={data.length} hint="seluruh riwayat" />
          <Stat label="Terbooked" value={count("BOOKED")} hint="kursi aktif" tone="ok" />
          <Stat label="Dibatalkan" value={count("CANCELLED")} hint="oleh kamu atau admin" tone="bad" />
          <Stat label="Tidak hadir" value={count("NO_SHOW")} hint="tercatat sistem" tone="warn" />
        </StatGrid>
      )}
      <Panel>
        <div className="toolbar">
          <div className="chips" role="group" aria-label="Saring status">
            {FILTERS.map((f) => <button key={f.key || "all"} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>{f.label}</button>)}
          </div>
          <p className="count">{rows.length} booking</p>
        </div>
        {data?.length === 0 && <p className="empty-note">Belum ada riwayat booking.</p>}
        {data && data.length > 0 && rows.length === 0 && <p className="empty-note">Tidak ada booking dengan status ini.</p>}
        {/* The table only renders with at least one row: an empty grid would show unexplained headers, and a
            header on the loading pass makes findAllByRole("row") resolve before the body arrives. */}
        {rows.length > 0 && (
          <table>
            <thead><tr><th>Tanggal</th><th>Jam</th><th>Rute</th><th>Arah</th><th>Titik</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <td>{b.date}</td><td>{hhmm(b.departureAt)}</td>
                  <td><span className="rt"><span className="dot" style={{ background: b.routeColor }}>{b.routeCode}</span><span className="route-name" title={b.routeName}>{b.routeName}</span></span></td>
                  <td>{DIRECTION_LABEL[b.direction]}</td><td>{b.stopName}</td>
                  <td><span className={`pill ${STATUS_TONE[b.status]}`}>{BOOKING_STATUS_TEXT[b.status]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}
