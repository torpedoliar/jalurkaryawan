import { z } from "zod";
import { Booking, ENDPOINTS, addDays } from "@bms/shared";
import { api } from "../../api";
import { BOOKING_STATUS_TEXT, DIRECTION_LABEL, ErrorText, hhmm, today, useAction, useLoad } from "../../ui";

/** Spec 6.2 beranda: bookings for the next 7 days; cancel only before cutoff. */
export function Home() {
  const from = today();
  const list = useLoad(() => api.get(ENDPOINTS.myBookings, z.array(Booking), { from, to: addDays(from, 6) }), [from]);
  const { busy, error, run } = useAction();
  async function cancel(id: string) {
    if (await run(() => api.post(ENDPOINTS.bookingCancel(id), Booking))) list.reload();
  }
  return (
    <section className="card">
      <h1>Beranda</h1>
      <ErrorText error={error ?? list.error} />
      {list.data?.length === 0 && <p>Belum ada booking 7 hari ke depan.</p>}
      {list.data?.map((b) => (
        <article key={b.id} className="card">
          <strong><span className="swatch" style={{ background: b.routeColor }} /> {b.date} · {DIRECTION_LABEL[b.direction]} · {b.routeCode} {b.routeName}</strong>
          <div>{b.stopName}, jemput {hhmm(b.pickupAt)} · bus {b.busPlate}</div>
          <div>{BOOKING_STATUS_TEXT[b.status]}</div>
          {b.status === "BOOKED" && (Date.now() < Date.parse(b.cutoffAt)
            ? <button disabled={busy} onClick={() => void cancel(b.id)}>Batalkan</button>
            : <small>Batas batal lewat</small>)}
        </article>
      ))}
    </section>
  );
}
