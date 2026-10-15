import { useState } from "react";
import { z } from "zod";
import { Departure, ENDPOINTS, addDays } from "@bms/shared";
import { api } from "../api";
import { DIRECTION_LABEL, ErrorText, StatusBadge, hhmm, today, useLoad } from "../ui";

/** Spec 6.2 papan keberangkatan: today or tomorrow, own trips highlighted. All roles. */
export function Departures() {
  const [date, setDate] = useState(today());
  const { data, error } = useLoad(() => api.get(ENDPOINTS.departures, z.array(Departure), { date }), [date]);
  const tomorrow = addDays(today(), 1);
  return (
    <section className="card">
      <h1>Papan Keberangkatan</h1>
      <div className="row">
        <button aria-pressed={date === today()} onClick={() => setDate(today())}>Hari ini</button>
        <button aria-pressed={date === tomorrow} onClick={() => setDate(tomorrow)}>Besok</button>
        <span>{date}</span>
      </div>
      <ErrorText error={error} />
      <table>
        <thead><tr><th>Jam</th><th>Rute</th><th>Shift</th><th>Arah</th><th>Bus</th><th>Terisi</th><th>Status</th></tr></thead>
        <tbody>
          {data?.map((d) => (
            <tr key={d.tripId} className={d.mine ? "mine" : undefined}>
              <td>{hhmm(d.departureAt)}</td>
              <td><span className="swatch" style={{ background: d.routeColor }} /> {d.routeCode} {d.routeName}</td>
              <td>{d.shiftName}</td>
              <td>{DIRECTION_LABEL[d.direction]}</td>
              <td>{d.busPlate}</td>
              <td>{d.bookedCount}/{d.capacity}</td>
              <td><StatusBadge status={d.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
