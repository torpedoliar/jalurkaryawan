import { useState, type FormEvent } from "react";
import { z } from "zod";
import { Availability, Booking, DailyBookingRequest, Direction, ENDPOINTS, Route, Shift, Stop, addDays } from "@bms/shared";
import { api } from "../../api";
import { useMe } from "../../auth";
import { DIRECTION_LABEL, ErrorText, PageHeader, Panel, hhmm, pct, today, useAction, useLoad } from "../../ui";

export interface TripChoice { shiftId: string; direction: Direction | ""; routeId: string; stopId: string }
export const EMPTY_CHOICE: TripChoice = { shiftId: "", direction: "", routeId: "", stopId: "" };

/** Shift → arah → rute → titik jemput selects; shared by daily booking and subscriptions. */
export function TripFields({ value, onChange }: { value: TripChoice; onChange(v: TripChoice): void }) {
  const shifts = useLoad(() => api.get(ENDPOINTS.shifts, z.array(Shift)), []);
  const routes = useLoad(() => api.get(ENDPOINTS.routes, z.array(Route)), []);
  const stops = useLoad(
    () => (value.routeId ? api.get(ENDPOINTS.routeStops(value.routeId), z.array(Stop)) : Promise.resolve([])),
    [value.routeId],
  );
  return (
    <>
      <label>Shift
        <select value={value.shiftId} onChange={(e) => onChange({ ...value, shiftId: e.target.value })} required>
          <option value="">Pilih shift</option>
          {shifts.data?.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.startTime}–{s.endTime})</option>)}
        </select>
      </label>
      <label>Arah
        <select value={value.direction} onChange={(e) => onChange({ ...value, direction: e.target.value as Direction })} required>
          <option value="">Pilih arah</option>
          {Direction.options.map((d) => <option key={d} value={d}>{DIRECTION_LABEL[d]}</option>)}
        </select>
      </label>
      <label>Rute
        <select value={value.routeId} onChange={(e) => onChange({ ...value, routeId: e.target.value, stopId: "" })} required>
          <option value="">Pilih rute</option>
          {routes.data?.filter((r) => r.active).map((r) => <option key={r.id} value={r.id}>{r.code} {r.name}</option>)}
        </select>
      </label>
      {value.routeId && (
        <label>Titik jemput
          <select value={value.stopId} onChange={(e) => onChange({ ...value, stopId: e.target.value })} required>
            <option value="">Pilih titik</option>
            {stops.data?.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.seq}. {s.name}</option>)}
          </select>
        </label>
      )}
      <ErrorText error={shifts.error ?? routes.error ?? stops.error} />
    </>
  );
}

