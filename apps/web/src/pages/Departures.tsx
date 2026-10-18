import { useState } from "react";
import { z } from "zod";
import { Departure, ENDPOINTS, addDays } from "@bms/shared";
import { api } from "../api";
import { DIRECTION_LABEL, ErrorText, StatusBadge, hhmm, pct, today, useLoad } from "../ui";

/** Spec 6.2 papan keberangkatan: today or tomorrow, own trips highlighted. All roles. Styled as station signage. */
export function Departures() {
  const [date, setDate] = useState(today());
  const { data, error } = useLoad(() => api.get(ENDPOINTS.departures, z.array(Departure), { date }), [date]);
  const tomorrow = addDays(today(), 1);
  return (
    <>
      <header><span className="eyebrow">Semua rute · {date}</span><h1>Papan Keberangkatan</h1></header>
      <ErrorText error={error} />
      <section className="board">
        <div className="bhead">
          <h2>Keberangkatan</h2>
          <div className="row">
            <button aria-pressed={date === today()} onClick={() => setDate(today())}>Hari ini</button>
            <button aria-pressed={date === tomorrow} onClick={() => setDate(tomorrow)}>Besok</button>
          </div>
        </div>
        <div className="scroll">
          <table>
            <thead><tr><th>Jam</th><th>Rute</th><th>Shift</th><th>Arah</th><th>Bus</th><th>Terisi</th><th>Status</th></tr></thead>
            <tbody key={date}>
              {data?.map((d) => (
                <tr key={d.tripId} className={d.mine ? "mine" : undefined}>
                  <td className="t">{hhmm(d.departureAt)}</td>
                  <td><span className="rt"><span className="dot" style={{ background: d.routeColor }}>{d.routeCode}</span>{d.routeName}</span></td>
                  <td>{d.shiftName}</td>
                  <td>{DIRECTION_LABEL[d.direction]}</td>
                  <td>{d.busPlate}</td>
                  <td><span className="load"><span className="meter"><i style={{ width: `${pct(d.bookedCount, d.capacity)}%` }} /></span>{d.bookedCount}/{d.capacity}</span></td>
                  <td><StatusBadge status={d.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data?.length === 0 && <p className="empty">Tidak ada keberangkatan.</p>}
      </section>
    </>
  );
}
