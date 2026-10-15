import { useState, type FormEvent } from "react";
import { z } from "zod";
import { Availability, Booking, DailyBookingRequest, Direction, ENDPOINTS, Route, Shift, Stop, addDays } from "@bms/shared";
import { api } from "../../api";
import { useMe } from "../../auth";
import { DIRECTION_LABEL, ErrorText, hhmm, today, useAction, useLoad } from "../../ui";

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

  async function submit(e: FormEvent) {
    e.preventDefault();
    const b = await run(() => api.post(ENDPOINTS.bookings, Booking, DailyBookingRequest.parse({ ...choice, date })));
    if (b) { setBooked(b); avail.reload(); }
  }
  return (
    <form className="card" onSubmit={submit}>
      <h1>Booking Harian</h1>
      <div className="row">
        <label>Tanggal
          <select value={date} onChange={(e) => setDate(e.target.value)}>
            {dates.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <TripFields value={choice} onChange={(v) => { setChoice(v); setBooked(null); }} />
      </div>
      {a && (
        <p>
          Sisa kursi: {a.capacity - a.bookedCount} dari {a.capacity}
          {a.firstDepartureAt && <> · berangkat {hhmm(a.firstDepartureAt)} · batas booking {a.cutoffAt && hhmm(a.cutoffAt)}</>}
          {/* bookable === false covers two causes; the cutoff instant is already in hand, so name it separately. */}
          {a.cutoffAt && Date.now() >= Date.parse(a.cutoffAt) && <> · batas booking sudah lewat</>}
          {!a.bookable && <> · tidak bisa dibooking</>}
        </p>
      )}
      <ErrorText error={error ?? avail.error} />
      {booked && <p role="status">Booking berhasil: {booked.routeCode} {booked.stopName}, jemput {hhmm(booked.pickupAt)}, bus {booked.busPlate}.</p>}
      <button className="primary" disabled={busy || suspended || !choice.stopId}>Pesan</button>
    </form>
  );
}
