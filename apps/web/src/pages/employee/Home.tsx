import type { CSSProperties } from "react";
import { z } from "zod";
import { Booking, ENDPOINTS, addDays } from "@bms/shared";
import { api } from "../../api";
import { BOOKING_STATUS_TEXT, DIRECTION_LABEL, ErrorText, hhmm, today, useAction, useLoad } from "../../ui";

/** Spec 6.2 beranda: bookings for the next 7 days; cancel only before cutoff. Rendered as boarding-pass tickets. */
export function Home() {
  const from = today();
  const list = useLoad(() => api.get(ENDPOINTS.myBookings, z.array(Booking), { from, to: addDays(from, 6) }), [from]);
  const { busy, error, run } = useAction();
  async function cancel(id: string) {
    if (await run(() => api.post(ENDPOINTS.bookingCancel(id), Booking))) list.reload();
  }
  return (
    <>
      <header><span className="eyebrow">7 hari ke depan</span><h1>Beranda</h1></header>
      <ErrorText error={error ?? list.error} />
      {list.data?.length === 0 && <p>Belum ada booking 7 hari ke depan.</p>}
      <div className="tickets">
        {list.data?.map((b) => {
          const [origin, dest] = b.direction === "PICKUP" ? [b.stopName, "Kantor"] : ["Kantor", b.stopName];
          return (
            <article key={b.id} className={`ticket${b.status === "BOOKED" ? "" : " off"}`} style={{ "--c": b.routeColor } as CSSProperties}>
              <div className="band" />
              <div className="top">
                <div className="trow">
                  <span className="dir">● {DIRECTION_LABEL[b.direction]} · {b.routeCode} {b.routeName}</span>
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
            </article>
          );
        })}
      </div>
    </>
  );
}
