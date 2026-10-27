import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import { z } from "zod";
import { Booking, ENDPOINTS, addDays } from "@bms/shared";
import { api } from "../../api";
import { BOOKING_STATUS_TEXT, DIRECTION_LABEL, ErrorText, PageHeader, Stat, StatGrid, hhmm, today, useAction, useLoad } from "../../ui";

const dayLong = (date: string) => new Date(`${date}T12:00:00+07:00`).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long" });

/** Spec 6.2 beranda: bookings for the next 7 days; cancel only before cutoff. Rendered as boarding-pass tickets. */
export function Home() {
  const from = today();
  const list = useLoad(() => api.get(ENDPOINTS.myBookings, z.array(Booking), { from, to: addDays(from, 6) }), [from]);
  const { busy, error, run } = useAction();
  const rows = list.data ?? [];
  const active = rows.filter((b) => b.status === "BOOKED");
  const upcoming = active.filter((b) => Date.parse(b.departureAt) >= Date.now()).sort((a, b) => a.departureAt.localeCompare(b.departureAt))[0];
  const nextId = upcoming?.id;
  async function cancel(id: string) {
    if (await run(() => api.post(ENDPOINTS.bookingCancel(id), Booking))) list.reload();
  }
  const groups: [string, Booking[]][] = [];
  for (const b of rows) {
    const last = groups[groups.length - 1];
    if (last && last[0] === b.date) last[1].push(b); else groups.push([b.date, [b]]);
  }

  const card = (b: Booking): ReactNode => {
    const [origin, dest] = b.direction === "PICKUP" ? [b.stopName, "Kantor"] : ["Kantor", b.stopName];
    return (
      <article key={b.id} className={`ticket${b.status === "BOOKED" ? "" : " off"}${b.id === nextId ? " next" : ""}`} style={{ "--c": b.routeColor } as CSSProperties}>
        <div className="band" />
        <div className="top">
          <div className="trow">
            <span className="dir" title={`${b.routeCode} ${b.routeName}`}>● {DIRECTION_LABEL[b.direction]} · {b.routeCode} {b.routeName.split(" → ")[0]}</span>
            <span className="tag">{b.source === "SUBSCRIPTION" ? "LANGGANAN" : "HARIAN"}</span>
          </div>
          <div className="trow"><span className="eyebrow">{b.date}</span><span className="eyebrow">{BOOKING_STATUS_TEXT[b.status]}</span></div>
          <div className="stops"><div>{origin}</div><span className="bar" /><div>{dest}</div></div>
        </div>
        <div className="perf" />
        <div className="stub">
          <div><span>{DIRECTION_LABEL[b.direction]}</span><b>{hhmm(b.pickupAt)}</b></div>
          <div><span>Bus</span><b>{b.busPlate}</b></div>
          <div><span>Sisa kursi</span><b>{b.seatsLeft}/{b.capacity}</b></div>
        </div>
        {b.status === "BOOKED" && (
          <div className="tact">
            {Date.now() < Date.parse(b.cutoffAt)
              ? <><small>Batal maks. {hhmm(b.cutoffAt)}</small><button disabled={busy} onClick={() => void cancel(b.id)}>Batalkan</button></>
              : <small>Batas batal lewat</small>}
          </div>
        )}
        {b.id === nextId && <span className="ticket-next">Berikutnya</span>}
      </article>
    );
  };

  return (
    <>
      <PageHeader
        title="Beranda"
        eyebrow="7 hari ke depan"
        description="Tiket perjalanan kamu minggu ini. Pembatalan bisa dilakukan sampai batas waktu di tiap tiket."
        actions={<Link className="btn-link" to="/booking">Pesan tiket</Link>}
      />
      <ErrorText error={error ?? list.error} />
      {list.data && (
        <StatGrid>
          <Stat label="Tiket aktif" value={active.length} hint={`${rows.length} tiket dalam 7 hari`} tone="ok" />
          <Stat label="Perjalanan berikutnya" value={upcoming ? hhmm(upcoming.departureAt) : "—"} hint={upcoming ? `${upcoming.date} · ${DIRECTION_LABEL[upcoming.direction]} ${upcoming.routeCode}` : "Tidak ada jadwal mendatang"} tone="accent" />
          <Stat label="Langganan" value={rows.filter((b) => b.source === "SUBSCRIPTION").length} hint="tiket dari langganan" />
          <Stat label="Hari ini" value={rows.filter((b) => b.date === from).length} hint="perjalanan terjadwal" />
        </StatGrid>
      )}
      {list.data?.length === 0 && (
        <div className="empty-hero">
          <h2>Belum ada booking 7 hari ke depan.</h2>
          <p>Pesan kursi harian atau buat langganan agar perjalanan rutin otomatis terisi.</p>
          <div className="row"><Link className="btn-link" to="/booking">Booking harian</Link><Link className="btn-link ghost" to="/langganan">Buat langganan</Link></div>
        </div>
      )}
      {groups.map(([date, items]) => (
        <section key={date} className="ticket-day">
          <div className="day-head">
            <div>
              <span className="eyebrow">{date === from ? "Hari ini" : date === addDays(from, 1) ? "Besok" : dayLong(date)}</span>
              <h2>{dayLong(date)}</h2>
            </div>
            <span className="count">{items.length} tiket</span>
          </div>
          <div className="tickets">{items.map(card)}</div>
        </section>
      ))}
    </>
  );
}
