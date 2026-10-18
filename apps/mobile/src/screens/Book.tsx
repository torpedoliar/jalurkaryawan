import { useState } from "react";
import { Text, View } from "react-native";
import { z } from "zod";
import { Availability, Booking, DailyBookingRequest, Direction, ENDPOINTS, Route, Shift, Stop, addDays } from "@bms/shared";
import { api } from "../api";
import { useMe } from "../auth";
import { Btn, ChipSelect, DIRECTION_LABEL, ErrorText, S, Title, hhmm, today, useAction, useLoad } from "../ui";

export interface TripChoice { shiftId: string; direction: Direction | ""; routeId: string; stopId: string }
export const EMPTY_CHOICE: TripChoice = { shiftId: "", direction: "", routeId: "", stopId: "" };

/** Shift → arah → rute → titik jemput chip selectors; shared by daily booking and subscriptions. */
export function TripFields({ value, onChange }: { value: TripChoice; onChange(v: TripChoice): void }) {
  const shifts = useLoad(() => api.get(ENDPOINTS.shifts, z.array(Shift)), []);
  const routes = useLoad(() => api.get(ENDPOINTS.routes, z.array(Route)), []);
  const stops = useLoad(
    () => (value.routeId ? api.get(ENDPOINTS.routeStops(value.routeId), z.array(Stop)) : Promise.resolve([])),
    [value.routeId],
  );
  return (
    <View style={S.screen}>
      <ChipSelect
        label="Shift"
        options={(shifts.data ?? []).map((s) => ({ value: s.id, label: `${s.name} (${s.startTime}–${s.endTime})` }))}
        value={value.shiftId}
        onChange={(v) => onChange({ ...value, shiftId: v })}
      />
      <ChipSelect
        label="Arah"
        options={Direction.options.map((d) => ({ value: d, label: DIRECTION_LABEL[d] }))}
        value={value.direction}
        onChange={(v) => onChange({ ...value, direction: v as Direction })}
      />
      <ChipSelect
        label="Rute"
        options={(routes.data ?? []).filter((r) => r.active).map((r) => ({ value: r.id, label: `${r.code} ${r.name}` }))}
        value={value.routeId}
        onChange={(v) => onChange({ ...value, routeId: v, stopId: "" })}
      />
      {value.routeId && (
        <ChipSelect
          label="Titik jemput"
          options={(stops.data ?? []).filter((s) => s.active).map((s) => ({ value: s.id, label: `${s.seq}. ${s.name}` }))}
          value={value.stopId}
          onChange={(v) => onChange({ ...value, stopId: v })}
        />
      )}
      <ErrorText error={shifts.error ?? routes.error ?? stops.error} />
    </View>
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
    () => (ready
      ? api.get(ENDPOINTS.availability, Availability, {
          shiftId: choice.shiftId, direction: choice.direction || undefined,
          routeId: choice.routeId, date, stopId: undefined,
        })
      : Promise.resolve(undefined)),
    [date, choice.shiftId, choice.direction, choice.routeId],
  );
  const suspended = me.bookingSuspendedUntil !== null && me.bookingSuspendedUntil >= today();
  const a = avail.data;

  async function submit() {
    const b = await run(() => api.post(ENDPOINTS.bookings, Booking, DailyBookingRequest.parse({ ...choice, date })));
    if (b) { setBooked(b); avail.reload(); }
  }
  return (
    <View style={S.screen}>
      <Title kicker="Pesan kursi">Booking Harian</Title>
      <ChipSelect label="Tanggal" options={dates.map((d) => ({ value: d, label: d }))} value={date} onChange={(v) => { setDate(v); setBooked(null); }} />
      <TripFields value={choice} onChange={(v) => { setChoice(v); setBooked(null); }} />
      {a && (
        <Text style={[S.card, S.text]}>{`Sisa kursi: ${a.capacity - a.bookedCount} dari ${a.capacity}${a.firstDepartureAt ? ` · berangkat ${hhmm(a.firstDepartureAt)} · batas booking ${a.cutoffAt ? hhmm(a.cutoffAt) : ""}` : ""}${a.cutoffAt && Date.now() >= Date.parse(a.cutoffAt) ? " · batas booking sudah lewat" : ""}${!a.bookable ? " · tidak bisa dibooking" : ""}`}</Text>
      )}
      <ErrorText error={error ?? avail.error} />
      {booked && <Text accessibilityLiveRegion="polite" style={S.text}>{`Booking berhasil: ${booked.routeCode} ${booked.stopName}, jemput ${hhmm(booked.pickupAt)}, bus ${booked.busPlate}.`}</Text>}
      <Btn primary title={busy ? "Memesan..." : "Pesan"} onPress={() => void submit()} disabled={busy || suspended || !ready || !choice.stopId} />
    </View>
  );
}