/** Spec 6.2 booking harian: tanggal → shift → arah → rute → titik, with seats left. */
export function Book() {
  const me = useMe();
  const dates = Array.from({ length: 8 }, (_, i) => addDays(today(), i));
  const [date, setDate] = useState(dates[1]!);
  const [choice, setChoice] = useState<TripChoice>(EMPTY_CHOICE);
  const [booked, setBooked] = useState<Booking | null>(null);
  const { busy, error, run } = useAction();
  const ready = choice.shiftId && choice.direction && choice.routeId;
  const avail = useLoad(
    () => (ready ? api.get(ENDPOINTS.availability, Availability, { ...choice, date, stopId: undefined }) : Promise.resolve(undefined)),
    [date, choice.shiftId, choice.direction, choice.routeId],
  );
  const suspended = me.bookingSuspendedUntil !== null && me.bookingSuspendedUntil >= today();
  const a = avail.data;
  const step = !choice.shiftId || !choice.direction ? 2 : !choice.routeId || !choice.stopId ? 3 : 4;
  const quickLabel = (d: string, i: number) => i === 0 ? "Hari ini" : i === 1 ? "Besok" : new Date(`${d}T12:00:00+07:00`).toLocaleDateString("id-ID", { weekday: "short", day: "numeric" });

  async function submit(e: FormEvent) {
    e.preventDefault();
    const b = await run(() => api.post(ENDPOINTS.bookings, Booking, DailyBookingRequest.parse({ ...choice, date })));
    if (b) { setBooked(b); avail.reload(); }
  }
  const remaining = a ? a.capacity - a.bookedCount : 0;
  const fill = a ? pct(a.bookedCount, a.capacity) : 0;
  return (
    <>
      <PageHeader title="Booking Harian" eyebrow="Perjalanan saya" description="Pesan kursi untuk satu tanggal. Untuk jadwal rutin, gunakan Langganan." />
      <div className="booking-layout">
        <Panel title="Rencana perjalanan" description="Lengkapi pilihan; ketersediaan dihitung otomatis sebelum kamu memesan.">
          <form className="stack" onSubmit={submit}>
            <ol className="steps" aria-label="Langkah pemesanan">
              <li className="done">Tanggal</li>
              <li className={step === 2 ? "active" : "done"}>Shift &amp; arah</li>
              <li className={step === 3 ? "active" : step > 3 ? "done" : ""}>Rute &amp; titik</li>
            </ol>
            <div className="date-chips" role="group" aria-label="Pilih tanggal cepat">
              {dates.map((d, i) => (
                <button type="button" key={d} aria-pressed={date === d} onClick={() => { setDate(d); setBooked(null); }}>
                  <span>{quickLabel(d, i)}</span><small>{d}</small>
                </button>
              ))}
            </div>
            <div className="fields">
              <label>Tanggal
                <select value={date} onChange={(e) => setDate(e.target.value)}>
                  {dates.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
              <TripFields value={choice} onChange={(v) => { setChoice(v); setBooked(null); }} />
            </div>
            <ErrorText error={error ?? avail.error} />
            <div className="row"><button className="primary" disabled={busy || suspended || !choice.stopId}>Pesan</button></div>
          </form>
        </Panel>

        <div className="stack">
          <Panel className="availability" title="Ketersediaan" description="Perkiraan berdasarkan jadwal yang sudah dipublikasikan.">
            {!a && <p className="empty-note">{ready ? "Menghitung ketersediaan…" : "Pilih shift, arah, dan rute untuk melihat sisa kursi."}</p>}
            {a && (
              <>
                <div className={`avail-hero${a.bookable ? "" : " closed"}`}>
                  <b>{remaining}</b>
                  <div><span>kursi tersisa</span><small>dari {a.capacity} kursi</small></div>
                </div>
                <div className="meter big"><i style={{ width: `${fill}%` }} /></div>
                <p className="avail">Sisa kursi: {remaining} dari {a.capacity}
                  {a.firstDepartureAt && <> · berangkat {hhmm(a.firstDepartureAt)} · batas booking {a.cutoffAt && hhmm(a.cutoffAt)}</>}
                  {/* bookable === false covers two causes; the cutoff instant is already in hand, so name it separately. */}
                  {a.cutoffAt && Date.now() >= Date.parse(a.cutoffAt) && <> · batas booking sudah lewat</>}
                  {!a.bookable && <> · tidak bisa dibooking</>}
                </p>
                <div className="avail-state">{a.bookable ? <span className="pill ok">Bisa dipesan</span> : <span className="pill bad">Tidak bisa dipesan</span>}<span className="pill">{fill}% terisi</span></div>
                <dl className="fact-list">
                  <div><dt>Tanggal</dt><dd>{date}</dd></div>
                  <div><dt>Berangkat</dt><dd>{a.firstDepartureAt ? hhmm(a.firstDepartureAt) : "—"}</dd></div>
                  <div><dt>Batas booking</dt><dd>{a.cutoffAt ? hhmm(a.cutoffAt) : "—"}</dd></div>
                  <div><dt>Terisi</dt><dd>{a.bookedCount}/{a.capacity} kursi</dd></div>
                </dl>
              </>
            )}
          </Panel>
          {booked && (
            <Panel className="receipt" title="Tiket berhasil dibuat" description="Tiket juga muncul di Beranda.">
              <p role="status">Booking berhasil: {booked.routeCode} {booked.stopName}, jemput {hhmm(booked.pickupAt)}, bus {booked.busPlate}.</p>
              <dl className="fact-list">
                <div><dt>Tanggal</dt><dd>{booked.date}</dd></div>
                <div><dt>Arah</dt><dd>{DIRECTION_LABEL[booked.direction]}</dd></div>
                <div><dt>Rute</dt><dd>{booked.routeCode} {booked.routeName}</dd></div>
                <div><dt>Titik</dt><dd>{booked.stopName}</dd></div>
              </dl>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
